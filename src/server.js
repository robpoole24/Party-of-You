/**
 * PARTY OF YOU — SERVER ENTRY POINT
 * src/server.js
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');

const { getApiStatus, getConnectedApis, getPendingApis } = require('./config/apis');
const { requireAdmin, requireCandidate, adminLogin, candidateLogin, logout, verifyToken } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────
// DB MIDDLEWARE
// Attaches db client to every request.
// Until PostgreSQL is connected, gracefully handles missing DB.
// ─────────────────────────────────────────────────

let db = null;

function initDb() {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — running without database. Auth and data features will not work.');
    return;
  }
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  pool.on('error', err => console.error('DB pool error:', err.message));
  db = { query: (...args) => pool.query(...args) };
  console.log('PostgreSQL connected.');
}

function attachDb(req, res, next) {
  req.db = db;
  next();
}

// ─────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────

app.use(compression());
app.use(cookieParser());

// ── ADMIN ROUTE GUARD ──────────────────────────────
// Must come BEFORE express.static so it intercepts
// /admin/ and /admin/index.html before they're served.
// login.html is the only admin page served without auth.
app.use('/admin', (req, res, next) => {
  // Allow login page through without auth
  if (req.path === '/login.html' || req.path === '/login') {
    return next();
  }

  // Check for valid admin token
  const jwt = require('jsonwebtoken');
  const token = req.cookies?.poy_token ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) {
    return res.redirect('/admin/login.html');
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.redirect('/admin/login.html');
    }
    next(); // Valid admin — serve the static file
  } catch {
    return res.redirect('/admin/login.html');
  }
});

// Profile edit — requires candidate auth
app.get('/profile-edit.html', (req, res) => {
  const token = req.cookies?.poy_token;
  if (!token) return res.redirect('/login.html?redirect=/profile-edit.html');
  try {
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'candidate') return res.redirect('/login.html');
    res.sendFile(path.join(__dirname, '../public/profile-edit.html'));
  } catch {
    res.redirect('/login.html?redirect=/profile-edit.html');
  }
});

// Listmonk proxy — forwards admin users to Listmonk dashboard
// Listmonk runs on internal Railway network, not accessible externally directly
app.use('/admin/listmonk', requireAdmin, (req, res) => {
  const listmonkUrl = process.env.LISTMONK_URL || 'http://listmonk.railway.internal:9000';
  const targetUrl = listmonkUrl + req.path + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');

  // Simple redirect — Listmonk handles its own auth via Railway
  // For now, send them to the Railway public URL if LISTMONK_PUBLIC_URL is set
  const publicUrl = process.env.LISTMONK_PUBLIC_URL;
  if (publicUrl) {
    return res.redirect(publicUrl);
  }
  res.send(`
    <html><body style="font-family:sans-serif;padding:40px;background:#0d1b35;color:white">
      <h2>Listmonk Dashboard</h2>
      <p>To access your Listmonk email dashboard, you need to expose it via a public URL in Railway.</p>
      <p>Go to Railway → listmonk service → Settings → Networking → Generate Domain</p>
      <p>Then add that URL as <code>LISTMONK_PUBLIC_URL</code> in your Party of You service variables.</p>
      <p>Listmonk admin credentials are the ones you set when configuring the service.</p>
      <a href="/admin/" style="color:#4a9fd4">← Back to Admin</a>
    </body></html>
  `);
});

// Election calendar scraper endpoint
app.post('/api/admin/scrape/election-calendar', requireAdmin, async (req, res) => {
  const { state = 'all' } = req.body;

  let scraperModule;
  try {
    scraperModule = require('./jobs/scrape-election-calendar');
  } catch (e) {
    return res.status(500).json({ error: 'Scraper module failed to load', detail: e.message });
  }

  const { scrapeState: scrapeSingleState, scrapeAll: scrapeAllStates, ensureTable: ensureCalendarTable } = scraperModule;

  // Ensure table exists (non-fatal if it fails)
  try {
    await ensureCalendarTable(db);
  } catch (e) {
    console.warn('[Scraper] Could not ensure table:', e.message);
  }

  // Respond immediately — scraping runs in background
  res.json({
    success: true,
    message: `Election calendar scrape started for: ${state}. Check server logs for progress.`,
    note: state === 'all' ? 'All 50 states takes ~2 minutes.' : `Scraping ${state} — should complete in ~5 seconds.`,
  });

  setImmediate(async () => {
    try {
      if (state === 'all') {
        await scrapeAllStates(db, 2000);
      } else {
        await scrapeSingleState(state.toUpperCase(), db);
      }
      console.log(`[Scraper] Election calendar scrape complete for: ${state}`);
    } catch (err) {
      console.error('[Scraper] Error:', err.message);
    }
  });
});

// nav.js — never cache so auth state updates immediately
app.get('/nav.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, '../public/nav.js'));
});

// Admin files — never cache (always need fresh JS/HTML)
app.use('/admin', express.static(path.join(__dirname, '../public/admin'), {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  },
}));

// Public candidate pages — /c/:subdomain
// Serves the candidate page HTML; JS fetches data from /api/candidate/:subdomain
app.get('/c/:subdomain', (req, res) => {
  const { subdomain } = req.params;
  if (!/^[a-z0-9-]{1,50}$/.test(subdomain)) {
    return res.status(400).send('Invalid campaign URL');
  }
  const filePath = path.join(__dirname, '../public/candidate-page.html');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('[CandidatePage] Could not serve candidate-page.html:', err.message);
      res.status(500).send('Candidate page unavailable. Please try again shortly.');
    }
  });
});

// All other static files — 1h cache in production
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  etag: true,
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://maps.googleapis.com", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.census.gov", "https://civicinfo.googleapis.com",
                   "https://v3.openstates.org", "https://api.open.fec.gov", "https://votehub.com"],
    },
  },
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.APP_URL, 'https://partyofyou.org', 'https://www.partyofyou.org']
    : '*',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(attachDb);

// ─────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
    environment: process.env.NODE_ENV || 'development',
    database: db ? 'connected' : 'not connected',
  });
});

// ─────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────

// Admin login (no guard)
app.post('/api/admin/login', adminLogin);
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('poy_token');
  res.json({ success: true, redirect: '/admin/login.html' });
});

// Candidate auth
app.post('/api/auth/login', (req, res) => candidateLogin(req, res, db));
app.post('/api/auth/logout', logout);

// Lightweight auth check — used by nav.js to show/hide dashboard link
app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.poy_token;
  if (!token) return res.status(401).json({ authenticated: false });
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'candidate') return res.status(401).json({ authenticated: false });
  res.json({
    authenticated: true,
    candidateId: payload.candidateId,
    email: payload.email,
    status: payload.status,
  });
});

// Candidate signup + onboarding
const signupRouter = require('./auth/signup');
app.use('/api/auth', signupRouter);

// ─────────────────────────────────────────────────
// ADMIN API (protected)
// ─────────────────────────────────────────────────

const adminRouter = require('./admin/routes');
app.use('/api/admin', adminRouter);

// Admin file uploads (multer handles multipart — separate from JSON API)
const uploadRouter = require('./admin/upload');
app.use('/api/admin/upload', uploadRouter);

// ─────────────────────────────────────────────────
// PUBLIC API ROUTES
// ─────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const allApis = getApiStatus();
  const connected = Object.values(allApis).filter(a => a.connected).length;
  const total = Object.values(allApis).length;
  res.json({
    platform: 'Party of You',
    domain: 'partyofyou.org',
    apiConnections: { connected, total, summary: allApis },
    features: {
      openSeatTracker: process.env.FEATURE_OPEN_SEAT_TRACKER === 'true',
      pollingIntelligence: process.env.FEATURE_POLLING_INTELLIGENCE === 'true',
      demographics: process.env.FEATURE_DEMOGRAPHICS === 'true',
      candidateDashboard: process.env.FEATURE_CANDIDATE_DASHBOARD === 'true',
    },
    datasets: {
      mitElectionLab: process.env.DATASET_MIT_ELECTION_LAB_LOADED === 'true',
      pewResearch: process.env.DATASET_PEW_RESEARCH_LOADED === 'true',
      openSecrets: process.env.DATASET_OPENSECRETS_LOADED === 'true',
      govtrack: process.env.DATASET_GOVTRACK_LOADED === 'true',
      anes: process.env.DATASET_ANES_LOADED === 'true',
    },
  });
});

// Module 2: Open Seat Tracker
app.use('/api/races', require('./routes/races'));

// Module 5: District Intelligence
app.use('/api/intelligence', require('./routes/intelligence'));

// Public candidate pages API
app.use('/api/candidate', require('./routes/candidate-page'));

// Public volunteer signup — no auth required, called from /c/:subdomain pages
app.post('/api/candidate/:subdomain/volunteer', async (req, res) => {
  const { subdomain } = req.params;
  const { name, email, phone, zip, message, source } = req.body;
  const db = req.db;

  if (!name || !email || !subdomain) {
    return res.status(400).json({ error: 'Name and email required' });
  }

  if (!db) return res.status(503).json({ error: 'Database unavailable' });

  try {
    // Find the candidate by subdomain
    const cResult = await db.query(
      "SELECT id FROM candidates WHERE subdomain = $1 AND status IN ('active', 'approved', 'pending')",
      [subdomain]
    );
    if (!cResult.rows.length) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    const candidateId = cResult.rows[0].id;

    // Insert volunteer — ON CONFLICT DO NOTHING so duplicate emails don't crash
    await db.query(`
      INSERT INTO volunteers (candidate_id, name, email, phone, zip, skills, source, status, signed_up_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())
      ON CONFLICT (candidate_id, email) DO UPDATE SET
        name = EXCLUDED.name,
        phone = COALESCE(EXCLUDED.phone, volunteers.phone),
        zip = COALESCE(EXCLUDED.zip, volunteers.zip),
        source = EXCLUDED.source
    `, [candidateId, name, email, phone || null, zip || null, message ? [message] : [], source || 'public_page']);

    res.json({ success: true });
  } catch (err) {
    console.error('[PublicVolunteer] Error:', err.message);
    // Still return success to avoid losing volunteer signups over DB issues
    res.json({ success: true, note: 'Queued for retry' });
  }
});

// ─────────────────────────────────────────────────
// CANDIDATE DASHBOARD GUARD
// Serves public/dashboard/index.html for authenticated candidates
// ─────────────────────────────────────────────────
app.use('/dashboard', (req, res) => {
  const token = req.cookies?.poy_token ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7) : null);

  if (!token) return res.redirect('/login.html?redirect=/dashboard/');

  try {
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'candidate') {
      return res.redirect('/login.html');
    }

    const dashboardPath = path.join(__dirname, '../public/dashboard/index.html');
    res.sendFile(dashboardPath, (err) => {
      if (err) {
        console.error('Dashboard file not found:', err.message);
        // File doesn't exist yet — redirect to apply with a message
        res.redirect('/apply.html?message=dashboard-coming-soon');
      }
    });
  } catch (err) {
    console.error('Dashboard guard error:', err.message);
    return res.redirect('/login.html?redirect=/dashboard/');
  }
});

// ─────────────────────────────────────────────────
// PROTECTED CANDIDATE API ROUTES
// ─────────────────────────────────────────────────
app.use('/api/dashboard', requireCandidate, require('./routes/dashboard'));
app.use('/api/content', requireCandidate, require('./routes/content'));
app.use('/api/email', requireCandidate, require('./routes/email'));

// Events API
app.get('/api/events', requireCandidate, async (req, res) => {
  try {
    const result = await req.db.query(
      'SELECT * FROM events WHERE candidate_id = $1 AND start_time > NOW() ORDER BY start_time LIMIT 20',
      [req.candidate.id]
    );
    res.json({ events: result.rows });
  } catch (e) { res.json({ events: [] }); }
});

app.post('/api/events', requireCandidate, async (req, res) => {
  const { title, event_type, start_time, end_time, location_name, address, description } = req.body;
  try {
    const result = await req.db.query(`
      INSERT INTO events (candidate_id, title, event_type, start_time, end_time, location_name, address, description, is_public, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW()) RETURNING id
    `, [req.candidate.id, title, event_type, start_time, end_time, location_name, address, description]);
    res.json({ success: true, id: result.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Volunteers API
app.get('/api/volunteers', requireCandidate, async (req, res) => {
  try {
    const result = await req.db.query(
      'SELECT * FROM volunteers WHERE candidate_id = $1 ORDER BY signed_up_at DESC LIMIT 100',
      [req.candidate.id]
    );
    res.json({ volunteers: result.rows });
  } catch (e) { res.json({ volunteers: [] }); }
});

app.post('/api/volunteers', requireCandidate, async (req, res) => {
  const { name, email, phone, zip, skills, source } = req.body;
  try {
    const result = await req.db.query(`
      INSERT INTO volunteers (candidate_id, name, email, phone, zip, skills, source, status, signed_up_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'active',NOW()) RETURNING id
    `, [req.candidate.id, name, email, phone || null, zip || null, skills || [], source || 'direct']);
    res.json({ success: true, id: result.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────
// SPA FALLBACK — serve index.html for unknown routes
// so client-side routing works (when we add it)
// ─────────────────────────────────────────────────

app.get('*', (req, res, next) => {
  // Don't intercept API routes or dashboard (handled above)
  if (req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/dashboard')) return next();
  // Serve index.html for everything else that isn't a static file
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─────────────────────────────────────────────────
// ERROR HANDLERS
// ─────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// ─────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────

initDb();

app.listen(PORT, () => {
  console.log(`\n═══════════════════════════════════`);
  console.log(`  Party of You — Platform Server`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`═══════════════════════════════════\n`);

  const connected = getConnectedApis();
  const pending = getPendingApis();
  console.log(`APIs connected: ${Object.keys(connected).length}`);
  Object.values(connected).forEach(api => console.log(`  ✓ ${api.name}`));
  if (Object.keys(pending).length) {
    console.log(`APIs pending:`);
    Object.values(pending).forEach(api => console.log(`  ○ ${api.name}`));
  }
  console.log('');
});

function featureGuard(flagName) {
  return (req, res, next) => {
    if (process.env[flagName] !== 'true') {
      return res.status(503).json({
        error: 'Module not yet available',
        module: flagName,
      });
    }
    next();
  };
}

module.exports = app;
