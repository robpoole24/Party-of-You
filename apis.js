/**
 * PLATFORM API CONFIGURATION
 * Central registry for all external data sources.
 * Every connector in the platform routes through this file.
 * 
 * ENV VARS: Copy .env.example to .env and fill in your keys.
 * Never commit actual keys to git.
 */

const apis = {

  // ─────────────────────────────────────────────────
  // GEOGRAPHIC INTELLIGENCE
  // ─────────────────────────────────────────────────

  google: {
    name: 'Google Civic Information API',
    baseUrl: 'https://civicinfo.googleapis.com/civicinfo/v2',
    key: process.env.GOOGLE_CIVIC_API_KEY,
    status: 'free',
    signupUrl: 'https://console.cloud.google.com/apis/library/civicinfo.googleapis.com',
    rateLimits: { requestsPerDay: 25000 },
    endpoints: {
      representatives: '/representatives',    // address → elected officials
      elections: '/elections',                // upcoming elections list
      voterInfo: '/voterinfo',               // polling places, ballot info
    },
    requiredFor: ['geographic-spine', 'open-seat-tracker', 'election-dates'],
  },

  // ─────────────────────────────────────────────────
  // DEMOGRAPHICS
  // ─────────────────────────────────────────────────

  census: {
    name: 'US Census Bureau API',
    baseUrl: 'https://api.census.gov/data',
    key: process.env.CENSUS_API_KEY,
    status: 'free',
    signupUrl: 'https://api.census.gov/data/key_signup.html',
    rateLimits: { requestsPerDay: null }, // No hard cap with key
    datasets: {
      // American Community Survey 5-year (most complete)
      acs5: (year = 2022) => `/${year}/acs/acs5`,
      // ACS 1-year (more current but less geographic detail)
      acs1: (year = 2022) => `/${year}/acs/acs1`,
      // Decennial Census
      decennial: '/2020/dec/pl',
      // Population Estimates
      popEstimates: (year = 2022) => `/${year}/pep/population`,
    },
    // Variable groups we care about for district intelligence
    variableGroups: {
      demographics: ['B01001_001E', 'B02001_002E', 'B02001_003E', 'B03001_001E'], // total pop, white, Black, Hispanic
      income: ['B19013_001E', 'B17001_002E'],       // median household income, poverty
      education: ['B15003_022E', 'B15003_023E'],    // bachelor's, graduate degree
      housing: ['B25001_001E', 'B25003_002E'],      // total units, owner-occupied
      age: ['B01002_001E'],                          // median age
    },
    requiredFor: ['district-demographics', 'voter-intelligence'],
  },

  // ─────────────────────────────────────────────────
  // POLLING DATA
  // ─────────────────────────────────────────────────

  votehub: {
    name: 'VoteHub Polling API',
    baseUrl: 'https://votehub.com/polls/api',
    key: process.env.VOTEHUB_API_KEY || null, // Currently open beta — no key required
    status: 'free',
    signupUrl: 'https://votehub.com/polls/api/',
    rateLimits: { note: 'Beta — not published. Cache aggressively.' },
    endpoints: {
      polls: '/polls',           // All polls with optional filters
      pollsters: '/pollsters',   // List of all pollster names
      subjects: '/subjects',     // Subjects being polled
    },
    // Filters available: pollster, subject, poll_type, start_date, end_date
    pollTypes: ['approval', 'generic_ballot', 'favorability', 'issue', 'horse_race'],
    requiredFor: ['polling-intelligence', 'district-issue-polling'],
  },

  // ─────────────────────────────────────────────────
  // ELECTION DATA — FEDERAL
  // ─────────────────────────────────────────────────

  fec: {
    name: 'FEC.gov API (Federal Election Commission)',
    baseUrl: 'https://api.open.fec.gov/v1',
    key: process.env.FEC_API_KEY,
    status: 'free',
    signupUrl: 'https://api.open.fec.gov/developers/',
    rateLimits: { requestsPerHour: 1000 },
    endpoints: {
      candidates: '/candidates/',
      candidateHistory: '/candidate/{id}/history/',
      candidateTotals: '/candidate/{id}/totals/',
      filings: '/filings/',
      committees: '/committees/',
      electionResults: '/elections/',
      scheduleA: '/schedules/schedule_a/',  // Individual contributions
      scheduleB: '/schedules/schedule_b/',  // Disbursements
    },
    requiredFor: ['federal-race-tracker', 'incumbent-fundraising-data', 'fec-reporting'],
  },

  propublica: {
    name: 'ProPublica Congress API',
    baseUrl: 'https://api.propublica.org/congress/v1',
    key: process.env.PROPUBLICA_API_KEY,
    status: 'free',
    signupUrl: 'https://www.propublica.org/datastore/api/propublica-congress-api',
    rateLimits: { note: 'Reasonable use — not published' },
    endpoints: {
      members: '/{chamber}/members.json',
      memberDetail: '/members/{id}.json',
      memberVotes: '/members/{id}/votes.json',
      memberBills: '/members/{id}/bills/{type}.json',
      memberComparisons: '/members/{id1}/{id2}/{chamber}/votes.json',
      bills: '/bills/search.json',
      billVotes: '/bills/{bill_id}/{type}/votes.json',
    },
    requiredFor: ['incumbent-voting-records', 'congressional-data'],
  },

  opensecrets: {
    name: 'OpenSecrets / CRP API',
    baseUrl: 'https://www.opensecrets.org/api/',
    key: process.env.OPENSECRETS_API_KEY,
    status: 'free',
    signupUrl: 'https://www.opensecrets.org/api/admin/index.php?function=signup',
    rateLimits: { requestsPerHour: 200 },
    endpoints: {
      // All return XML or JSON based on output param
      candSummary: '?method=candSummary',     // Candidate fundraising summary
      candContrib: '?method=candContrib',     // Top contributors to candidate
      candIndustry: '?method=candIndustry',   // Industries funding candidate
      candSector: '?method=candSector',       // Sectors funding candidate
      memPFDprofile: '?method=memPFDprofile', // Personal financial disclosures
      getLegislators: '?method=getLegislators',
    },
    requiredFor: ['incumbent-donor-profiles', 'corporate-money-transparency'],
  },

  // ─────────────────────────────────────────────────
  // ELECTION DATA — STATE LEGISLATURE
  // ─────────────────────────────────────────────────

  openstates: {
    name: 'OpenStates / Plural Policy API',
    baseUrl: 'https://v3.openstates.org',
    key: process.env.OPENSTATES_API_KEY,
    status: 'free',
    signupUrl: 'https://open.pluralpolicy.com/accounts/signup/',
    rateLimits: { requestsPerDay: 1000 },
    endpoints: {
      people: '/people',           // Legislators — filter by state, district, current
      bills: '/bills',             // State legislation
      events: '/events',           // Committee hearings, floor sessions
      jurisdictions: '/jurisdictions', // State/chamber metadata
    },
    graphqlEndpoint: 'https://v3.openstates.org/graphql',
    requiredFor: ['state-legislature-tracker', 'open-seat-detection', 'incumbent-voting-records'],
  },

  // ─────────────────────────────────────────────────
  // ELECTION DATA — COMPREHENSIVE (PAID — PLUG-IN READY)
  // ─────────────────────────────────────────────────

  ballotpedia: {
    name: 'Ballotpedia API',
    baseUrl: 'https://api.ballotpedia.org/v1',
    key: process.env.BALLOTPEDIA_API_KEY || null,
    status: 'paid-pending',
    signupUrl: null,
    contactEmail: 'data@ballotpedia.org',
    estimatedAnnualCost: '$5,000–$25,000',
    enabled: !!process.env.BALLOTPEDIA_API_KEY,
    endpoints: {
      elections: '/elections',         // All elections by state, date, type
      candidates: '/candidates',       // Candidate info, party, district
      officeholders: '/officeholders', // Current incumbents
      districts: '/districts',         // Geographic district lookup
      ballotMeasures: '/ballot_measures',
    },
    geographicApi: {
      baseUrl: 'https://geo.ballotpedia.org',
      endpoints: {
        addressLookup: '/address',     // Address → all races on ballot
        districtLookup: '/district',
      },
    },
    requiredFor: ['comprehensive-race-tracker', 'local-election-data', 'candidate-filing-info'],
    notes: 'Contact data@ballotpedia.org. Pitch civic mission. WI-based like us.',
  },

  democracyWorks: {
    name: 'Democracy Works Elections API',
    baseUrl: 'https://api.democracy.works/v2',
    key: process.env.DEMOCRACY_WORKS_API_KEY || null,
    status: 'paid-pending',
    signupUrl: 'https://data.democracy.works/request-pricing',
    contactUrl: 'https://data.democracy.works/request-pricing',
    enabled: !!process.env.DEMOCRACY_WORKS_API_KEY,
    endpoints: {
      elections: '/elections',               // Upcoming elections by OCD-ID or address
      electionByAddress: '/elections/lookup', // Address → elections
      authority: '/authorities',             // State voting guidance, election office contacts
    },
    requiredFor: ['election-dates', 'filing-deadlines', 'voter-registration-info', 'election-office-contacts'],
    notes: 'Most authoritative source for election deadlines verified with election officials.',
  },

  ballotready: {
    name: 'BallotReady API',
    baseUrl: null, // TBD on signup
    key: process.env.BALLOTREADY_API_KEY || null,
    status: 'paid-pending',
    signupUrl: 'https://www.ballotready.org/our-data/',
    enabled: !!process.env.BALLOTREADY_API_KEY,
    requiredFor: ['hyperlocal-race-data', 'school-board-races', 'special-district-races'],
    notes: 'Best source for sub-municipal races. Pitch civic mission for nonprofit rate.',
  },

  // ─────────────────────────────────────────────────
  // COMMUNICATIONS
  // ─────────────────────────────────────────────────

  twilio: {
    name: 'Twilio SMS',
    key: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER,
    status: 'paid',
    signupUrl: 'https://www.twilio.com/try-twilio',
    pricing: {
      outboundSMS: '$0.0079/message',
      inboundSMS: '$0.0075/message',
      phoneNumber: '$1.15/month',
    },
    enabled: !!process.env.TWILIO_ACCOUNT_SID,
    requiredFor: ['volunteer-sms', 'candidate-notifications', 'phone-banking'],
  },

  sendgrid: {
    name: 'SendGrid Email',
    key: process.env.SENDGRID_API_KEY,
    fromEmail: process.env.SENDGRID_FROM_EMAIL,
    status: 'free-tier',
    signupUrl: 'https://signup.sendgrid.com/',
    pricing: {
      free: '100 emails/day forever',
      essentials: '$19.95/month for 50k emails',
    },
    enabled: !!process.env.SENDGRID_API_KEY,
    requiredFor: ['email-marketing', 'transactional-email', 'volunteer-communications'],
  },

  // ─────────────────────────────────────────────────
  // STORAGE
  // ─────────────────────────────────────────────────

  cloudflare: {
    name: 'Cloudflare R2',
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    bucketName: process.env.CLOUDFLARE_R2_BUCKET,
    status: 'free-tier',
    signupUrl: 'https://dash.cloudflare.com/sign-up',
    pricing: {
      free: '10GB storage, 1M Class A ops/month',
      storage: '$0.015/GB beyond free',
    },
    enabled: !!process.env.CLOUDFLARE_ACCOUNT_ID,
    requiredFor: ['candidate-photos', 'petition-pdfs', 'voter-file-uploads', 'mailer-templates'],
  },

};

