/**
 * CANDIDATE DASHBOARD API ROUTES
 * src/routes/dashboard.js
 *
 * Provides data for the candidate dashboard.
 * All routes require requireCandidate middleware.
 *
 * Routes:
 *   GET /api/dashboard/profile    — candidate profile + campaign stats
 *   GET /api/dashboard/checklist  — campaign task checklist with completion
 *   PATCH /api/dashboard/checklist/:taskId — mark task done/undone
 */

const express = require('express');
const router = express.Router();

// GET /api/dashboard/profile
router.get('/profile', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;

  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await db.query(`
      SELECT
        c.id, c.full_name, c.preferred_name, c.bio, c.photo_url,
        c.campaign_email, c.campaign_phone, c.campaign_website, c.subdomain,
        c.race_id, c.office_sought, c.district, c.state, c.status,
        c.onboarding_step, c.platform_agreed, c.platform_agreed_at,
        c.created_at, c.updated_at,
        u.email, u.last_login,
        u.address, u.city, u.zip,
        cp.pledged_at
      FROM candidates c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN candidate_pledges cp ON cp.candidate_id = c.id
      WHERE c.id = $1
    `, [candidateId]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    const c = result.rows[0];

    // Get stats separately so a missing table doesn't crash everything
    let stats = { volunteers: 0, upcomingEvents: 0, doorsKnocked: 0 };
    try {
      const [vol, events, doors] = await Promise.allSettled([
        db.query('SELECT COUNT(*) FROM volunteers WHERE candidate_id = $1 AND status = \'active\'', [candidateId]),
        db.query('SELECT COUNT(*) FROM events WHERE candidate_id = $1 AND start_time > NOW()', [candidateId]),
        db.query('SELECT COUNT(*) FROM contact_log WHERE candidate_id = $1', [candidateId]),
      ]);
      stats.volunteers = parseInt(vol.value?.rows[0]?.count) || 0;
      stats.upcomingEvents = parseInt(events.value?.rows[0]?.count) || 0;
      stats.doorsKnocked = parseInt(doors.value?.rows[0]?.count) || 0;
    } catch {}

    res.json({ ...c, stats });
  } catch (err) {
    console.error('Dashboard profile error:', err.message);
    res.status(500).json({ error: 'Could not load profile', detail: err.message });
  }
});

// GET /api/dashboard/checklist
router.get('/checklist', async (req, res) => {
  const candidateId = req.candidate?.id;

  // Default checklist — will be personalized based on candidate state
  const defaultChecklist = [
    { id: 'account_created', category: 'Setup', text: 'Create Party of You account', required: true },
    { id: 'pledge_signed', category: 'Setup', text: 'Sign the platform pledge', required: true },
    { id: 'get_ein', category: 'Legal', text: 'Get your EIN from the IRS (Form SS-4)', urgent: true, link: 'https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online' },
    { id: 'bank_account', category: 'Legal', text: 'Open a campaign bank account' },
    { id: 'register_committee', category: 'Legal', text: 'Register campaign committee with your state', urgent: true },
    { id: 'po_box', category: 'Setup', text: 'Get a campaign PO Box' },
    { id: 'file_candidacy', category: 'Ballot', text: 'File candidacy papers with your election office', urgent: true },
    { id: 'petition_signatures', category: 'Ballot', text: 'Start collecting petition signatures' },
    { id: 'voter_file', category: 'Outreach', text: 'Request your state voter file' },
    { id: 'campaign_website', category: 'Comms', text: 'Set up your campaign website' },
    { id: 'social_media', category: 'Comms', text: 'Set up campaign social media accounts' },
    { id: 'first_event', category: 'Outreach', text: 'Schedule your first public event' },
    { id: 'first_volunteer', category: 'Outreach', text: 'Recruit your first volunteer' },
    { id: 'press_release', category: 'Comms', text: 'Send announcement press release' },
  ];

  // Mark items done based on candidate record
  if (req.db && candidateId) {
    try {
      const candidate = await req.db.query(
        `SELECT c.*, cp.pledged_at,
          (SELECT COUNT(*) FROM volunteers WHERE candidate_id = c.id) as vol_count,
          (SELECT COUNT(*) FROM events WHERE candidate_id = c.id) as event_count
         FROM candidates c
         LEFT JOIN candidate_pledges cp ON cp.candidate_id = c.id
         WHERE c.id = $1`,
        [candidateId]
      );
      const c = candidate.rows[0];

      const completedIds = new Set([
        'account_created',
        ...(c?.pledged_at ? ['pledge_signed'] : []),
        ...(parseInt(c?.vol_count) > 0 ? ['first_volunteer'] : []),
        ...(parseInt(c?.event_count) > 0 ? ['first_event'] : []),
      ]);

      const checklist = defaultChecklist.map(task => ({
        ...task,
        done: completedIds.has(task.id),
      }));

      const done = checklist.filter(t => t.done).length;
      return res.json({
        tasks: checklist,
        completed: done,
        total: checklist.length,
        pct: Math.round((done / checklist.length) * 100),
      });
    } catch (err) {
      // Fall through to default
    }
  }

  const done = 2; // account_created + pledge_signed assumed done since they're logged in
  res.json({
    tasks: defaultChecklist.map((t, i) => ({ ...t, done: i < 2 })),
    completed: done,
    total: defaultChecklist.length,
    pct: Math.round((done / defaultChecklist.length) * 100),
  });
});

