/**
 * OPEN SEAT TRACKER
 * 
 * The engine that powers the candidate recruitment funnel.
 * Given a geographic result, finds every race a person could run in
 * and structures the data for display.
 * 
 * Data waterfall:
 *   Federal races:    FEC.gov API + ProPublica Congress API
 *   State races:      OpenStates API + state SOS scrapers
 *   Local races:      Ballotpedia API (paid) → BallotReady (paid) → SOS scrapers (free fallback)
 *   Election dates:   Democracy Works API (paid) → Google Civic (free fallback)
 * 
 * A race is "open" if:
 *   - The current officeholder is not running for re-election (retirement/term limit)
 *   - The seat has no declared major-party candidates yet (filing period open)
 *   - The seat is vacant (death, resignation, removal)
 *   - Any seat where filing is still open (even contested — our candidates can challenge anyone)
 */

const axios = require('axios');
const { apis } = require('../config/apis');

const SEATS_CACHE_TTL = 60 * 60 * 4; // 4 hours — election data changes, but not that fast

// ─────────────────────────────────────────────────
// MASTER SEAT FINDER
// ─────────────────────────────────────────────────

/**
 * Get all races available to a candidate at a given address
 * 
 * @param {object} geography - GeographyResult from geographic.js
 * @param {object} options   - Filters: level, includeContested, filingStillOpen
 * @param {object} cache     - Redis client
 * @returns {object} RaceBundle
 */
async function getRacesForCandidate(geography, options = {}, cache = null) {
  const { state, districts } = geography;
  const cacheKey = `races:${state}:${JSON.stringify(districts)}`;

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  const [federal, stateRaces, local] = await Promise.allSettled([
    getFederalRaces(state, districts),
    getStateRaces(state, districts),
    getLocalRaces(state, districts, geography),
  ]);

  const result = {
    geography,
    lastUpdated: new Date().toISOString(),
    races: {
      federal: federal.status === 'fulfilled' ? federal.value : [],
      state: stateRaces.status === 'fulfilled' ? stateRaces.value : [],
      local: local.status === 'fulfilled' ? local.value : [],
    },
    totalRaces: 0,
    openSeats: 0,
    filingOpen: 0,
    dataSources: {
      federal: 'FEC.gov + ProPublica Congress API',
      state: 'OpenStates API',
      local: apis.ballotpedia.enabled
        ? 'Ballotpedia API'
        : apis.ballotready.enabled
          ? 'BallotReady API'
          : 'Limited — awaiting Ballotpedia/BallotReady API access',
    },
  };

  // Count totals
  const allRaces = [
    ...result.races.federal,
    ...result.races.state,
    ...result.races.local,
  ];
  result.totalRaces = allRaces.length;
  result.openSeats = allRaces.filter(r => r.isOpenSeat).length;
  result.filingOpen = allRaces.filter(r => r.filingStatus === 'open').length;

  if (cache) {
    try {
      await cache.setex(cacheKey, SEATS_CACHE_TTL, JSON.stringify(result));
    } catch (e) {}
  }

  return result;
}

// ─────────────────────────────────────────────────
// FEDERAL RACES
// ─────────────────────────────────────────────────

/**
 * Get federal races (Congress + Senate) for a state
 * Uses FEC.gov API as primary, ProPublica for incumbent detail
 */
async function getFederalRaces(state, districts) {
  const races = [];

  // House race for their congressional district
  if (districts.congressional) {
    try {
      const houseRace = await getHouseRace(state, districts.congressional);
      if (houseRace) races.push(houseRace);
    } catch (e) {
      console.warn(`Failed to fetch House race for ${districts.congressional}:`, e.message);
    }
  }

  // Senate races — check if either Senate seat is up this cycle
  try {
    const senateRaces = await getSenateRaces(state);
    races.push(...senateRaces);
  } catch (e) {
    console.warn(`Failed to fetch Senate races for ${state}:`, e.message);
  }

  return races;
}

/**
 * Get House race data for a specific district
 */
