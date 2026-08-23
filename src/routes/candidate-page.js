/**
 * PUBLIC CANDIDATE PAGE API
 * src/routes/candidate-page.js
 *
 * GET /api/candidate/:subdomain  — JSON data for public candidate page
 */

const express = require('express');
const router = express.Router();

// The 9 platform planks every candidate has pledged to
const PLATFORM_PLANKS = [
  {
    id: 'living_wage',
    icon: '💰',
    title: 'Living Wage for All',
    text: 'A minimum wage that covers the actual cost of living in your community — indexed to inflation, never falling behind.',
  },
  {
    id: 'healthcare',
    icon: '🏥',
    title: 'Healthcare as a Right',
    text: 'Universal access to healthcare. No one goes broke getting sick. No one skips a doctor because they can\'t afford it.',
  },
  {
    id: 'housing',
    icon: '🏠',
    title: 'Affordable Housing',
    text: 'Housing is a human need, not an investment vehicle. Policies that prioritize renters and first-time buyers over speculators.',
  },
  {
    id: 'clean_elections',
    icon: '🗳️',
    title: 'Clean Elections',
    text: 'No corporate money. No PAC money. Full financial transparency. Every dollar tracked and disclosed publicly.',
  },
  {
    id: 'environment',
    icon: '🌱',
    title: 'Environmental Justice',
    text: 'Clean air and water are not privileges. Communities bear the burden of pollution deserve the most protection from it.',
  },
  {
    id: 'education',
    icon: '📚',
    title: 'Quality Public Education',
    text: 'Fully funded public schools. Universal pre-K. Debt-free pathways to higher education and vocational training.',
  },
  {
    id: 'workers_rights',
    icon: '✊',
    title: 'Workers\' Rights',
    text: 'The right to organize. Overtime protections. Safe workplaces. An economy where workers share in the wealth they create.',
  },
  {
    id: 'police_accountability',
    icon: '⚖️',
    title: 'Accountable Public Safety',
    text: 'Public safety rooted in community trust. Civilian oversight, transparent use-of-force policies, and investment in root causes of crime.',
  },
  {
    id: 'corporate_accountability',
    icon: '🏛️',
    title: 'Corporate Accountability',
    text: 'Corporations that operate in our communities must be accountable to those communities — not just to shareholders.',
  },
];

// GET /api/candidate/:subdomain
router.get('/:subdomain', async (req, res) => {
  const { subdomain } = req.params;
  const db = req.db;

  if (!subdomain || !/^[a-z0-9-]{1,50}$/.test(subdomain)) {
    return res.status(400).json({ error: 'Invalid subdomain' });
  }

  if (!db) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    // Get candidate + user data
    const result = await db.query(`
      SELECT
        c.id, c.full_name, c.preferred_name, c.bio, c.photo_url,
        c.office_sought, c.district, c.state, c.subdomain, c.status,
        c.campaign_email, c.campaign_phone, c.campaign_website,
        c.fec_committee_id,
        u.city,
        cp.pledged_at
      FROM candidates c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN candidate_pledges cp ON cp.candidate_id = c.id
      WHERE c.subdomain = $1
        AND c.status IN ('active', 'approved', 'pending')
    `, [subdomain]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Candidate not found', subdomain });
    }

    const c = result.rows[0];

    // Get upcoming public events
    let events = [];
    try {
      const evtResult = await db.query(`
        SELECT id, title, event_type, start_time, end_time,
               location_name, address, description
        FROM events
        WHERE candidate_id = $1
          AND is_public = true
          AND start_time > NOW()
        ORDER BY start_time ASC
        LIMIT 5
      `, [c.id]);
      events = evtResult.rows;
    } catch (e) {
      console.warn('[CandidatePage] Events query failed:', e.message);
    }

    // Get volunteer count (social proof)
    let volunteerCount = 0;
    try {
      const volResult = await db.query(
        `SELECT COUNT(*) FROM volunteers WHERE candidate_id = $1 AND status = 'active'`,
        [c.id]
      );
      volunteerCount = parseInt(volResult.rows[0].count) || 0;
    } catch (e) {}

    // Get site settings (template, colors, donate config)
    let site = null;
    try {
      const siteResult = await db.query(
        'SELECT * FROM candidate_sites WHERE candidate_id = $1',
        [c.id]
      );
      if (siteResult.rows.length) site = siteResult.rows[0];
    } catch (e) { console.warn('[CandidatePage] Site settings failed:', e.message); }

    // Get pages and blocks
    let pages = [];
    try {
      const pagesResult = await db.query(
        'SELECT * FROM site_pages WHERE candidate_id = $1 AND is_enabled = TRUE ORDER BY sort_order',
        [c.id]
      );
      pages = pagesResult.rows;

      // Load blocks for each page
      for (const page of pages) {
        const blocksResult = await db.query(
          'SELECT * FROM site_blocks WHERE page_id = $1 AND is_visible = TRUE ORDER BY sort_order',
          [page.id]
        );
        page.blocks = blocksResult.rows;
      }
    } catch (e) { console.warn('[CandidatePage] Pages/blocks failed:', e.message); }

    // Get candidate issues
    let issues = [];
    try {
      const issuesResult = await db.query(
        'SELECT * FROM candidate_issues WHERE candidate_id = $1 AND is_published = TRUE ORDER BY sort_order',
        [c.id]
      );
      issues = issuesResult.rows;
    } catch (e) { console.warn('[CandidatePage] Issues failed:', e.message); }

    // Check for custom page uploads (served separately via /c/:subdomain/:page)
    let customPages = [];
    try {
      const cpResult = await db.query(
        'SELECT page_slug, cloudinary_url FROM candidate_custom_pages WHERE candidate_id = $1 AND is_active = TRUE',
        [c.id]
      );
      customPages = cpResult.rows;
    } catch (e) {}

    res.json({
      success: true,
      candidate: {
        fullName: c.full_name,
        preferredName: c.preferred_name,
        displayName: c.preferred_name || c.full_name,
        bio: c.bio,
        photoUrl: c.photo_url,
        officeSought: c.office_sought,
        district: c.district,
        state: c.state,
        city: c.city,
        subdomain: c.subdomain,
        campaignEmail: c.campaign_email,
        campaignPhone: c.campaign_phone,
        campaignWebsite: c.campaign_website,
        fecCommitteeId: c.fec_committee_id,
        pledgedAt: c.pledged_at,
      },
      site: site ? {
        template: site.template || 'hometown',
        accentColor: site.accent_color,
        fontHeading: site.font_heading,
        navStyle: site.nav_style || 'top',
        siteTitle: site.site_title,
        siteTagline: site.site_tagline,
        socialTwitter: site.social_twitter,
        socialFacebook: site.social_facebook,
        socialInstagram: site.social_instagram,
        socialYoutube: site.social_youtube,
        donateStripeUrl: site.donate_stripe_url,
        donatePaypalUrl: site.donate_paypal_url,
        donateVenmo: site.donate_venmo,
        donateCashAddress: site.donate_cash_address,
        donateFecNotice: site.donate_fec_notice,
        isPublished: site.is_published,
      } : null,
      pages,
      issues,
      customPages,
      platform: PLATFORM_PLANKS,
      events,
      volunteerCount,
    });

  } catch (err) {
    console.error('[CandidatePage] Error:', err.message);
    res.status(500).json({ error: 'Could not load candidate page' });
  }
});

module.exports = router;
