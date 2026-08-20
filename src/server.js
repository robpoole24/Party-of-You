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
const { requireAdmin, requireCandidate, adminLogin, candidateLogin, logout } = require('./middleware/auth');

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

// Admin files — never cache (always need fresh JS/HTML)
app.use('/admin', express.static(path.join(__dirname, '../public/admin'), {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  },
}));

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
  const { verifyToken } = require('./middleware/auth');
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
app.use('/api/races', featureGuard('FEATURE_OPEN_SEAT_TRACKER'), require('./routes/races'));

// Module 5: District Intelligence
app.use('/api/intelligence', featureGuard('FEATURE_POLLING_INTELLIGENCE'), require('./routes/intelligence'));

// ─────────────────────────────────────────────────
// CANDIDATE DASHBOARD GUARD
// Serves public/dashboard/index.html for authenticated candidates
// ─────────────────────────────────────────────────
app.use('/dashboard', (req, res, next) => {
  const jwt = require('jsonwebtoken');
  const token = req.cookies?.poy_token ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7) : null);

  if (!token) return res.redirect('/apply.html?redirect=/dashboard/');

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'candidate') return res.redirect('/apply.html');
    // Serve the dashboard HTML directly — don't fall through to SPA catch-all
    return res.sendFile(path.join(__dirname, '../public/dashboard/index.html'));
  } catch {
    return res.redirect('/apply.html?redirect=/dashboard/');
  }
});

// ─────────────────────────────────────────────────
// PROTECTED CANDIDATE API ROUTES
// ─────────────────────────────────────────────────
app.use('/api/dashboard', requireCandidate, require('./routes/dashboard'));

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