async function getHouseRace(state, districtCode) {
  // districtCode is like "WI-5" — extract the number
  const districtNum = districtCode.split('-')[1];

  // FEC API: get candidates who've filed for this district
  const params = {
    api_key: apis.fec.key,
    state,
    district: districtNum.padStart(2, '0'),
    office: 'H',
    election_year: getCurrentElectionYear(),
    per_page: 20,
    sort: '-receipts', // Sort by fundraising — shows who's serious
  };

  const response = await axios.get(
    `${apis.fec.baseUrl}/candidates/`,
    { params, timeout: 10000 }
  );

  const candidates = response.data?.results || [];

  // Get the incumbent from ProPublica
  const incumbent = await getHouseIncumbent(state, districtNum);

  return buildRaceObject({
    type: 'US House',
    level: 'federal',
    state,
    district: districtCode,
    office: `US House - ${districtCode}`,
    term: '2 years',
    salary: '$174,000',
    incumbent,
    declaredCandidates: candidates.map(normalizeFecCandidate),
    electionDate: getNextElectionDate('general'),
    primaryDate: getNextElectionDate('primary', state),
    filingDeadline: null, // Will come from Democracy Works when connected
    filingRequirements: getFilingRequirementsStub('US House', state),
    signatureRequirement: getSignatureRequirementStub('US House', state),
  });
}

/**
 * Get Senate races for a state in the current/next cycle
 */
async function getSenateRaces(state) {
  const params = {
    api_key: apis.fec.key,
    state,
    office: 'S',
    election_year: getCurrentElectionYear(),
    per_page: 20,
    sort: '-receipts',
  };

  const response = await axios.get(
    `${apis.fec.baseUrl}/candidates/`,
    { params, timeout: 10000 }
  );

  const candidates = response.data?.results || [];

  // Group by seat (Class I, II, or III — only one is up per cycle)
  const bySeat = {};
  for (const candidate of candidates) {
    const seatKey = candidate.election_districts?.[0] || 'unknown';
    if (!bySeat[seatKey]) bySeat[seatKey] = [];
    bySeat[seatKey].push(candidate);
  }

  return Object.entries(bySeat).map(([seat, seatCandidates]) => buildRaceObject({
    type: 'US Senate',
    level: 'federal',
    state,
    district: null,
    office: `US Senate - ${state}`,
    term: '6 years',
    salary: '$174,000',
    incumbent: null, // TODO: Pull from ProPublica
    declaredCandidates: seatCandidates.map(normalizeFecCandidate),
    electionDate: getNextElectionDate('general'),
    primaryDate: getNextElectionDate('primary', state),
    filingDeadline: null,
    filingRequirements: getFilingRequirementsStub('US Senate', state),
    signatureRequirement: getSignatureRequirementStub('US Senate', state),
  }));
}

// ─────────────────────────────────────────────────
// STATE RACES
// ─────────────────────────────────────────────────

/**
 * Get state legislative races via OpenStates API
 */
async function getStateRaces(state, districts) {
  const races = [];

  // State Senate district
  if (districts.stateSenate) {
    try {
      const race = await getStateLegRace(state, 'upper', districts.stateSenate);
      if (race) races.push(race);
    } catch (e) {
      console.warn(`Failed to fetch State Senate race:`, e.message);
    }
  }

  // State House/Assembly district
  if (districts.stateHouse) {
    try {
      const race = await getStateLegRace(state, 'lower', districts.stateHouse);
      if (race) races.push(race);
    } catch (e) {
      console.warn(`Failed to fetch State House race:`, e.message);
    }
  }

  // Governor — if that's up this cycle
  // TODO: Check election cycle for gubernatorial races

  return races;
}

/**
 * Get a specific state legislative race from OpenStates
 */
async function getStateLegRace(state, chamber, districtNumber) {
  const params = {
    apikey: apis.openstates.key,
    jurisdiction: `ocd-jurisdiction/country:us/state:${state.toLowerCase()}/government`,
    current_role__org_classification: chamber,
    current_role__division_id: `ocd-division/country:us/state:${state.toLowerCase()}/sld${chamber === 'upper' ? 'u' : 'l'}:${districtNumber}`,
  };

  const response = await axios.get(
    `${apis.openstates.baseUrl}/people`,
    { params, timeout: 10000 }
  );

  const legislators = response.data?.results || [];
  const incumbent = legislators[0] || null;

  const chamberName = getChamberName(state, chamber);

  return buildRaceObject({
    type: `State ${chamberName}`,
    level: 'state',
    state,
    district: `District ${districtNumber}`,
    office: `${chamberName} - District ${districtNumber}`,
    term: chamber === 'upper' ? '4 years' : '2 years', // varies by state — TODO: state-specific
    salary: null, // TODO: Add state legislator salary data
    incumbent: incumbent ? normalizeOpenStatesLegislator(incumbent) : null,
    declaredCandidates: [],
    electionDate: getNextElectionDate('general'),
    primaryDate: getNextElectionDate('primary', state),
    filingDeadline: null,
    filingRequirements: getFilingRequirementsStub(chamberName, state),
    signatureRequirement: getSignatureRequirementStub(chamberName, state),
  });
}

// ─────────────────────────────────────────────────
// LOCAL RACES
// ─────────────────────────────────────────────────

