/**
 * GEOGRAPHIC INTELLIGENCE SERVICE
 *
 * Takes an address, resolves it to political geography.
 *
 * Waterfall strategy:
 *   1. Census Geocoder (free, reliable, no key required)
 *   2. Address string parsing (state extraction fallback)
 *   3. Redis cache (24-hour TTL)
 *
 * NOTE: Google Civic Information API (representatives endpoint) was
 * deprecated/restricted and returns 404. Removed from waterfall.
 * VoteHub polling API returns 403 — key needs renewal or replacement.
 */

const axios = require('axios');

// Cache TTL in seconds
const CACHE_TTL = 60 * 60 * 24; // 24 hours

/**
 * Master function: address → full political geography
 */
async function resolveAddress(address, cache = null) {
  const cacheKey = `geo:${address.toLowerCase().replace(/\s+/g, '-')}`;

  // 1. Check cache first
  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {
      console.warn('Cache read failed:', e.message);
    }
  }

  let result = null;

  // 2. Try Census Geocoder (primary)
  try {
    result = await resolveViaCensus(address);
  } catch (e) {
    console.warn('Census geocoder failed:', e.message);
  }

  // 3. Fallback: parse state + city from address string
  if (!result) {
    result = parseAddressFallback(address);
    if (!result) {
      throw new Error(`Could not resolve address: ${address}`);
    }
    console.log(`[Geo] Using address-string fallback for: ${address} → state: ${result.state}`);
  }

  // 4. Cache the result
  if (cache && result) {
    try {
      await cache.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    } catch (e) {
      console.warn('Cache write failed:', e.message);
    }
  }

  return result;
}

/**
 * Parse state and basic geography from raw address string
 * Used when geocoding APIs are unavailable
 */
function parseAddressFallback(address) {
  if (!address) return null;

  // Extract state abbreviation (e.g. "WI" from "Milwaukee, WI 53221")
  const stateMatch = address.match(/\b([A-Z]{2})\b/);
  if (!stateMatch) return null;

  const state = stateMatch[1];

  // Extract ZIP code
  const zipMatch = address.match(/\b(\d{5})\b/);
  const zip = zipMatch?.[1];

  // Extract city (word(s) before state abbreviation)
  const cityMatch = address.match(/([A-Za-z\s]+),\s*[A-Z]{2}/);
  const city = cityMatch?.[1]?.trim().split(',').pop()?.trim();

  return {
    source: 'address-parse',
    normalizedAddress: address,
    state,
    zip,
    city: city || null,
    districts: {
      congressional: null, // Can't determine without geocoding
      stateLeg: {},
    },
  };
}

/**
 * Resolve via Google Civic Information API
 * Returns the richest data — includes elected officials, districts, election info
 */
async function resolveViaGoogle(address) {
  const params = {
    key: apis.google.key,
    address,
    includeOffices: true,
  };

  const response = await axios.get(
    `${apis.google.baseUrl}/representatives`,
    { params, timeout: 10000 }
  );

  const { normalizedInput, divisions, offices, officials } = response.data;

  return buildGeographyResult({
    source: 'google',
    normalizedAddress: formatNormalizedAddress(normalizedInput),
    divisions,
    offices,
    officials,
  });
}

/**
 * Resolve via Census Bureau Geocoder (free, no key required)
 * Less rich than Google but completely free and reliable
 */
async function resolveViaCensus(address) {
  const params = {
    address,
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: 'all',
    format: 'json',
  };

  const response = await axios.get(
    'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress',
    { params, timeout: 15000 }
  );

  const result = response.data?.result;
  if (!result?.addressMatches?.length) {
    throw new Error('Census geocoder returned no matches');
  }

  const match = result.addressMatches[0];
  const geo = match.geographies;

  return buildGeographyResultFromCensus({
    source: 'census',
    normalizedAddress: match.matchedAddress,
    coordinates: match.coordinates,
    geographies: geo,
  });
}

/**
 * Build normalized GeographyResult from Google response
 * This is the canonical shape every module expects
 */