/**
 * Returns a status report of all API connections.
 * Call on app startup to confirm what data sources are live.
 */
function getApiStatus() {
  const report = {};
  for (const [key, api] of Object.entries(apis)) {
    const hasKey = api.key || api.accountId || api.enabled;
    report[key] = {
      name: api.name,
      status: api.status,
      connected: hasKey ? true : false,
      requiredFor: api.requiredFor || [],
      ...(api.status === 'paid-pending' && {
        signupUrl: api.signupUrl || api.contactUrl,
        estimatedCost: api.estimatedAnnualCost || 'Contact for pricing',
      }),
    };
  }
  return report;
}

/**
 * Returns only the APIs that are currently connected (have keys).
 */
function getConnectedApis() {
  return Object.entries(apis)
    .filter(([_, api]) => api.key || api.accountId || api.enabled)
    .reduce((acc, [key, api]) => ({ ...acc, [key]: api }), {});
}

/**
 * Returns APIs that are pending signup/payment.
 */
function getPendingApis() {
  return Object.entries(apis)
    .filter(([_, api]) => !api.key && !api.accountId && !api.enabled)
    .reduce((acc, [key, api]) => ({ ...acc, [key]: api }), {});
}

module.exports = { apis, getApiStatus, getConnectedApis, getPendingApis };
