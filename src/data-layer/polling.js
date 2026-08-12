/**
 * POLLING INTELLIGENCE SERVICE
 * 
 * Aggregates polling data from all available sources into
 * a unified format for the candidate dashboard.
 * 
 * Sources (in priority order):
 *   1. VoteHub API (real-time aggregator, free, CC4.0)
 *   2. Pew Research (bulk-ingested datasets, issue polling)
 *   3. OpenSecrets (campaign finance / approval proxies)
 *   4. Scraped state pollster pages (Marquette, etc.)
 *   5. MIT MEDSL historical results (partisan lean, not polling)
 * 
 * All results are cached in Redis to:
 *   - Preserve rate limits
 *   - Serve the dashboard fast
 *   - Survive API outages gracefully
 */

const axios = require('axios');
const { apis } = require('../config/apis');

const POLL_CACHE_TTL = 60 * 60 * 6;  // 6 hours for polling data
const LEAN_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days for partisan lean (changes slowly)

// ─────────────────────────────────────────────────
// MASTER POLLING FETCH
// ─────────────────────────────────────────────────

/**
 * Get all relevant polling data for a candidate's district
 * 
 * @param {object} geography - GeographyResult from geographic.js
 * @param {object} cache     - Redis client
 * @returns {object} PollingBundle
 */
async function getPollingBundleForDistrict(geography, cache = null) {
  const { state, districts } = geography;

  const [
    approvalPolls,
    issuePolls,
    genericBallot,
    partisanLean,
  ] = await Promise.allSettled([
    getApprovalPolls(state, cache),
    getIssuePolls(state, cache),
    getGenericBallot(cache),
    getPartisanLean(geography, cache),
  ]);

  return {
    state,
    districts,
    lastUpdated: new Date().toISOString(),
    data: {
      approvalPolls: approvalPolls.status === 'fulfilled' ? approvalPolls.value : [],
      issuePolls: issuePolls.status === 'fulfilled' ? issuePolls.value : [],
      genericBallot: genericBallot.status === 'fulfilled' ? genericBallot.value : null,
      partisanLean: partisanLean.status === 'fulfilled' ? partisanLean.value : null,
    },
    sources: {
      votehub: 'https://votehub.com',
      pewResearch: 'https://www.pewresearch.org',
      mitElectionLab: 'https://electionlab.mit.edu',
    },
  };
}

// ─────────────────────────────────────────────────
// VOTEHUB — APPROVAL & HORSE RACE POLLS
// ─────────────────────────────────────────────────

/**
 * Get approval ratings for elected officials in a state
 * Covers President, Congress (generic), Senators, Governor where available
 */
async function getApprovalPolls(state, cache = null) {
  const cacheKey = `polls:approval:${state}`;

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  const results = [];

  // Presidential approval (national — always relevant)
  try {
    const presidential = await fetchVoteHubPolls({
      poll_type: 'approval',
      subject: 'president',
    });
    results.push(...presidential.map(p => ({ ...p, scope: 'national', office: 'President' })));
  } catch (e) {
    console.warn('Could not fetch presidential approval:', e.message);
  }

  // Generic congressional ballot (national)
  try {
    const congressional = await fetchVoteHubPolls({
      poll_type: 'approval',
      subject: 'congress',
    });
    results.push(...congressional.map(p => ({ ...p, scope: 'national', office: 'Congress' })));
  } catch (e) {
    console.warn('Could not fetch congressional approval:', e.message);
  }

  // State-level — governor, senators
  // VoteHub's state filtering is limited; we grab everything and filter by state mention
  // This is where paid sources (Ballotpedia/Democracy Works) will eventually enhance coverage

  if (cache && results.length) {
    try {
      await cache.setex(cacheKey, POLL_CACHE_TTL, JSON.stringify(results));
    } catch (e) {}
  }

  return results;
}

/**
 * Get issue polling data relevant to a state
 * Covers healthcare, economy, immigration, education, etc.
 */