function buildGeographyResult({ source, normalizedAddress, divisions, offices, officials }) {
  const result = {
    source,
    normalizedAddress,
    state: null,
    stateFips: null,
    county: null,
    city: null,
    zipCode: null,
    coordinates: null,

    districts: {
      congressional: null,      // e.g., "WI-5"
      stateSenate: null,        // State senate district number
      stateHouse: null,         // State house/assembly district number
      county: null,
      city: null,
      schoolBoard: null,
    },

    // OCD-IDs for Democracy Works API compatibility
    ocdIds: [],

    // Elected officials currently holding each seat
    currentOfficeholders: [],

    // Raw division keys from Google (useful for further API calls)
    divisionKeys: Object.keys(divisions || {}),
  };

  // Parse Google's division structure
  for (const [divisionId, division] of Object.entries(divisions || {})) {
    // Extract state
    const stateMatch = divisionId.match(/country:us\/state:(\w{2})/);
    if (stateMatch && !divisionId.includes('/')) {
      result.state = stateMatch[1].toUpperCase();
    }

    // Congressional district
    if (divisionId.includes('cd:')) {
      const cdMatch = divisionId.match(/cd:(\d+)/);
      if (cdMatch) {
        result.districts.congressional = `${result.state || ''}-${parseInt(cdMatch[1])}`;
      }
    }

    // State senate district
    if (divisionId.includes('sldu:')) {
      const sdMatch = divisionId.match(/sldu:(\d+)/);
      if (sdMatch) result.districts.stateSenate = parseInt(sdMatch[1]);
    }

    // State house/assembly district
    if (divisionId.includes('sldl:')) {
      const hdMatch = divisionId.match(/sldl:(\d+)/);
      if (hdMatch) result.districts.stateHouse = parseInt(hdMatch[1]);
    }

    // County
    if (divisionId.includes('/county:')) {
      result.county = division.name;
    }

    // City/municipality
    if (divisionId.includes('/place:') || divisionId.includes('/incorporated_place:')) {
      result.city = division.name;
    }

    // Collect OCD-IDs (compatible with Democracy Works API)
    result.ocdIds.push(divisionId.replace('ocd-division/', 'ocd-division/'));
  }

  // Map elected officials to their offices
  if (offices && officials) {
    for (const office of offices) {
      for (const officialIndex of (office.officialIndices || [])) {
        const official = officials[officialIndex];
        if (official) {
          result.currentOfficeholders.push({
            office: office.name,
            level: office.levels?.[0] || 'unknown',
            role: office.roles?.[0] || 'unknown',
            name: official.name,
            party: official.party || 'Unknown',
            phones: official.phones || [],
            urls: official.urls || [],
            photoUrl: official.photoUrl || null,
            channels: official.channels || [],
          });
        }
      }
    }
  }

  return result;
}

/**
 * Build normalized GeographyResult from Census Geocoder response
 */
function buildGeographyResultFromCensus({ source, normalizedAddress, coordinates, geographies }) {
  const states = geographies?.['States'] || [];
  const counties = geographies?.['Counties'] || [];
  const congDistricts = geographies?.['Congressional Districts'] || [];
  const stateSenate = geographies?.['State Legislative Districts - Upper'] || [];
  const stateHouse = geographies?.['State Legislative Districts - Lower'] || [];
  const places = geographies?.['Incorporated Places'] || [];

  const state = states[0];
  const county = counties[0];
  const cd = congDistricts[0];
  const sd = stateSenate[0];
  const hd = stateHouse[0];
  const place = places[0];

  return {
    source,
    normalizedAddress,
    state: state?.STUSAB || null,
    stateFips: state?.STATE || null,
    county: county?.NAME || null,
    city: place?.NAME || null,
    zipCode: null, // Census geocoder doesn't return zip directly
    coordinates: {
      latitude: coordinates?.y || null,
      longitude: coordinates?.x || null,
    },

    districts: {
      congressional: cd ? `${state?.STUSAB}-${parseInt(cd.CD118FP || cd.CD)}` : null,
      stateSenate: sd ? parseInt(sd.SLDUST || sd.DISTRICT) : null,
      stateHouse: hd ? parseInt(hd.SLDLST || hd.DISTRICT) : null,
      county: county?.NAME || null,
      city: place?.NAME || null,
      schoolBoard: null, // Not available via Census geocoder
    },

    ocdIds: buildOcdIds({ state, county, cd, sd, hd }),
    currentOfficeholders: [], // Not available via Census geocoder — Google only
    divisionKeys: [],
  };
}

/**
 * Build OCD-ID strings from Census geography objects
 * Used for Democracy Works API compatibility
 */
function buildOcdIds({ state, county, cd, sd, hd }) {
  const ids = [];
  const stateAb = state?.STUSAB?.toLowerCase();
  const stateFips = state?.STATE;

  if (stateAb) {
    ids.push(`ocd-division/country:us/state:${stateAb}`);
  }
  if (stateAb && cd) {
    const cdNum = parseInt(cd.CD118FP || cd.CD);
    if (cdNum) ids.push(`ocd-division/country:us/state:${stateAb}/cd:${cdNum}`);
  }
  if (stateAb && county) {
    const countyFips = county.COUNTYFP;
    if (countyFips) ids.push(`ocd-division/country:us/state:${stateAb}/county:${countyFips}`);
  }

  return ids;
}

/**
 * Format Google's normalizedInput into a readable address string
 */
function formatNormalizedAddress(normalizedInput) {
  if (!normalizedInput) return null;
  const { line1, city, state, zip } = normalizedInput;
  return [line1, city, state, zip].filter(Boolean).join(', ');
}

/**
 * Quick state-only lookup — for when we just need state-level data
 * and don't need the full geographic resolution
 */
async function getStateFromAddress(address, cache = null) {
  const result = await resolveAddress(address, cache);
  return result.state;
}

/**
 * Get the list of all races on a ballot for a given address
 * Combines geographic resolution with open seat data
 */
async function getRacesForAddress(address, cache = null) {
  const geography = await resolveAddress(address, cache);

  return {
    geography,
    // These will be populated by the open-seat tracker module
    // using the geography object as input
    federalRaces: [],    // Congressional, Senate
    stateRaces: [],      // Governor, AG, State Senate, State House
    localRaces: [],      // County, City, School Board, Special Districts
  };
}

module.exports = {
  resolveAddress,
  getStateFromAddress,
  getRacesForAddress,
  resolveViaGoogle,
  resolveViaCensus,
};
