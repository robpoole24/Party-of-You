/**
 * DEMOGRAPHICS SERVICE
 * 
 * Pulls district-level demographic data from the Census Bureau API.
 * Powers the "Know Your District" section of the candidate dashboard.
 * 
 * Data shown to candidates:
 *   - Population breakdown (age, race, gender)
 *   - Income distribution (median, poverty rate)
 *   - Education levels
 *   - Employment / industry
 *   - Housing (owner vs renter, housing costs)
 *   - Voter registration data (from state voter file aggregates — Module 8)
 * 
 * Census API is completely free and has no meaningful rate limits with a key.
 */

const axios = require('axios');
const { apis } = require('../config/apis');

const DEMO_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days — Census data is annual, not daily

// ─────────────────────────────────────────────────
// ACS VARIABLE DEFINITIONS
// American Community Survey 5-Year Estimates
// These are the specific table codes we pull
// ─────────────────────────────────────────────────

const ACS_VARIABLES = {
  // Population
  totalPop: 'B01001_001E',
  
  // Age breakdown
  medianAge: 'B01002_001E',
  under18: 'B09001_001E',
  over65: 'B08101_001E', // proxy

  // Race / Ethnicity
  white: 'B02001_002E',
  blackOrAA: 'B02001_003E',
  nativeAmerican: 'B02001_004E',
  asian: 'B02001_005E',
  pacific: 'B02001_006E',
  multiracial: 'B02001_008E',
  hispanic: 'B03001_003E',

  // Income
  medianHouseholdIncome: 'B19013_001E',
  perCapitaIncome: 'B19301_001E',
  belowPoverty: 'B17001_002E',
  totalForPoverty: 'B17001_001E',

  // Education (25+ years old)
  hsGrad: 'B15003_017E',
  someCollege: 'B15003_019E',
  bachelors: 'B15003_022E',
  graduate: 'B15003_023E',
  totalEd: 'B15003_001E',

  // Employment
  laborForce: 'B23025_002E',
  employed: 'B23025_004E',
  unemployed: 'B23025_005E',

  // Housing
  totalHousing: 'B25001_001E',
  ownerOccupied: 'B25003_002E',
  renterOccupied: 'B25003_003E',
  medianHomeValue: 'B25077_001E',
  medianRent: 'B25064_001E',

  // Citizenship / Nativity
  foreignBorn: 'B05002_013E',
  naturalizedCitizen: 'B05001_005E',
};

// Build the variables query string for Census API
const VARIABLE_LIST = Object.values(ACS_VARIABLES).join(',');

// ─────────────────────────────────────────────────
// MASTER DEMOGRAPHICS FETCH
// ─────────────────────────────────────────────────

/**
 * Get full demographic profile for a candidate's district
 * 
 * @param {object} geography - GeographyResult from geographic.js
 * @param {object} cache     - Redis client
 * @returns {object} DemographicsBundle
 */
async function getDemographicsForDistrict(geography, cache = null) {
  const { state, stateFips, districts } = geography;
  const cacheKey = `demo:${state}:cd${districts.congressional}:ss${districts.stateSenate}:sh${districts.stateHouse}`;

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  // Fetch demographics at multiple geographic levels in parallel
  const [
    congressional,
    stateLeg,
    county,
    stateLevel,
  ] = await Promise.allSettled([
    districts.congressional
      ? fetchCongressionalDistrictDemographics(state, districts.congressional)
      : Promise.resolve(null),
    (districts.stateSenate || districts.stateHouse)
      ? fetchStateLegDistrictDemographics(state, stateFips, districts)
      : Promise.resolve(null),
    geography.county
      ? fetchCountyDemographics(state, stateFips, geography.county)
      : Promise.resolve(null),
    fetchStateDemographics(state, stateFips),
  ]);

  const result = {
    geography,
    lastUpdated: new Date().toISOString(),
    dataYear: '2022', // Most recent ACS 5-year
    source: 'US Census Bureau — American Community Survey 5-Year Estimates',
    sourceUrl: 'https://data.census.gov',
    districts: {
      congressional: congressional.status === 'fulfilled' ? congressional.value : null,
      stateLeg: stateLeg.status === 'fulfilled' ? stateLeg.value : null,
      county: county.status === 'fulfilled' ? county.value : null,
      state: stateLevel.status === 'fulfilled' ? stateLevel.value : null,
    },
    // Computed insights for the dashboard
    insights: [],
  };

  // Generate actionable insights from the data
  result.insights = generateDemographicInsights(result.districts);

  if (cache) {
    try {
      await cache.setex(cacheKey, DEMO_CACHE_TTL, JSON.stringify(result));
    } catch (e) {}
  }

  return result;
}