/**
 * Get local races (county, city, school board, special districts)
 * 
 * Waterfall:
 *   1. Ballotpedia API (most complete — paid)
 *   2. BallotReady API (good local coverage — paid)
 *   3. Google Civic (limited but free)
 *   4. Return stub with note about limited data
 */
async function getLocalRaces(state, districts, geography) {
  // Try Ballotpedia first if enabled
  if (apis.ballotpedia.enabled) {
    try {
      return await getLocalRacesViaBallotpedia(state, geography);
    } catch (e) {
      console.warn('Ballotpedia local races failed, trying BallotReady:', e.message);
    }
  }

  // Try BallotReady if enabled
  if (apis.ballotready.enabled) {
    try {
      return await getLocalRacesViaBallotReady(state, geography);
    } catch (e) {
      console.warn('BallotReady local races failed, falling back to limited data:', e.message);
    }
  }

  // Fallback: Return what we can from Google Civic + note about limited coverage
  return getLocalRacesFallback(state, districts, geography);
}

async function getLocalRacesViaBallotpedia(state, geography) {
  // Ballotpedia Geographic API: address → all races on ballot
  const params = {
    apikey: apis.ballotpedia.key,
    state,
  };

  if (geography.coordinates) {
    params.latitude = geography.coordinates.latitude;
    params.longitude = geography.coordinates.longitude;
  }

  const response = await axios.get(
    `${apis.ballotpedia.geographicApi.baseUrl}${apis.ballotpedia.geographicApi.endpoints.addressLookup}`,
    { params, timeout: 15000 }
  );

  const elections = response.data?.elections || [];

  return elections
    .filter(e => ['City', 'County', 'School District', 'Special District'].includes(e.type))
    .map(e => buildRaceObject({
      type: e.type,
      level: 'local',
      state,
      district: e.district || null,
      office: e.office,
      term: e.term || null,
      salary: null,
      incumbent: e.incumbent ? { name: e.incumbent, party: e.incumbentParty } : null,
      declaredCandidates: (e.candidates || []).map(c => ({ name: c.name, party: c.party })),
      electionDate: e.electionDate,
      primaryDate: e.primaryDate,
      filingDeadline: e.filingDeadline,
      filingRequirements: getFilingRequirementsStub(e.type, state),
      signatureRequirement: getSignatureRequirementStub(e.type, state),
      source: 'Ballotpedia',
    }));
}

async function getLocalRacesViaBallotReady(state, geography) {
  // BallotReady API implementation — to be built when API access granted
  // Placeholder structure matches our race object format
  return [];
}

function getLocalRacesFallback(state, districts, geography) {
  // Return a placeholder race to show the candidate there ARE local races
  // but we don't have full data yet
  return [{
    type: 'Local',
    level: 'local',
    state,
    office: 'Local Offices (County, City, School Board)',
    isOpenSeat: null,
    filingStatus: 'unknown',
    dataLimited: true,
    dataNote: 'Full local race data requires Ballotpedia or BallotReady API access. We are working on this — check your county and city clerk websites for local race information.',
    resources: [
      { label: 'Find your county clerk', url: `https://www.usa.gov/local-governments` },
      { label: 'Ballotpedia elections', url: `https://ballotpedia.org/${state}` },
    ],
  }];
}

// ─────────────────────────────────────────────────
// RACE OBJECT BUILDER
// ─────────────────────────────────────────────────

/**
 * Build a normalized Race object — the canonical shape for the dashboard
 */
function buildRaceObject(data) {
  const isOpenSeat = !data.incumbent ||
    data.incumbent?.isRetiring ||
    data.incumbent?.termLimited ||
    data.declaredCandidates?.filter(c => c.isIncumbent).length === 0;

  const competitiveness = assessCompetitiveness(data);

  return {
    id: generateRaceId(data),
    type: data.type,
    level: data.level,
    state: data.state,
    district: data.district,
    office: data.office,
    term: data.term,
    salary: data.salary,
    isOpenSeat,
    competitiveness,

    // Current officeholder
    incumbent: data.incumbent,

    // Candidates who've filed
    declaredCandidates: data.declaredCandidates || [],
    candidateCount: (data.declaredCandidates || []).length,

    // Timeline
    primaryDate: data.primaryDate,
    electionDate: data.electionDate,
    filingDeadline: data.filingDeadline,
    filingStatus: assessFilingStatus(data.filingDeadline),

    // Requirements (from ballot access module)
    filingRequirements: data.filingRequirements,
    signatureRequirement: data.signatureRequirement,

    // Data provenance
    source: data.source || 'FEC.gov / OpenStates',
    lastUpdated: new Date().toISOString(),
    dataLimited: data.dataLimited || false,
    dataNote: data.dataNote || null,
    resources: data.resources || [],
  };
}