module.exports = router;

// PATCH /api/dashboard/profile — update candidate profile
router.patch('/profile', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  const {
    full_name, preferred_name, bio, phone,
    address, city, state, zip,
    campaign_address, campaign_city, campaign_state, campaign_zip,
    campaign_email, campaign_phone, campaign_website,
    fec_committee_id, subdomain, password,
    office_sought, race_id,
  } = req.body;

  try {
    // Update users table
    await db.query(`
      UPDATE users SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        address = COALESCE($3, address),
        city = COALESCE($4, city),
        state = COALESCE($5, state),
        zip = COALESCE($6, zip)
      WHERE id = (SELECT user_id FROM candidates WHERE id = $7)
    `, [full_name, phone, address, city, state, zip, candidateId]);

    // Update candidates table
    await db.query(`
      UPDATE candidates SET
        full_name = COALESCE($1, full_name),
        preferred_name = $2,
        bio = $3,
        campaign_email = $4,
        campaign_phone = $5,
        campaign_website = $6,
        fec_committee_id = $7,
        subdomain = $8,
        office_sought = COALESCE($9, office_sought),
        race_id = COALESCE($10, race_id),
        updated_at = NOW()
      WHERE id = $11
    `, [
      full_name, preferred_name || null, bio || null,
      campaign_email || null, campaign_phone || null,
      campaign_website || null, fec_committee_id || null,
      subdomain || null,
      office_sought || null, race_id || null,
      candidateId,
    ]);

    // Update campaign address fields if columns exist
    try {
      await db.query(`
        UPDATE candidates SET
          campaign_address = $1,
          campaign_city = $2,
          campaign_state = $3,
          campaign_zip = $4
        WHERE id = $5
      `, [
        campaign_address || null, campaign_city || null,
        campaign_state || null, campaign_zip || null,
        candidateId,
      ]);
    } catch (e) {
      // Columns may not exist yet — non-fatal
    }

    // Update password if provided
    if (password && password.length >= 10) {
      const bcrypt = require('bcrypt');
      const hash = await bcrypt.hash(password, 12);
      await db.query(
        'UPDATE users SET password_hash = $1 WHERE id = (SELECT user_id FROM candidates WHERE id = $2)',
        [hash, candidateId]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Profile update error:', err.message);
    res.status(500).json({ error: 'Profile update failed', detail: err.message });
  }
});