// ─────────────────────────────────────────────────
// CENSUS API FETCHERS BY GEOGRAPHY
// ─────────────────────────────────────────────────

/**
 * Fetch demographics for a Congressional district
 */
async function fetchCongressionalDistrictDemographics(state, districtCode) {
  // districtCode is like "WI-5" — extract number
  const districtNum = districtCode.split('-')[1];
  const stateFips = STATE_FIPS[state];

  if (!stateFips) throw new Error(`Unknown state: ${state}`);

  // Census API geography: congressional district within state
  const url = `${apis.census.baseUrl}${apis.census.datasets.acs5()}`
    + `?get=NAME,${VARIABLE_LIST}`
    + `&for=congressional%20district:${districtNum.padStart(2, '0')}`
    + `&in=state:${stateFips}`
    + `&key=${apis.census.key}`;

  const response = await axios.get(url, { timeout: 15000 });
  return parseAndNormalizeCensusResponse(response.data, `Congressional District ${districtNum}`);
}

/**
 * Fetch demographics for state legislative districts
 */
async function fetchStateLegDistrictDemographics(state, stateFips, districts) {
  const results = {};

  // State Senate district
  if (districts.stateSenate) {
    try {
      const url = `${apis.census.baseUrl}${apis.census.datasets.acs5()}`
        + `?get=NAME,${VARIABLE_LIST}`
        + `&for=state%20legislative%20district%20(upper%20chamber):${String(districts.stateSenate).padStart(3, '0')}`
        + `&in=state:${stateFips}`
        + `&key=${apis.census.key}`;

      const response = await axios.get(url, { timeout: 15000 });
      results.stateSenate = parseAndNormalizeCensusResponse(response.data, `State Senate District ${districts.stateSenate}`);
    } catch (e) {
      console.warn(`State Senate district demographics failed:`, e.message);
    }
  }

  // State House/Assembly district
  if (districts.stateHouse) {
    try {
      const url = `${apis.census.baseUrl}${apis.census.datasets.acs5()}`
        + `?get=NAME,${VARIABLE_LIST}`
        + `&for=state%20legislative%20district%20(lower%20chamber):${String(districts.stateHouse).padStart(3, '0')}`
        + `&in=state:${stateFips}`
        + `&key=${apis.census.key}`;

      const response = await axios.get(url, { timeout: 15000 });
      results.stateHouse = parseAndNormalizeCensusResponse(response.data, `State House District ${districts.stateHouse}`);
    } catch (e) {
      console.warn(`State House district demographics failed:`, e.message);
    }
  }

  return results;
}

/**
 * Fetch county-level demographics
 */
async function fetchCountyDemographics(state, stateFips, countyName) {
  // We need the county FIPS code — look it up from our reference table
  // For now, use wildcard and filter by name
  const url = `${apis.census.baseUrl}${apis.census.datasets.acs5()}`
    + `?get=NAME,${VARIABLE_LIST}`
    + `&for=county:*`
    + `&in=state:${stateFips}`
    + `&key=${apis.census.key}`;

  const response = await axios.get(url, { timeout: 15000 });
  const allCounties = parseMultiRowCensusResponse(response.data);

  // Find the matching county
  const county = allCounties.find(c =>
    c.name.toLowerCase().includes(countyName.toLowerCase())
  );

  return county || null;
}

/**
 * Fetch state-level demographics (for comparison context)
 */