// ─────────────────────────────────────────────────
// HELPERS & STUBS
// ─────────────────────────────────────────────────

function normalizeFecCandidate(raw) {
  return {
    name: raw.name,
    party: raw.party_full || raw.party,
    isIncumbent: raw.incumbent_challenge === 'I',
    city: raw.candidate_address_city,
    state: raw.candidate_address_state,
    totalRaised: raw.receipts || 0,
    cashOnHand: raw.cash_on_hand_end_period || 0,
    fecId: raw.candidate_id,
    fecUrl: `https://www.fec.gov/data/candidate/${raw.candidate_id}/`,
  };
}

function normalizeOpenStatesLegislator(raw) {
  return {
    name: raw.name,
    party: raw.party,
    district: raw.current_role?.district,
    chamber: raw.current_role?.org_classification,
    isRetiring: false, // TODO: Check retirement announcements
    termLimited: false, // TODO: Cross-ref with state term limit data
    email: raw.email || null,
    twitter: raw.links?.find(l => l.url.includes('twitter'))?.url || null,
    openStatesId: raw.id,
    openStatesUrl: `https://openstates.org/person/${raw.id}`,
  };
}

async function getHouseIncumbent(state, districtNum) {
  try {
    // ProPublica: get House members for state, filter by district
    const response = await axios.get(
      `${apis.propublica.baseUrl}/house/members.json`,
      {
        headers: { 'X-API-Key': apis.propublica.key },
        timeout: 10000,
      }
    );

    const members = response.data?.results?.[0]?.members || [];
    return members
      .filter(m => m.state === state && m.district === districtNum)
      .map(m => ({
        name: `${m.first_name} ${m.last_name}`,
        party: m.party,
        district: m.district,
        daysInOffice: m.seniority,
        votesWith: {
          democrat: m.votes_with_party_pct,
        },
        missedVotes: m.missed_votes_pct,
        propublicaId: m.id,
      }))[0] || null;
  } catch (e) {
    return null;
  }
}

function assessCompetitiveness(data) {
  const candidateCount = (data.declaredCandidates || []).length;
  const parties = new Set((data.declaredCandidates || []).map(c => c.party));

  if (candidateCount === 0) return 'wide-open';
  if (!parties.has('Democrat') || !parties.has('Republican')) return 'lightly-contested';
  return 'contested';
}

function assessFilingStatus(filingDeadline) {
  if (!filingDeadline) return 'unknown';
  const deadline = new Date(filingDeadline);
  const now = new Date();
  if (deadline < now) return 'closed';
  const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 14) return 'closing-soon';
  return 'open';
}

function getCurrentElectionYear() {
  const year = new Date().getFullYear();
  return year % 2 === 0 ? year : year + 1;
}

function getNextElectionDate(type, state = null) {
  // TODO: Replace with Democracy Works API once connected
  const year = getCurrentElectionYear();
  if (type === 'general') return `${year}-11-03`; // First Tuesday after first Monday in November
  if (type === 'primary') return `${year}-08-12`; // Highly variable by state
  return null;
}

function getChamberName(state, chamber) {
  // Some states have different names for their chambers
  const upperNames = { NE: 'Legislature', DC: 'Council' };
  const lowerNames = { CA: 'State Assembly', NY: 'State Assembly', WI: 'State Assembly' };

  if (chamber === 'upper') return upperNames[state] || 'State Senate';
  return lowerNames[state] || 'State House';
}

function generateRaceId(data) {
  return `${data.level}-${data.state}-${(data.type || '').replace(/\s+/g, '-').toLowerCase()}-${(data.district || 'statewide').replace(/\s+/g, '-')}`;
}

// Stubs for ballot access module (Module 3) — will be populated from ballot-access.js
function getFilingRequirementsStub(officeType, state) {
  return {
    available: false,
    state,
    officeType,
    note: 'Ballot access requirements being compiled. Check back or see docs/ballot-access-by-state.md',
    links: [
      { label: 'Ballotpedia Ballot Access Rules', url: `https://ballotpedia.org/Ballot_access_for_third-party_and_independent_candidates_in_${state}` },
    ],
  };
}

function getSignatureRequirementStub(officeType, state) {
  return {
    available: false,
    count: null,
    percentageOfVotes: null,
    eligibleSigners: null,
    note: 'Signature data being compiled from state statutes',
  };
}

module.exports = {
  getRacesForCandidate,
  getFederalRaces,
  getStateRaces,
  getLocalRaces,
};