async function getIssuePolls(state, cache = null) {
  const cacheKey = `polls:issues:${state}`;

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  const issues = [];

  // Core issues to fetch from VoteHub
  const issueSubjects = [
    'economy', 'healthcare', 'immigration', 'education',
    'climate', 'abortion', 'gun control', 'minimum wage',
  ];

  for (const subject of issueSubjects) {
    try {
      const polls = await fetchVoteHubPolls({ poll_type: 'issue', subject });
      issues.push(...polls.map(p => ({
        ...p,
        issue: subject,
        scope: 'national', // VoteHub is mostly national; state-level comes from Pew bulk data
      })));
      // Small delay to avoid hammering the API
      await sleep(200);
    } catch (e) {
      console.warn(`Could not fetch issue polls for "${subject}":`, e.message);
    }
  }

  if (cache && issues.length) {
    try {
      await cache.setex(cacheKey, POLL_CACHE_TTL, JSON.stringify(issues));
    } catch (e) {}
  }

  return issues;
}

/**
 * Get the generic congressional ballot (Dem vs Rep preference)
 */
async function getGenericBallot(cache = null) {
  const cacheKey = 'polls:generic-ballot';

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  try {
    const polls = await fetchVoteHubPolls({ poll_type: 'generic_ballot' });
    const result = {
      polls: polls.slice(0, 20), // Most recent 20
      average: calculateAverage(polls, 'Democrat', 'Republican'),
      lastUpdated: new Date().toISOString(),
    };

    if (cache) {
      try {
        await cache.setex(cacheKey, POLL_CACHE_TTL, JSON.stringify(result));
      } catch (e) {}
    }

    return result;
  } catch (e) {
    console.error('Failed to fetch generic ballot:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────
// MIT ELECTION LAB — PARTISAN LEAN
// ─────────────────────────────────────────────────

/**
 * Calculate partisan lean for a district from historical election results
 * Uses pre-ingested MIT MEDSL data stored in our PostgreSQL database
 * 
 * Lean index: positive = Dem lean, negative = Rep lean
 * Calculated as average margin across last 3 federal elections
 * 
 * @param {object} geography - GeographyResult
 * @param {object} cache     - Redis client
 * @returns {object} PartisanLean
 */
async function getPartisanLean(geography, cache = null) {
  const { state, districts } = geography;
  const cacheKey = `lean:${state}:cd${districts.congressional}:ss${districts.stateSenate}:sh${districts.stateHouse}`;

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  // This queries our PostgreSQL DB where MIT MEDSL data is stored
  // The DB module is separate — this is the interface contract
  // Actual DB query implemented in data-layer/historical-results.js
  const lean = {
    congressional: districts.congressional ? await getLeanForDistrict('congressional', state, districts.congressional) : null,
    stateSenate: districts.stateSenate ? await getLeanForDistrict('state_senate', state, districts.stateSenate) : null,
    stateHouse: districts.stateHouse ? await getLeanForDistrict('state_house', state, districts.stateHouse) : null,
    county: null, // County-level lean from presidential results
    lastUpdated: new Date().toISOString(),
    source: 'MIT Election Data + Science Lab',
    sourceUrl: 'https://electionlab.mit.edu/data',
  };

  if (cache) {
    try {
      await cache.setex(cacheKey, LEAN_CACHE_TTL, JSON.stringify(lean));
    } catch (e) {}
  }

  return lean;
}

/**
 * Stub for partisan lean lookup — connects to DB layer
 * Returns a PartisanLeanResult object
 */
async function getLeanForDistrict(districtType, state, districtNumber) {
  // TODO: Replace with actual DB query once historical-results.js is built
  // SELECT AVG(dem_margin) FROM election_results
  // WHERE state = $1 AND district_type = $2 AND district_number = $3
  // AND year >= (SELECT MAX(year) - 8 FROM election_results)
  
  return {
    districtType,
    state,
    districtNumber,
    leanIndex: null,     // -100 to +100, negative = R lean, positive = D lean
    leanLabel: null,     // 'Safe D', 'Likely D', 'Lean D', 'Toss-up', 'Lean R', 'Likely R', 'Safe R'
    elections: [],       // Last 3 election results used in calculation
    dataAvailable: false, // Will be true once MIT MEDSL data is ingested
  };
}

// ─────────────────────────────────────────────────
// VOTEHUB API CORE FETCHER
// ─────────────────────────────────────────────────

/**
 * Core VoteHub API fetcher with built-in error handling
 * Returns normalized poll objects
 */
async function fetchVoteHubPolls(filters = {}) {
  const baseUrl = `${apis.votehub.baseUrl}/polls`;

  // Build query params — VoteHub accepts dashes or spaces interchangeably
  const params = {};
  if (filters.poll_type) params.poll_type = filters.poll_type;
  if (filters.subject) params.subject = filters.subject;
  if (filters.pollster) params.pollster = filters.pollster;
  if (filters.start_date) params.start_date = filters.start_date;
  if (filters.end_date) params.end_date = filters.end_date;

  // Add API key if available (not required in beta)
  if (apis.votehub.key) params.api_key = apis.votehub.key;

  const response = await axios.get(baseUrl, {
    params,
    timeout: 10000,
    headers: {
      'User-Agent': 'CivicPlatform/1.0 (civic engagement tool; contact@yourdomain.com)',
    },
  });

  // VoteHub returns array of poll objects
  const polls = Array.isArray(response.data) ? response.data : response.data?.results || [];

  return polls.map(normalizePoll);
}

/**
 * Normalize a VoteHub poll to our standard format
 */
function normalizePoll(raw) {
  return {
    id: raw.id,
    pollster: raw.pollster,
    sponsor: raw.sponsors?.[0] || null,
    pollType: raw.poll_type,
    subject: raw.subject,
    sampleSize: parseInt(raw.sample_size) || null,
    population: raw.population, // 'rv' = registered voters, 'lv' = likely voters, 'a' = adults
    startDate: raw.start_date,
    endDate: raw.end_date,
    publishedDate: raw.created_at,
    answers: raw.answers || [],
    isPartisan: raw.partisan || false,
    isInternal: raw.internal || false,
    url: raw.url || null,
    attribution: {
      source: 'VoteHub',
      sourceUrl: 'https://votehub.com',
      license: 'CC Attribution 4.0',
    },
  };
}

// ─────────────────────────────────────────────────
// PEW RESEARCH — BULK DATA READER
// ─────────────────────────────────────────────────

/**
 * Query pre-ingested Pew Research data from our DB
 * Pew data is downloaded manually quarterly and stored in PostgreSQL
 * 
 * @param {string} state    - Two-letter state code
 * @param {string} topic    - Topic category
 * @returns {object[]}      Array of issue polling results
 */
async function getPewResearchData(state, topic) {
  // TODO: Implement DB query against pew_research_data table
  // This table is populated by the Pew data ingestion job (jobs/ingest-pew.js)
  
  return {
    available: false,
    message: 'Pew Research data ingestion job not yet run. Download datasets from https://www.pewresearch.org/datasets/',
    data: [],
  };
}

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

function calculateAverage(polls, choice1, choice2) {
  if (!polls.length) return null;

  let c1Sum = 0, c2Sum = 0, count = 0;

  for (const poll of polls) {
    const a1 = poll.answers?.find(a => a.choice === choice1);
    const a2 = poll.answers?.find(a => a.choice === choice2);
    if (a1 && a2) {
      c1Sum += a1.pct;
      c2Sum += a2.pct;
      count++;
    }
  }

  if (!count) return null;

  return {
    [choice1]: Math.round(c1Sum / count * 10) / 10,
    [choice2]: Math.round(c2Sum / count * 10) / 10,
    sampleSize: count,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────
// PEW DATA INGESTION JOB SPEC
// Run this monthly via Bull queue
// ─────────────────────────────────────────────────

/**
 * Job spec for ingesting Pew Research datasets
 * Actual implementation in jobs/ingest-pew.js
 * 
 * Steps:
 * 1. Download new datasets from https://www.pewresearch.org/datasets/
 * 2. Parse SPSS/CSV files
 * 3. Map to our schema (topic, question, answers, state, date)
 * 4. Upsert into pew_research_data table
 * 5. Invalidate related cache keys
 */
const PEW_INGESTION_SPEC = {
  schedule: '0 0 1 * *', // First day of each month at midnight
  downloadUrl: 'https://www.pewresearch.org/datasets/',
  targetTable: 'pew_research_data',
  schema: {
    id: 'uuid',
    source: 'pew',
    topic: 'string',
    question: 'text',
    answers: 'jsonb',
    state: 'string(2)',
    surveyDate: 'date',
    sampleSize: 'integer',
    ingestedAt: 'timestamp',
  },
};

module.exports = {
  getPollingBundleForDistrict,
  getApprovalPolls,
  getIssuePolls,
  getGenericBallot,
  getPartisanLean,
  fetchVoteHubPolls,
  getPewResearchData,
  PEW_INGESTION_SPEC,
};