async function fetchStateDemographics(state, stateFips) {
  if (!stateFips) return null;

  const url = `${apis.census.baseUrl}${apis.census.datasets.acs5()}`
    + `?get=NAME,${VARIABLE_LIST}`
    + `&for=state:${stateFips}`
    + `&key=${apis.census.key}`;

  const response = await axios.get(url, { timeout: 15000 });
  return parseAndNormalizeCensusResponse(response.data, state);
}

// ─────────────────────────────────────────────────
// CENSUS RESPONSE PARSER
// ─────────────────────────────────────────────────

/**
 * Parse Census API response (array of arrays) into structured object
 * Census returns: [['header1','header2',...], ['val1','val2',...], ...]
 */
function parseAndNormalizeCensusResponse(data, label) {
  if (!Array.isArray(data) || data.length < 2) return null;

  const headers = data[0];
  const values = data[1]; // For single-geography queries, only one data row

  const raw = {};
  headers.forEach((header, i) => {
    raw[header] = values[i];
  });

  return normalizeToProfile(raw, label);
}

function parseMultiRowCensusResponse(data) {
  if (!Array.isArray(data) || data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(values => {
    const raw = {};
    headers.forEach((header, i) => { raw[header] = values[i]; });
    return normalizeToProfile(raw, raw.NAME);
  });
}

/**
 * Convert raw Census variable codes to a readable profile object
 */
function normalizeToProfile(raw, label) {
  const totalPop = parseInt(raw[ACS_VARIABLES.totalPop]) || 0;
  const totalForPoverty = parseInt(raw[ACS_VARIABLES.totalForPoverty]) || 1;
  const belowPoverty = parseInt(raw[ACS_VARIABLES.belowPoverty]) || 0;
  const laborForce = parseInt(raw[ACS_VARIABLES.laborForce]) || 1;
  const unemployed = parseInt(raw[ACS_VARIABLES.unemployed]) || 0;
  const totalHousing = parseInt(raw[ACS_VARIABLES.totalHousing]) || 1;
  const ownerOccupied = parseInt(raw[ACS_VARIABLES.ownerOccupied]) || 0;
  const totalEd = parseInt(raw[ACS_VARIABLES.totalEd]) || 1;

  return {
    label,
    name: raw.NAME,
    population: {
      total: totalPop,
      medianAge: parseFloat(raw[ACS_VARIABLES.medianAge]) || null,
    },
    race: {
      white: pct(parseInt(raw[ACS_VARIABLES.white]), totalPop),
      blackOrAfricanAmerican: pct(parseInt(raw[ACS_VARIABLES.blackOrAA]), totalPop),
      nativeAmerican: pct(parseInt(raw[ACS_VARIABLES.nativeAmerican]), totalPop),
      asian: pct(parseInt(raw[ACS_VARIABLES.asian]), totalPop),
      pacificIslander: pct(parseInt(raw[ACS_VARIABLES.pacific]), totalPop),
      multiracial: pct(parseInt(raw[ACS_VARIABLES.multiracial]), totalPop),
      hispanicOrLatino: pct(parseInt(raw[ACS_VARIABLES.hispanic]), totalPop),
    },
    income: {
      medianHouseholdIncome: parseInt(raw[ACS_VARIABLES.medianHouseholdIncome]) || null,
      perCapitaIncome: parseInt(raw[ACS_VARIABLES.perCapitaIncome]) || null,
      povertyRate: pct(belowPoverty, totalForPoverty),
    },
    education: {
      hsGradOrHigher: pct(
        parseInt(raw[ACS_VARIABLES.hsGrad]) +
        parseInt(raw[ACS_VARIABLES.someCollege] || 0) +
        parseInt(raw[ACS_VARIABLES.bachelors] || 0) +
        parseInt(raw[ACS_VARIABLES.graduate] || 0),
        totalEd
      ),
      bachelorsOrHigher: pct(
        parseInt(raw[ACS_VARIABLES.bachelors]) + parseInt(raw[ACS_VARIABLES.graduate] || 0),
        totalEd
      ),
    },
    employment: {
      unemploymentRate: pct(unemployed, laborForce),
    },
    housing: {
      totalUnits: totalHousing,
      ownerOccupied: pct(ownerOccupied, totalHousing),
      renterOccupied: pct(parseInt(raw[ACS_VARIABLES.renterOccupied]), totalHousing),
      medianHomeValue: parseInt(raw[ACS_VARIABLES.medianHomeValue]) || null,
      medianMonthlyRent: parseInt(raw[ACS_VARIABLES.medianRent]) || null,
    },
    citizenship: {
      foreignBornPct: pct(parseInt(raw[ACS_VARIABLES.foreignBorn]), totalPop),
    },
  };
}

// ─────────────────────────────────────────────────
// DASHBOARD INSIGHTS GENERATOR
// ─────────────────────────────────────────────────

/**
 * Generate plain-English insights from demographic data
 * These appear as callout cards on the candidate dashboard
 */
function generateDemographicInsights(districts) {
  const insights = [];
  const primary = districts.congressional || districts.stateLeg?.stateHouse || districts.county;

  if (!primary) return insights;

  // Poverty insight
  if (primary.income?.povertyRate > 15) {
    insights.push({
      type: 'economic',
      priority: 'high',
      icon: '💰',
      headline: `${primary.income.povertyRate}% poverty rate`,
      detail: `Your district has a higher poverty rate than the national average (11.5%). Economic policy is likely a top concern for voters.`,
      platformSuggestion: 'minimum-wage, healthcare, childcare',
    });
  }

  // Renter heavy
  if (primary.housing?.renterOccupied > 45) {
    insights.push({
      type: 'housing',
      priority: 'medium',
      icon: '🏠',
      headline: `${primary.housing.renterOccupied}% of residents rent`,
      detail: `High renter population. Tenant protections, rental assistance, and affordable housing are high-impact issues here.`,
      platformSuggestion: 'housing, tenant-rights',
    });
  }

  // High education district
  if (primary.education?.bachelorsOrHigher > 40) {
    insights.push({
      type: 'education',
      priority: 'low',
      icon: '🎓',
      headline: `Highly educated district`,
      detail: `${primary.education.bachelorsOrHigher}% hold a bachelor's degree or higher. Voters may prioritize education funding, research, and evidence-based policy.`,
    });
  }

  // Diverse district
  const nonWhitePct = 100 - (primary.race?.white || 0);
  if (nonWhitePct > 35) {
    insights.push({
      type: 'diversity',
      priority: 'medium',
      icon: '🤝',
      headline: `Diverse district — ${Math.round(nonWhitePct)}% non-white population`,
      detail: `Civil rights, equitable access to services, and representation matter deeply here. Engage with community organizations early.`,
      platformSuggestion: 'civil-rights, voting-rights, equity',
    });
  }

  return insights;
}

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

function pct(value, total) {
  if (!value || !total) return 0;
  return Math.round((parseInt(value) / parseInt(total)) * 1000) / 10; // One decimal
}

// State abbreviation → FIPS code mapping
const STATE_FIPS = {
  AL:'01', AK:'02', AZ:'04', AR:'05', CA:'06', CO:'08', CT:'09', DE:'10',
  FL:'12', GA:'13', HI:'15', ID:'16', IL:'17', IN:'18', IA:'19', KS:'20',
  KY:'21', LA:'22', ME:'23', MD:'24', MA:'25', MI:'26', MN:'27', MS:'28',
  MO:'29', MT:'30', NE:'31', NV:'32', NH:'33', NJ:'34', NM:'35', NY:'36',
  NC:'37', ND:'38', OH:'39', OK:'40', OR:'41', PA:'42', RI:'44', SC:'45',
  SD:'46', TN:'47', TX:'48', UT:'49', VT:'50', VA:'51', WA:'53', WV:'54',
  WI:'55', WY:'56', DC:'11',
};

module.exports = {
  getDemographicsForDistrict,
  fetchCongressionalDistrictDemographics,
  fetchStateDemographics,
  generateDemographicInsights,
  STATE_FIPS,
};
