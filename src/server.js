/**
 * PARTY OF YOU — SERVER ENTRY POINT
 * src/server.js
 *
 * Express application. Railway boots this via `npm start`.
 * Starts with health check and API status endpoints so the
 * deploy succeeds even before modules are built out.
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const { getApiStatus, getConnectedApis, getPendingApis } = require('./config/apis');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────

app.use(compression());

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://maps.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.census.gov", "https://civicinfo.googleapis.com"],
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

// ─────────────────────────────────────────────────
// HEALTH CHECK — Railway uses this to confirm the
// container is alive. Must return 200 quickly.
// ─────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─────────────────────────────────────────────────
// API STATUS — Shows which data sources are connected
// Useful during setup to confirm keys are loaded
// ─────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const allApis = getApiStatus();
  const connected = Object.values(allApis).filter(a => a.connected).length;
  const total = Object.values(allApis).length;

  res.json({
    platform: 'Party of You',
    domain: 'partyofyou.org',
    apiConnections: {
      connected,
      total,
      summary: allApis,
    },
    features: {
      openSeatTracker: process.env.FEATURE_OPEN_SEAT_TRACKER === 'true',
      pollingIntelligence: process.env.FEATURE_POLLING_INTELLIGENCE === 'true',
      demographics: process.env.FEATURE_DEMOGRAPHICS === 'true',
      ballotAccessGuide: process.env.FEATURE_BALLOT_ACCESS_GUIDE === 'true',
      candidateDashboard: process.env.FEATURE_CANDIDATE_DASHBOARD === 'true',
      volunteerPortal: process.env.FEATURE_VOLUNTEER_PORTAL === 'true',
      eventManagement: process.env.FEATURE_EVENT_MANAGEMENT === 'true',
      voterContactTools: process.env.FEATURE_VOTER_CONTACT_TOOLS === 'true',
      videoAdCreator: process.env.FEATURE_VIDEO_AD_CREATOR === 'true',
      fecReporting: process.env.FEATURE_FEC_REPORTING === 'true',
    },
    datasets: {
      mitElectionLab: process.env.DATASET_MIT_ELECTION_LAB_LOADED === 'true',
      pewResearch: process.env.DATASET_PEW_RESEARCH_LOADED === 'true',
      openSecrets: process.env.DATASET_OPENSECRETS_LOADED === 'true',
      govtrack: process.env.DATASET_GOVTRACK_LOADED === 'true',
    },
  });
});

// ─────────────────────────────────────────────────
// CORE API ROUTES
// Each module registers its own router here as built.
// Guarded by feature flags — returns 503 if not yet active.
// ─────────────────────────────────────────────────

// Module 2: Open Seat Tracker
app.use('/api/races', featureGuard('FEATURE_OPEN_SEAT_TRACKER'), require('./routes/races'));

// Module 5: District Intelligence (Polling + Demographics)
app.use('/api/intelligence', featureGuard('FEATURE_POLLING_INTELLIGENCE'), require('./routes/intelligence'));

// Module 4: Candidate Dashboard (auth required)
// app.use('/api/candidates', featureGuard('FEATURE_CANDIDATE_DASHBOARD'), require('./routes/candidates'));

// More routes added as modules are built...

// ─────────────────────────────────────────────────
// PLACEHOLDER ROOT — Landing page placeholder
// Replace with React frontend once built
// ─────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Party of You</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #0d1117;
          color: #e6edf3;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container { text-align: center; max-width: 600px; padding: 2rem; }
        h1 { font-size: 3rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 1rem; }
        .accent { color: #e84848; }
        p { font-size: 1.2rem; color: #8b949e; line-height: 1.6; margin-bottom: 2rem; }
        .badge {
          display: inline-block;
          background: #1f2937;
          border: 1px solid #374151;
          padding: 0.5rem 1rem;
          border-radius: 9999px;
          font-size: 0.875rem;
          color: #9ca3af;
          margin-bottom: 1rem;
        }
        .status { 
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: #162032;
          border: 1px solid #1d4ed8;
          padding: 0.75rem 1.5rem;
          border-radius: 8px;
          font-size: 0.9rem;
          color: #60a5fa;
        }
        .dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="badge">partyofyou.org</div>
        <h1>Party of <span class="accent">You</span></h1>
        <p>Grassroots candidate infrastructure. No corporate money. No party bosses. Just tools for people who want to change things.</p>
        <div class="status">
          <div class="dot"></div>
          Platform building in progress
        </div>
      </div>
    </body>
    </html>
  `);
});

// ─────────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

// ─────────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────────

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

app.listen(PORT, () => {
  console.log(`\n═══════════════════════════════════`);
  console.log(`  Party of You — Platform Server`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`═══════════════════════════════════\n`);

  // Log which APIs are connected on startup
  const connected = getConnectedApis();
  const pending = getPendingApis();
  console.log(`APIs connected: ${Object.keys(connected).length}`);
  if (Object.keys(connected).length) {
    Object.values(connected).forEach(api => console.log(`  ✓ ${api.name}`));
  }
  if (Object.keys(pending).length) {
    console.log(`APIs pending:`);
    Object.values(pending).forEach(api => console.log(`  ○ ${api.name}`));
  }
  console.log('');
});

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

/**
 * Feature flag middleware
 * Returns 503 with a clear message if a module isn't enabled yet
 */
function featureGuard(flagName) {
  return (req, res, next) => {
    if (process.env[flagName] !== 'true') {
      return res.status(503).json({
        error: 'Module not yet available',
        module: flagName,
        message: 'This feature is under construction. Set the feature flag to enable it.',
      });
    }
    next();
  };
}

module.exports = app;
