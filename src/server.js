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

// Serve static files from /public
// Makes index.html, results.html, platform.html, /images/, /widgets/ all accessible
app.use(express.static('public', {
  maxAge: '1h',
  etag: true,
}));

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

// Root route is handled by express.static serving public/index.html

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
