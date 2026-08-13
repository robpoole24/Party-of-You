/**
 * CANDIDATE SIGNUP & PLEDGE FLOW
 * src/auth/signup.js
 *
 * Five-step onboarding flow:
 *
 *   Step 1 — Basic info (name, email, password, phone, address)
 *   Step 2 — Address resolution → show available races
 *   Step 3 — Race selection
 *   Step 4 — Platform pledge (individual plank checkboxes + signature)
 *   Step 5 — Account confirmation + dashboard access
 *
 * The pledge record is stored permanently in candidate_pledges table.
 * It is included in the candidate's data export if they leave.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { signToken, setAuthCookie } = require('../middleware/auth');
const { resolveAddress } = require('../data-layer/geographic');
const { getRacesForCandidate } = require('../data-layer/open-seats');

const SALT_ROUNDS = 12;

// ─────────────────────────────────────────────────
// STEP 1: REGISTER BASIC INFO
// POST /api/auth/register
// Creates user + candidate records, returns partial token
// for completing onboarding
// ─────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const db = req.db;
  const {
    email,
    password,
    full_name,
    phone,
    address,
    city,
    state,
    zip,
  } = req.body;

  // Validation
  const errors = [];
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email required');
  if (!password || password.length < 10) errors.push('Password must be at least 10 characters');
  if (!full_name || full_name.trim().length < 2) errors.push('Full name required');
  if (!address) errors.push('Street address required');
  if (!city) errors.push('City required');
  if (!state) errors.push('State required');

  if (errors.length) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    // Check for existing account
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [cleanEmail]
    );
    if (existing.rows.length) {
      return res.status(409).json({
        error: 'An account with this email already exists.',
        action: 'login',
      });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user record
    const userResult = await db.query(`
      INSERT INTO users
        (email, password_hash, role, full_name, phone, address, city, state, zip,
         email_verified, is_active, created_at)
      VALUES ($1, $2, 'candidate', $3, $4, $5, $6, $7, $8, false, true, NOW())
      RETURNING id
    `, [cleanEmail, password_hash, full_name.trim(), phone, address, city, state, zip]);

    const userId = userResult.rows[0].id;

    // Create candidate record
    const candidateResult = await db.query(`
      INSERT INTO candidates
        (user_id, full_name, campaign_email, state, status, onboarding_step, created_at)
      VALUES ($1, $2, $3, $4, 'onboarding', 1, NOW())
      RETURNING id
    `, [userId, full_name.trim(), cleanEmail, state]);

    const candidateId = candidateResult.rows[0].id;

    // Issue onboarding token
    const token = signToken({
      role: 'candidate',
      userId,
      candidateId,
      email: cleanEmail,
      status: 'onboarding',
    });

    setAuthCookie(res, token);

    res.json({
      success: true,
      candidateId,
      nextStep: 2,
      message: 'Account created. Next: find your races.',
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────
// STEP 2: RESOLVE ADDRESS → AVAILABLE RACES
// POST /api/auth/onboarding/races
// Returns races the candidate can run for
// ─────────────────────────────────────────────────

router.post('/onboarding/races', async (req, res) => {
  const { address } = req.body;

  if (!address) {
    return res.status(400).json({ error: 'Address required' });
  }

  try {
    const geography = await resolveAddress(address);
    const raceBundle = await getRacesForCandidate(geography);

    res.json({
      success: true,
      geography: {
        state: geography.state,
        districts: geography.districts,
        normalizedAddress: geography.normalizedAddress,
        county: geography.county,
        city: geography.city,
      },
      races: raceBundle.races,
      summary: {
        totalRaces: raceBundle.totalRaces,
        openSeats: raceBundle.openSeats,
      },
    });
  } catch (err) {
    console.error('Race lookup error:', err);
    res.status(500).json({ error: 'Could not resolve address. Please check and try again.' });
  }
});

// ─────────────────────────────────────────────────
// STEP 3: SELECT RACE
// POST /api/auth/onboarding/select-race
// Saves the selected race to the candidate record
// ─────────────────────────────────────────────────

router.post('/onboarding/select-race', async (req, res) => {
  const db = req.db;
  const { candidateId, raceId, office, level, state, district } = req.body;

  if (!candidateId || !raceId) {
    return res.status(400).json({ error: 'Candidate ID and race ID required' });
  }

  try {
    await db.query(`
      UPDATE candidates
      SET race_id = $1,
          office_sought = $2,
          district = $3,
          state = COALESCE($4, state),
          onboarding_step = GREATEST(onboarding_step, 3),
          updated_at = NOW()
      WHERE id = $5
    `, [raceId, office, district, state, candidateId]);

    res.json({ success: true, nextStep: 4 });
  } catch (err) {
    console.error('Race selection error:', err);
    res.status(500).json({ error: 'Could not save race selection.' });
  }
});

// ─────────────────────────────────────────────────
// STEP 4: SUBMIT PLATFORM PLEDGE
// POST /api/auth/onboarding/pledge
//
// Body:
//   candidateId    — UUID
//   pledges        — object { plank_1: true, plank_2: true, ... plank_8: true,
//                             no_corporate_money: true, exclusions_read: true }
//   signature      — string (typed full name)
//
// All 10 checkboxes must be true. Signature must match their full name.
// Pledge record is stored permanently and timestamped.
// ─────────────────────────────────────────────────

const REQUIRED_PLEDGES = [
  'plank_1',  // Healthcare is a human right
  'plank_2',  // Workers before shareholders
  'plank_3',  // Housing is a necessity
  'plank_4',  // Public education fully funded
  'plank_5',  // Climate action
  'plank_6',  // Civil rights non-negotiable
  'plank_7',  // Democracy belongs to people
  'plank_8',  // Wealthy pay their share
  'no_corporate_money',    // No PAC/dark money
  'exclusions_acknowledged', // Read and understood the exclusions
];

const PLANK_LABELS = {
  plank_1: 'Healthcare is a human right',
  plank_2: 'Workers come before shareholders',
  plank_3: 'Housing is a necessity, not an investment vehicle',
  plank_4: 'Public education must be fully funded',
  plank_5: 'The climate crisis demands immediate action',
  plank_6: 'Civil rights are non-negotiable',
  plank_7: 'Democracy belongs to people, not donors',
  plank_8: 'Wealthy individuals and corporations must pay their share',
  no_corporate_money: 'I will not accept corporate PAC or dark money contributions',
  exclusions_acknowledged: 'I have read and understood who this platform is not for',
};

router.post('/onboarding/pledge', async (req, res) => {
  const db = req.db;
  const { candidateId, pledges, signature, ipAddress } = req.body;

  if (!candidateId || !pledges || !signature) {
    return res.status(400).json({ error: 'Candidate ID, pledges, and signature required' });
  }

  // Verify all required pledges are checked
  const missing = REQUIRED_PLEDGES.filter(key => !pledges[key]);
  if (missing.length) {
    return res.status(400).json({
      error: 'All platform planks must be acknowledged',
      missing: missing.map(k => PLANK_LABELS[k]),
    });
  }

  // Verify signature matches candidate's full name
  try {
    const candidateResult = await db.query(
      'SELECT full_name FROM candidates WHERE id = $1',
      [candidateId]
    );

    if (!candidateResult.rows.length) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    const fullName = candidateResult.rows[0].full_name;
    const sigNormalized = signature.trim().toLowerCase().replace(/\s+/g, ' ');
    const nameNormalized = fullName.trim().toLowerCase().replace(/\s+/g, ' ');

    if (sigNormalized !== nameNormalized) {
      return res.status(400).json({
        error: 'Signature must match your full name exactly as entered during registration.',
        expected: fullName,
      });
    }

    // Record the pledge permanently
    const pledgedAt = new Date().toISOString();
    const userAgent = req.headers['user-agent'] || '';
    const ip = ipAddress || req.ip || req.connection?.remoteAddress || '';

    await db.query(`
      INSERT INTO candidate_pledges
        (candidate_id, pledges, signature, pledged_at, ip_address, user_agent, platform_version)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (candidate_id)
      DO UPDATE SET
        pledges = EXCLUDED.pledges,
        signature = EXCLUDED.signature,
        pledged_at = EXCLUDED.pledged_at,
        ip_address = EXCLUDED.ip_address,
        platform_version = EXCLUDED.platform_version
    `, [
      candidateId,
      JSON.stringify({
        ...pledges,
        labels: PLANK_LABELS,
        platformVersion: '1.0',
        timestamp: pledgedAt,
      }),
      signature.trim(),
      pledgedAt,
      ip,
      userAgent,
      '1.0',
    ]);

    // Mark platform agreed on candidate record
    await db.query(`
      UPDATE candidates
      SET platform_agreed = true,
          platform_agreed_at = NOW(),
          onboarding_step = GREATEST(onboarding_step, 4),
          status = 'active',
          updated_at = NOW()
      WHERE id = $1
    `, [candidateId]);

    // Mark step 5 complete — onboarding done
    await db.query(`
      UPDATE candidates
      SET onboarding_step = 5, updated_at = NOW()
      WHERE id = $1
    `, [candidateId]);

    res.json({
      success: true,
      pledgedAt,
      nextStep: 5,
      redirect: '/dashboard/',
      message: 'Platform pledge recorded. Welcome to Party of You.',
    });

  } catch (err) {
    console.error('Pledge error:', err);
    res.status(500).json({ error: 'Could not record pledge. Please try again.' });
  }
});

// ─────────────────────────────────────────────────
// SCHEMA ADDITIONS for this module
// Run these against your Railway PostgreSQL DB
// ─────────────────────────────────────────────────

const SCHEMA_ADDITIONS = `
-- Permanent pledge record
CREATE TABLE IF NOT EXISTS candidate_pledges (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id      UUID REFERENCES candidates(id) ON DELETE CASCADE,
  pledges           JSONB NOT NULL,
  signature         TEXT NOT NULL,
  pledged_at        TIMESTAMPTZ NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  platform_version  TEXT DEFAULT '1.0',
  UNIQUE(candidate_id)
);

-- Add cookie support to server.js
-- npm install cookie-parser
-- app.use(require('cookie-parser')())
`;

module.exports = router;
module.exports.PLANK_LABELS = PLANK_LABELS;
module.exports.SCHEMA_ADDITIONS = SCHEMA_ADDITIONS;
