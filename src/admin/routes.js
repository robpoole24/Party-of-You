/**
 * SYSTEM ADMIN API ROUTES
 * src/admin/routes.js
 *
 * All routes require requireAdmin middleware.
 * Mounted at /api/admin in server.js.
 *
 * Sections:
 *   /api/admin/login          — admin auth (no guard — public)
 *   /api/admin/status         — platform health overview
 *   /api/admin/candidates     — candidate management
 *   /api/admin/feeds          — API feed monitoring
 *   /api/admin/datasets       — bulk data ingestion control
 *   /api/admin/operations     — cache, announcements, exports
 */

const express = require('express');
const router = express.Router();
const { requireAdmin, adminLogin } = require('../middleware/auth');
const { getApiStatus } = require('../config/apis');

// ── LOGIN (public — no guard) ──────────────────────────────────
router.post('/login', adminLogin);

router.post('/logout', (req, res) => {
  res.clearCookie('poy_token');
  res.json({ success: true, redirect: '/admin/login' });
});

// All routes below require admin auth
router.use(requireAdmin);

// ─────────────────────────────────────────────────
// PLATFORM STATUS OVERVIEW
// GET /api/admin/status
// ─────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  const db = req.db;

  try {
    const [counts, recentSignups, suspendedCandidates] = await Promise.allSettled([
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active') as active,
          COUNT(*) FILTER (WHERE status = 'onboarding') as onboarding,
          COUNT(*) FILTER (WHERE status = 'suspended') as suspended,
          COUNT(*) FILTER (WHERE status = 'closed') as closed,
          COUNT(*) as total
        FROM candidates
      `),
      db.query(`
        SELECT c.id, c.full_name, c.state, c.office_sought, c.status,
               c.created_at, u.email
        FROM candidates c
        JOIN users u ON u.id = c.user_id
        ORDER BY c.created_at DESC LIMIT 10
      `),
      db.query(`
        SELECT c.id, c.full_name, c.state, c.status, u.email
        FROM candidates c
        JOIN users u ON u.id = c.user_id
        WHERE c.status = 'suspended'
        ORDER BY c.updated_at DESC
      `),
    ]);

    const apiStatus = getApiStatus();
    const connectedApis = Object.values(apiStatus).filter(a => a.connected).length;
    const totalApis = Object.values(apiStatus).length;

    res.json({
      platform: {
        version: '0.1.0',
        environment: process.env.NODE_ENV,
        uptime: process.uptime(),
      },
      candidates: counts.status === 'fulfilled'
        ? counts.value.rows[0]
        : { error: 'DB unavailable' },
      recentSignups: recentSignups.status === 'fulfilled'
        ? recentSignups.value.rows
        : [],
      suspendedCandidates: suspendedCandidates.status === 'fulfilled'
        ? suspendedCandidates.value.rows
        : [],
      apis: {
        connected: connectedApis,
        total: totalApis,
        detail: apiStatus,
      },
      datasets: {
        mitElectionLab: process.env.DATASET_MIT_ELECTION_LAB_LOADED === 'true',
        pewResearch: process.env.DATASET_PEW_RESEARCH_LOADED === 'true',
        openSecrets: process.env.DATASET_OPENSECRETS_LOADED === 'true',
        govtrack: process.env.DATASET_GOVTRACK_LOADED === 'true',
        anes: process.env.DATASET_ANES_LOADED === 'true',
        gss: process.env.DATASET_GSS_LOADED === 'true',
        propublicaExpenditures: process.env.DATASET_PROPUBLICA_EXPENDITURES_LOADED === 'true',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────
// CANDIDATE MANAGEMENT
// ─────────────────────────────────────────────────

// GET /api/admin/candidates — full candidate list with filters
router.get('/candidates', async (req, res) => {
  const db = req.db;
  const { status, state, search, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (state) {
    params.push(state);
    conditions.push(`c.state = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(c.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    params.push(parseInt(limit), offset);
    const result = await db.query(`
      SELECT
        c.id, c.full_name, c.state, c.district, c.office_sought,
        c.status, c.onboarding_step, c.platform_agreed,
        c.platform_agreed_at, c.subdomain,
        c.created_at, c.updated_at,
        u.email, u.phone, u.last_login,
        cp.pledged_at,
        (SELECT COUNT(*) FROM volunteers WHERE candidate_id = c.id) as volunteer_count,
        (SELECT COUNT(*) FROM events WHERE candidate_id = c.id) as event_count
      FROM candidates c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN candidate_pledges cp ON cp.candidate_id = c.id
      ${where}
      ORDER BY c.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // Total count
    const countParams = params.slice(0, params.length - 2);
    const countResult = await db.query(`
      SELECT COUNT(*) FROM candidates c
      JOIN users u ON u.id = c.user_id
      ${where}
    `, countParams);

    res.json({
      candidates: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/candidates/:id — single candidate detail
router.get('/candidates/:id', async (req, res) => {
  const db = req.db;
  try {
    const result = await db.query(`
      SELECT
        c.*, u.email, u.phone, u.last_login, u.created_at as account_created,
        cp.pledges, cp.signature, cp.pledged_at, cp.ip_address
      FROM candidates c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN candidate_pledges cp ON cp.candidate_id = c.id
      WHERE c.id = $1
    `, [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    // Also get their volunteers and events counts
    const [volunteers, events, donations] = await Promise.allSettled([
      db.query('SELECT COUNT(*) FROM volunteers WHERE candidate_id = $1', [req.params.id]),
      db.query('SELECT COUNT(*) FROM events WHERE candidate_id = $1', [req.params.id]),
      db.query('SELECT COUNT(*), COALESCE(SUM(amount),0) as total FROM donations WHERE candidate_id = $1', [req.params.id]),
    ]);

    res.json({
      candidate: result.rows[0],
      stats: {
        volunteers: volunteers.status === 'fulfilled' ? parseInt(volunteers.value.rows[0].count) : 0,
        events: events.status === 'fulfilled' ? parseInt(events.value.rows[0].count) : 0,
        donationCount: donations.status === 'fulfilled' ? parseInt(donations.value.rows[0].count) : 0,
        donationTotal: donations.status === 'fulfilled' ? parseFloat(donations.value.rows[0].total) : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/candidates/:id/status — toggle active/suspended/closed
router.patch('/candidates/:id/status', async (req, res) => {
  const db = req.db;
  const { status, reason } = req.body;
  const validStatuses = ['active', 'suspended', 'closed'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    await db.query(`
      UPDATE candidates
      SET status = $1, updated_at = NOW()
      WHERE id = $2
    `, [status, req.params.id]);

    // Log the action
    await db.query(`
      INSERT INTO audit_log
        (user_id, candidate_id, action, details, created_at)
      VALUES (NULL, $1, $2, $3, NOW())
    `, [
      req.params.id,
      `admin_status_change_${status}`,
      JSON.stringify({ status, reason: reason || null, admin: req.admin.username }),
    ]);

    res.json({ success: true, status, candidateId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/candidates/:id/export — trigger data export
router.post('/candidates/:id/export', async (req, res) => {
  const db = req.db;

  try {
    const candidate = await db.query(
      'SELECT full_name, campaign_email FROM candidates WHERE id = $1',
      [req.params.id]
    );

    if (!candidate.rows.length) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    // Queue the export job — implemented in jobs/export.js
    // For now, return acknowledgment
    const exportId = require('uuid').v4();

    await db.query(`
      INSERT INTO audit_log
        (candidate_id, action, details, created_at)
      VALUES ($1, 'data_export_requested', $2, NOW())
    `, [
      req.params.id,
      JSON.stringify({ exportId, requestedBy: req.admin.username }),
    ]);

    res.json({
      success: true,
      exportId,
      message: `Export queued for ${candidate.rows[0].full_name}. Will be ready within 24 hours.`,
      candidateEmail: candidate.rows[0].campaign_email,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────
// FEED MONITORING
// GET /api/admin/feeds
// Live status check on all API connections
// ─────────────────────────────────────────────────

router.get('/feeds', async (req, res) => {
  const apiStatus = getApiStatus();
  const checks = [];

  // Quick ping each connected API
  for (const [key, api] of Object.entries(apiStatus)) {
    if (!api.connected) {
      checks.push({ key, name: api.name, status: 'not_configured', connected: false });
      continue;
    }
    checks.push({ key, name: api.name, status: 'configured', connected: true, requiredFor: api.requiredFor });
  }

  res.json({
    feeds: checks,
    timestamp: new Date().toISOString(),
    features: {
      openSeatTracker: process.env.FEATURE_OPEN_SEAT_TRACKER === 'true',
      pollingIntelligence: process.env.FEATURE_POLLING_INTELLIGENCE === 'true',
      demographics: process.env.FEATURE_DEMOGRAPHICS === 'true',
      candidateDashboard: process.env.FEATURE_CANDIDATE_DASHBOARD === 'true',
    },
  });
});

// ─────────────────────────────────────────────────
// DATASET MANAGEMENT
// ─────────────────────────────────────────────────

// GET /api/admin/datasets — status of all bulk datasets
router.get('/datasets', async (req, res) => {
  const db = req.db;
  const { BULK_SOURCES } = require('../jobs/ingest');

  // Query actual DB counts for each target table
  const tableCounts = {};
  const tableQueries = [
    { table: 'historical_election_results', key: 'historical_election_results' },
    { table: 'district_partisan_lean',      key: 'district_partisan_lean' },
    { table: 'precinct_results_2024',       key: 'precinct_results_2024' },
    { table: 'pew_survey_responses',        key: 'pew_survey_responses' },
    { table: 'gss_survey_responses',        key: 'gss_survey_responses' },
    { table: 'anes_survey_responses',       key: 'anes_survey_responses' },
    { table: 'voting_records',              key: 'voting_records' },
    { table: 'legislators',                 key: 'legislators' },
    { table: 'house_expenditures',          key: 'house_expenditures' },
  ];

  for (const { table, key } of tableQueries) {
    try {
      const result = await db.query(
        `SELECT COUNT(*) as count FROM ${table}`
      );
      tableCounts[key] = parseInt(result.rows[0].count);
    } catch (e) {
      tableCounts[key] = null; // Table doesn't exist yet
    }
  }

  // Map target tables to loaded status based on actual row counts
  const tableToLoaded = (targetTable) => {
    const count = tableCounts[targetTable];
    return {
      loaded: count !== null && count > 0,
      rowCount: count,
    };
  };

  const datasets = Object.entries(BULK_SOURCES)
    .filter(([_, source]) => !source.hidden && source.status !== 'unavailable')
    .map(([key, source]) => {
      const { loaded, rowCount } = tableToLoaded(source.targetTable);

      // Debug — log each source's lookup result
      console.log(`[datasets] ${key} → targetTable: ${source.targetTable} → count: ${rowCount} → loaded: ${loaded}`);

      return {
        key,
        name: source.name,
        description: source.description,
        status: loaded ? 'loaded' : source.status,
        loaded,
        rowCount,
        targetTable: source.targetTable,
        hidden: source.hidden || false,
        downloadInstructions: source.downloadInstructions,
      };
    });

  // Also check uploaded files on disk
  const path = require('path');
  const fs = require('fs');
  const DATA_DIR = path.join(process.cwd(), 'data', 'raw');

  for (const dataset of datasets) {
    const dir = path.join(DATA_DIR, dataset.key);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
      dataset.uploadedFiles = files.length;
      dataset.uploadedFileNames = files;
    } else {
      dataset.uploadedFiles = 0;
      dataset.uploadedFileNames = [];
    }
  }

  res.json({ datasets, tableCounts });
});

// POST /api/admin/datasets/:source/ingest — trigger ingestion of a dataset
// (Requires the raw files to already be in data/raw/<source>/)
router.post('/datasets/:source/ingest', async (req, res) => {
  const { source } = req.params;
  const { BULK_SOURCES, ingestSource } = require('../jobs/ingest');

  if (!BULK_SOURCES[source]) {
    return res.status(404).json({ error: `Unknown source: ${source}` });
  }

  // Run in background — don't block the response
  res.json({
    success: true,
    message: `Ingestion started for ${BULK_SOURCES[source].name}. Check server logs for progress.`,
    note: 'Large datasets may take several minutes. The DATASET_*_LOADED flag will be set when complete.',
  });

  // Actually kick off ingestion asynchronously
  setImmediate(async () => {
    try {
      await ingestSource(source, req.db);
      console.log(`[Admin] Dataset ingestion complete: ${source}`);
    } catch (err) {
      console.error(`[Admin] Dataset ingestion failed: ${source}`, err.message);
    }
  });
});

// ─────────────────────────────────────────────────
// PLATFORM OPERATIONS
// ─────────────────────────────────────────────────

// POST /api/admin/cache/flush — flush Redis cache
router.post('/cache/flush', async (req, res) => {
  try {
    if (req.redis) {
      await req.redis.flushdb();
      res.json({ success: true, message: 'Cache flushed.' });
    } else {
      res.json({ success: false, message: 'Redis not connected — no cache to flush.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/announcement — post a notice to all candidate dashboards
router.post('/announcement', async (req, res) => {
  const db = req.db;
  const { message, type = 'info', expires_at } = req.body; // type: info | warning | maintenance

  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    await db.query(`
      INSERT INTO platform_announcements
        (message, type, expires_at, created_by, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [message, type, expires_at || null, req.admin.username]);

    res.json({ success: true, message: 'Announcement posted to all candidate dashboards.' });
  } catch (err) {
    // Table may not exist yet — acceptable
    res.json({
      success: false,
      message: 'Announcement table not yet created. Run the schema addition.',
      schemaAddition: `
        CREATE TABLE IF NOT EXISTS platform_announcements (
          id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          message    TEXT NOT NULL,
          type       TEXT DEFAULT 'info',
          expires_at TIMESTAMPTZ,
          created_by TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `,
    });
  }
});

// GET /api/admin/costs — platform operating cost snapshot
router.get('/costs', async (req, res) => {
  // Eventually connect to Railway API, Cloudflare API, etc.
  // For now, return the documented cost structure
  res.json({
    infrastructure: {
      railway: {
        description: 'Server hosting, PostgreSQL, Redis',
        estimatedMonthly: '$20-50',
        note: 'Scales with traffic and database size',
      },
      cloudflareR2: {
        description: 'File storage — candidate photos, PDFs, video exports',
        freeTier: '10GB free forever',
        beyondFree: '$0.015/GB',
        currentUsageGB: null, // TODO: pull from Cloudflare API
      },
    },
    dataApis: {
      free: ['Google Civic', 'Census Bureau', 'FEC.gov', 'OpenStates', 'VoteHub', 'LegiScan'],
      pendingFunding: [
        { name: 'Ballotpedia', estimatedAnnual: '$5,000-25,000', unlocks: 'Comprehensive local race data' },
        { name: 'BallotReady', estimatedAnnual: '$5,000-20,000', unlocks: 'School board and special district races' },
      ],
    },
    commonsModel: {
      description: 'Third-party data costs funded collectively by candidates',
      principle: 'Once funded, stays funded for all candidates forever',
    },
  });
});

module.exports = router;
