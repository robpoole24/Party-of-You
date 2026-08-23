/**
 * RACES ROUTER — /api/races
 *
 * GET /api/races?address=...  → all races a candidate is eligible for
 * GET /api/races?state=WI     → all races in a state
 * GET /api/races/:id          → single race detail
 *
 * Design principles:
 *  - Always show ALL race types — never silently omit Senate, state leg, or local
 *    because we lack data for this specific cycle
 *  - Show non-2026 senate seats as informational (incumbent + next election year)
 *  - Show state races even without a precise district — prompt for full address
 *  - Show local races with actual state election calendar + county clerk link
 *  - Be explicit about what we know vs. don't know (dataKnown flag)
 */

const express = require('express');
const router = express.Router();
const { resolveAddress } = require('../data-layer/geographic');
const { STATE_ELECTION_CALENDAR, SENATE_SEATS_2026, GENERAL_ELECTION_DATE } = require('../data/election-calendar-2026');

// ─────────────────────────────────────────────────
// ALL SENATE SEATS — both classes not up in 2026
// Class 3 next up 2028, Class 1 next up 2030
// Lets us show incumbent info for every state
// ─────────────────────────────────────────────────
const SENATE_OTHER_SEATS = {
  // Class 3 — next election 2028
  AK: { incumbent: 'Lisa Murkowski',   party: 'R', nextElection: 2028, class: 3 },
  AL: { incumbent: 'Katie Britt',       party: 'R', nextElection: 2028, class: 3 },
  AR: { incumbent: 'John Boozman',      party: 'R', nextElection: 2028, class: 3 },
  CO: { incumbent: 'Michael Bennet',    party: 'D', nextElection: 2028, class: 3 },
  GA: { incumbent: 'Jon Ossoff',        party: 'D', nextElection: 2028, class: 3 },
  ID: { incumbent: 'Mike Crapo',        party: 'R', nextElection: 2028, class: 3 },
  IL: { incumbent: 'Tammy Duckworth',   party: 'D', nextElection: 2028, class: 3 },
  IA: { incumbent: 'Chuck Grassley',    party: 'R', nextElection: 2028, class: 3 },
  KS: { incumbent: 'Roger Marshall',    party: 'R', nextElection: 2028, class: 3 },
  KY: { incumbent: 'Rand Paul',         party: 'R', nextElection: 2028, class: 3 },
  LA: { incumbent: 'John Kennedy',      party: 'R', nextElection: 2028, class: 3 },
  MD: { incumbent: 'Angela Alsobrooks', party: 'D', nextElection: 2028, class: 3 },
  MO: { incumbent: 'Eric Schmitt',      party: 'R', nextElection: 2028, class: 3 },
  NH: { incumbent: 'Maggie Hassan',     party: 'D', nextElection: 2028, class: 3 },
  NJ: { incumbent: 'Cory Booker',       party: 'D', nextElection: 2028, class: 3 },
  NM: { incumbent: 'Ben Ray Luján',     party: 'D', nextElection: 2028, class: 3 },
  NC: { incumbent: 'Ted Budd',          party: 'R', nextElection: 2028, class: 3 },
  OR: { incumbent: 'Ron Wyden',         party: 'D', nextElection: 2028, class: 3 },
  RI: { incumbent: 'Sheldon Whitehouse',party: 'D', nextElection: 2028, class: 3 },
  SC: { incumbent: 'Tim Scott',         party: 'R', nextElection: 2028, class: 3 },
  SD: { incumbent: 'Mike Rounds',       party: 'R', nextElection: 2028, class: 3 },
  TN: { incumbent: 'Bill Hagerty',      party: 'R', nextElection: 2028, class: 3 },
  TX: { incumbent: 'Ted Cruz',          party: 'R', nextElection: 2028, class: 3 },
  UT: { incumbent: 'John Curtis',       party: 'R', nextElection: 2028, class: 3 },
  VT: { incumbent: 'Peter Welch',       party: 'D', nextElection: 2028, class: 3 },
  VA: { incumbent: 'Tim Kaine',         party: 'D', nextElection: 2028, class: 3 },
  WA: { incumbent: 'Maria Cantwell',    party: 'D', nextElection: 2028, class: 3 },
  WI: { incumbent: 'Tammy Baldwin',     party: 'D', nextElection: 2028, class: 3 },
  WY: { incumbent: 'Cynthia Lummis',    party: 'R', nextElection: 2028, class: 3 },
  // Class 1 — next election 2030
  AZ: { incumbent: 'Mark Kelly',        party: 'D', nextElection: 2030, class: 1 },
  CA: { incumbent: 'Adam Schiff',       party: 'D', nextElection: 2030, class: 1 },
  CT: { incumbent: 'Richard Blumenthal',party: 'D', nextElection: 2030, class: 1 },
  DE: { incumbent: 'Lisa Blunt Rochester',party:'D', nextElection: 2030, class: 1 },
  FL: { incumbent: 'Rick Scott',        party: 'R', nextElection: 2030, class: 1 },
  HI: { incumbent: 'Brian Schatz',      party: 'D', nextElection: 2030, class: 1 },
  IN: { incumbent: 'Jim Banks',         party: 'R', nextElection: 2030, class: 1 },
  ME: { incumbent: 'Susan Collins',     party: 'R', nextElection: 2030, class: 1 },
  MA: { incumbent: 'Ed Markey',         party: 'D', nextElection: 2030, class: 1 },
  MI: { incumbent: 'Gary Peters',       party: 'D', nextElection: 2030, class: 1 },
  MN: { incumbent: 'Amy Klobuchar',     party: 'D', nextElection: 2030, class: 1 },
  MS: { incumbent: 'Roger Wicker',      party: 'R', nextElection: 2030, class: 1 },
  MT: { incumbent: 'Steve Daines',      party: 'R', nextElection: 2030, class: 1 },
  NE: { incumbent: 'Pete Ricketts',     party: 'R', nextElection: 2030, class: 1 },
  NV: { incumbent: 'Jacky Rosen',       party: 'D', nextElection: 2030, class: 1 },
  ND: { incumbent: 'John Hoeven',       party: 'R', nextElection: 2030, class: 1 },
  OH: { incumbent: 'Jon Husted',        party: 'R', nextElection: 2030, class: 1 },
  OK: { incumbent: 'Markwayne Mullin',  party: 'R', nextElection: 2030, class: 1 },
  PA: { incumbent: 'Dave McCormick',    party: 'R', nextElection: 2030, class: 1 },
  WV: { incumbent: 'Jim Justice',       party: 'R', nextElection: 2030, class: 1 },
};

// ─────────────────────────────────────────────────
// LOCAL ELECTION PATTERNS BY STATE
// When local offices are actually on the ballot
// ─────────────────────────────────────────────────
const LOCAL_PATTERNS = {
  WI: {
    municipal: {
      label: 'City Council / Mayor / Village Board',
      cycle: 'Odd-numbered years — April Spring Election',
      nextElectionDates: ['2027-04-06', '2029-04-01'],
      nextFilingWindow: 'December 2026 – January 2027',
      notes: 'Wisconsin municipal offices are elected every 2 years in April of odd years. A Spring Primary is held in February if more than 2 candidates file.',
      currentCycleStatus: '2026 municipal elections were April 7, 2026 — completed.',
    },
    county: {
      label: 'County Board Supervisor',
      cycle: 'Even-numbered years — April Spring Election',
      nextElectionDates: ['2028-04-04'],
      nextFilingWindow: 'December 2027 – January 2028',
      notes: 'Wisconsin county board supervisors serve 2-year terms, elected in April of even years. County board races are nonpartisan.',
      currentCycleStatus: '2026 county board elections were April 7, 2026 — completed.',
    },
    schoolBoard: {
      label: 'School Board Member',
      cycle: 'Odd-numbered years — April Spring Election (3-year terms)',
      nextElectionDates: ['2027-04-06', '2028-04-04'],
      nextFilingWindow: 'December 2026 – January 2027',
      notes: 'Wisconsin school board members serve 3-year terms. Elections are held in April — some districts have seats up in odd years, some in even years. Contact your school district for the specific cycle.',
      currentCycleStatus: 'Some WI school board seats were on the April 7, 2026 ballot. The April 7, 2026 Spring Election is completed.',
    },
    clerkUrl: 'https://myvote.wi.gov/en-us/FindMyClerk',
    stateElectionUrl: 'https://elections.wi.gov',
  },
  MN: {
    municipal: { label: 'City Council / Mayor', cycle: 'Odd years — November', nextElectionDates: ['2027-11-02'], nextFilingWindow: 'May–June 2027', notes: 'Minnesota municipal elections are held in November of odd years.', currentCycleStatus: 'Next municipal cycle: November 2027.' },
    county: { label: 'County Commissioner', cycle: 'Even years — November', nextElectionDates: ['2026-11-03', '2028-11-07'], nextFilingWindow: 'May–June 2026', notes: 'Minnesota county commissioners run in even years on the November ballot.', currentCycleStatus: '2026 county commissioner races are on the November 3 general ballot.' },
    schoolBoard: { label: 'School Board Member', cycle: 'Odd years — November', nextElectionDates: ['2027-11-02'], nextFilingWindow: 'May–June 2027', notes: 'Minnesota school boards elected November odd years.', currentCycleStatus: 'Next school board cycle: November 2027.' },
    clerkUrl: 'https://www.sos.state.mn.us/elections-voting/find-county-auditor/', stateElectionUrl: 'https://www.sos.state.mn.us/elections-voting/',
  },
  IL: {
    municipal: { label: 'City Council / Mayor', cycle: 'Odd years — April Consolidated Election', nextElectionDates: ['2027-04-06'], nextFilingWindow: 'November–December 2026', notes: 'Illinois consolidated elections for most local offices are April of odd years.', currentCycleStatus: 'Next municipal cycle: April 2027.' },
    county: { label: 'County Board Member', cycle: 'Even years — November', nextElectionDates: ['2026-11-03', '2028-11-07'], nextFilingWindow: 'March 2026', notes: 'Illinois county board races are on the even-year November ballot.', currentCycleStatus: '2026 county board races are on the November 3 general ballot.' },
    schoolBoard: { label: 'School Board Member', cycle: 'Odd years — April Consolidated Election', nextElectionDates: ['2027-04-06'], nextFilingWindow: 'November–December 2026', notes: 'Illinois school board races consolidated in April odd years.', currentCycleStatus: 'Next school board cycle: April 2027.' },
    clerkUrl: 'https://www.elections.il.gov/ElectionOperations/ElectionAuthorities.aspx', stateElectionUrl: 'https://www.elections.il.gov',
  },
  DEFAULT: {
    municipal: { label: 'City Council / Mayor', cycle: 'Typically odd-numbered years', nextElectionDates: ['2027-11-02'], nextFilingWindow: 'Varies — typically 3–6 months before election', notes: 'Most states hold municipal elections in odd-numbered years. Exact dates and filing deadlines vary by state and municipality.', currentCycleStatus: 'Contact your city or town clerk for the current cycle.' },
    county: { label: 'County Board / Commission', cycle: 'Typically even-numbered years', nextElectionDates: ['2026-11-03', '2028-11-07'], nextFilingWindow: 'Varies — typically 3–6 months before election', notes: 'County elections usually align with state and federal cycles.', currentCycleStatus: 'County races may be on the November 3, 2026 general ballot. Check your county clerk.' },
    schoolBoard: { label: 'School Board Member', cycle: 'Varies by state and district', nextElectionDates: ['2027-04-01'], nextFilingWindow: 'Varies significantly', notes: 'School board election schedules vary widely by state and school district.', currentCycleStatus: 'Contact your school district clerk for the current cycle.' },
    clerkUrl: 'https://www.usa.gov/local-governments', stateElectionUrl: 'https://www.usa.gov/election-office',
  },
};

// WI county clerk URLs (all 72 counties)
const WI_COUNTY_CLERKS = {
  'Adams': 'https://www.co.adams.wi.gov', 'Ashland': 'https://www.co.ashland.wi.us',
  'Barron': 'https://www.barroncountywi.gov', 'Bayfield': 'https://www.bayfieldcounty.org',
  'Brown': 'https://www.browncountywi.gov/departments/county-clerk/elections/',
  'Buffalo': 'https://www.buffalocounty.com', 'Burnett': 'https://www.burnettcounty.com',
  'Calumet': 'https://www.calumetcounty.org', 'Chippewa': 'https://www.chippewacountywi.gov',
  'Clark': 'https://www.co.clark.wi.us', 'Columbia': 'https://www.co.columbia.wi.us',
  'Crawford': 'https://www.crawfordcountywi.org', 'Dane': 'https://www.countyofdane.com/clerk/elections',
  'Dodge': 'https://www.co.dodge.wi.gov', 'Door': 'https://www.doorcounty.gov',
  'Douglas': 'https://www.douglascountywi.org', 'Dunn': 'https://www.co.dunn.wi.us',
  'Eau Claire': 'https://www.eauclaircounty.gov', 'Florence': 'https://www.florencecountywi.com',
  'Fond du Lac': 'https://www.fdlco.wi.gov', 'Forest': 'https://www.co.forest.wi.us',
  'Grant': 'https://www.grantcounty.us', 'Green': 'https://www.co.green.wi.gov',
  'Green Lake': 'https://www.co.green-lake.wi.us', 'Iowa': 'https://www.iowacounty.org',
  'Iron': 'https://www.ironcountywi.org', 'Jackson': 'https://www.co.jackson.wi.us',
  'Jefferson': 'https://www.jeffersoncountywi.gov', 'Juneau': 'https://www.co.juneau.wi.gov',
  'Kenosha': 'https://www.kenoshacounty.org', 'Kewaunee': 'https://www.kewauneecounty.org',
  'La Crosse': 'https://www.lacrossecounty.org/countyclerk', 'Lafayette': 'https://www.lafayettecounty.org',
  'Langlade': 'https://www.langladecounty.org', 'Lincoln': 'https://www.co.lincoln.wi.us',
  'Manitowoc': 'https://www.manitowoccounty.com', 'Marathon': 'https://www.co.marathon.wi.us',
  'Marinette': 'https://www.marinettecounty.com', 'Marquette': 'https://www.co.marquette.wi.gov',
  'Menominee': 'https://www.menomineecounty.com', 'Milwaukee': 'https://county.milwaukee.gov/EN/County-Clerk/Election-Commission',
  'Monroe': 'https://www.co.monroe.wi.us', 'Oconto': 'https://www.co.oconto.wi.us',
  'Oneida': 'https://www.co.oneida.wi.us', 'Outagamie': 'https://www.outagamie.org',
  'Ozaukee': 'https://www.co.ozaukee.wi.us', 'Pepin': 'https://www.co.pepin.wi.us',
  'Pierce': 'https://www.co.pierce.wi.us', 'Polk': 'https://www.co.polk.wi.us',
  'Portage': 'https://www.co.portage.wi.us', 'Price': 'https://www.co.price.wi.us',
  'Racine': 'https://www.racinecounty.com', 'Richland': 'https://www.co.richland.wi.gov',
  'Rock': 'https://www.co.rock.wi.us', 'Rusk': 'https://www.ruskcounty.org',
  'St. Croix': 'https://www.sccwi.gov', 'Sauk': 'https://www.co.sauk.wi.us',
  'Sawyer': 'https://www.sawyercountywi.gov', 'Shawano': 'https://www.co.shawano.wi.us',
  'Sheboygan': 'https://www.sheboygancounty.com', 'Taylor': 'https://www.taylorcounty.wi.gov',
  'Trempealeau': 'https://www.tremplocounty.com', 'Vernon': 'https://www.vernoncounty.org',
  'Vilas': 'https://www.vilascountywi.gov', 'Walworth': 'https://www.co.walworth.wi.us',
  'Washburn': 'https://www.washburncounty.org', 'Washington': 'https://www.co.washington.wi.us',
  'Waukesha': 'https://www.waukeshacounty.gov', 'Waupaca': 'https://www.co.waupaca.wi.us',
  'Waushara': 'https://www.co.waushara.wi.us', 'Winnebago': 'https://www.winnebagocounty.org',
  'Wood': 'https://www.co.wood.wi.us',
};

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  return Math.ceil((d - today) / (1000 * 60 * 60 * 24));
}

function isPast(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

// ─────────────────────────────────────────────────
// FEDERAL RACES
// ─────────────────────────────────────────────────
function buildFederalRaces(state, districts, calendar) {
  const races = [];
  const houseDistrict = districts?.congressional;
  const districtLabel = !houseDistrict || houseDistrict === '00'
    ? 'At-Large (enter full address to find your district)'
    : `District ${houseDistrict.split('-')[1] || houseDistrict}`;

  // US House — always show, all 435 seats up in 2026
  races.push({
    id: `house-${state}-${houseDistrict || 'unknown'}`,
    office: `U.S. House of Representatives — ${state} ${districtLabel}`,
    level: 'Federal',
    type: 'house',
    state,
    district: houseDistrict || null,
    districtKnown: !!houseDistrict && houseDistrict !== '00',
    onBallot2026: true,
    electionDate: GENERAL_ELECTION_DATE,
    electionDateFormatted: formatDate(GENERAL_ELECTION_DATE),
    daysUntilElection: daysUntil(GENERAL_ELECTION_DATE),
    primaryDate: calendar?.primary || null,
    primaryDateFormatted: formatDate(calendar?.primary),
    primaryPast: isPast(calendar?.primary),
    filingDeadline: calendar?.filingDeadline || null,
    filingDeadlinePast: isPast(calendar?.filingDeadline),
    filingStatus: isPast(calendar?.filingDeadline) ? 'closed' : 'open',
    incumbent: null,
    isOpenSeat: false,
    nextCycle: { year: 2028, note: 'All House seats are on the ballot every 2 years.' },
    notes: districtLabel.includes('enter full address')
      ? 'Enter your complete street address above to identify your specific congressional district and find the current incumbent.'
      : 'All 435 U.S. House seats are on the 2026 ballot.',
  });

  // US Senate — seat up in 2026
  const seat2026 = SENATE_SEATS_2026[state];
  if (seat2026) {
    races.push({
      id: `senate-${state}-2026`,
      office: `U.S. Senate — ${state} (Class 2 seat)`,
      level: 'Federal',
      type: 'senate',
      state,
      onBallot2026: true,
      electionDate: GENERAL_ELECTION_DATE,
      electionDateFormatted: formatDate(GENERAL_ELECTION_DATE),
      daysUntilElection: daysUntil(GENERAL_ELECTION_DATE),
      primaryDate: calendar?.primary || null,
      primaryDateFormatted: formatDate(calendar?.primary),
      primaryPast: isPast(calendar?.primary),
      filingDeadline: calendar?.filingDeadline || null,
      filingDeadlinePast: isPast(calendar?.filingDeadline),
      filingStatus: isPast(calendar?.filingDeadline) ? 'closed' : 'open',
      incumbent: { name: seat2026.incumbent, party: seat2026.party },
      isOpenSeat: seat2026.isOpenSeat || false,
      nextCycle: { year: 2032, note: 'Class 2 seats are next up in 2032.' },
      notes: seat2026.note || null,
    });
  }

  // US Senate — other seat (not on 2026 ballot) — show as informational
  const otherSeat = SENATE_OTHER_SEATS[state];
  if (otherSeat) {
    races.push({
      id: `senate-${state}-${otherSeat.nextElection}`,
      office: `U.S. Senate — ${state} (Class ${otherSeat.class} seat)`,
      level: 'Federal',
      type: 'senate',
      state,
      onBallot2026: false,
      electionDate: null,
      electionDateFormatted: null,
      daysUntilElection: null,
      primaryDate: null,
      filingDeadline: null,
      filingStatus: 'not-this-cycle',
      incumbent: { name: otherSeat.incumbent, party: otherSeat.party },
      isOpenSeat: false,
      nextCycle: {
        year: otherSeat.nextElection,
        note: `This seat is next on the ballot in ${otherSeat.nextElection}.`,
        estimatedFilingWindow: `${otherSeat.nextElection - 1}–${otherSeat.nextElection}`,
      },
      notes: `Not on the 2026 ballot. ${otherSeat.incumbent} (${otherSeat.party}) holds this seat through ${otherSeat.nextElection}.`,
    });
  }

  // If state has NO 2026 senate seat (e.g. WI only has the Class 3 seat)
  // and SENATE_SEATS_2026 doesn't include them, both seats still show via otherSeat above
  // For states like WI where the 2026 seat doesn't exist in SENATE_SEATS_2026,
  // we should still check if there's a seat we missed
  if (!seat2026 && !otherSeat) {
    // State has senators but neither is in our tables — show a generic card
    races.push({
      id: `senate-${state}-unknown`,
      office: `U.S. Senate — ${state}`,
      level: 'Federal',
      type: 'senate',
      state,
      onBallot2026: false,
      filingStatus: 'not-this-cycle',
      notes: 'No U.S. Senate seat from this state is on the 2026 ballot.',
    });
  }

  return races;
}

// ─────────────────────────────────────────────────
// STATE RACES
// ─────────────────────────────────────────────────
function buildStateRaces(state, districts, calendar) {
  const races = [];

  const stateSenateDistrict = districts?.stateSenate;
  const stateHouseDistrict = districts?.stateHouse;
  const hasDistricts = stateSenateDistrict || stateHouseDistrict;

  // State Senate
  races.push({
    id: `state-senate-${state}-${stateSenateDistrict || 'unknown'}`,
    office: stateSenateDistrict
      ? `State Senate — District ${stateSenateDistrict}`
      : 'State Senate — (enter full address to find your district)',
    level: 'State',
    type: 'state_senate',
    state,
    district: stateSenateDistrict || null,
    districtKnown: !!stateSenateDistrict,
    onBallot2026: true, // state senate always has seats up somewhere
    electionDate: GENERAL_ELECTION_DATE,
    electionDateFormatted: formatDate(GENERAL_ELECTION_DATE),
    daysUntilElection: daysUntil(GENERAL_ELECTION_DATE),
    primaryDate: calendar?.primary || null,
    primaryDateFormatted: formatDate(calendar?.primary),
    primaryPast: isPast(calendar?.primary),
    filingDeadline: calendar?.filingDeadline || null,
    filingDeadlinePast: isPast(calendar?.filingDeadline),
    filingStatus: isPast(calendar?.filingDeadline) ? 'closed' : 'open',
    incumbent: null,
    isOpenSeat: false,
    nextCycle: getStateSenateNextCycle(state),
    notes: stateSenateDistrict
      ? `Your State Senate district is ${stateSenateDistrict}. Filing deadline was ${formatDate(calendar?.filingDeadline) || 'unknown'}.`
      : 'Enter your full street address to identify your specific State Senate district and find the current incumbent.',
  });

  // State House / Assembly
  races.push({
    id: `state-house-${state}-${stateHouseDistrict || 'unknown'}`,
    office: stateHouseDistrict
      ? `State Assembly / House — District ${stateHouseDistrict}`
      : 'State Assembly / House — (enter full address to find your district)',
    level: 'State',
    type: 'state_house',
    state,
    district: stateHouseDistrict || null,
    districtKnown: !!stateHouseDistrict,
    onBallot2026: true,
    electionDate: GENERAL_ELECTION_DATE,
    electionDateFormatted: formatDate(GENERAL_ELECTION_DATE),
    daysUntilElection: daysUntil(GENERAL_ELECTION_DATE),
    primaryDate: calendar?.primary || null,
    primaryDateFormatted: formatDate(calendar?.primary),
    primaryPast: isPast(calendar?.primary),
    filingDeadline: calendar?.filingDeadline || null,
    filingDeadlinePast: isPast(calendar?.filingDeadline),
    filingStatus: isPast(calendar?.filingDeadline) ? 'closed' : 'open',
    incumbent: null,
    isOpenSeat: false,
    nextCycle: { year: 2028, note: 'State Assembly members serve 2-year terms — all seats up every cycle.' },
    notes: stateHouseDistrict
      ? `Your State Assembly district is ${stateHouseDistrict}. Filing deadline was ${formatDate(calendar?.filingDeadline) || 'unknown'}.`
      : 'Enter your full street address to identify your specific State Assembly district and find the current incumbent.',
  });

  return races;
}

function getStateSenateNextCycle(state) {
  // State senate terms vary — most are 4 years with staggered districts
  // WI: districts on alternating 4-year cycles, so half are up each even year
  const twoCycle = ['NH', 'VT', 'RI', 'MA', 'CT', 'NY', 'CA', 'NV', 'AZ'];
  if (twoCycle.includes(state)) return { year: 2028, note: '2-year terms — all seats up every cycle.' };
  return { year: 2028, note: '4-year terms — approximately half of seats up each cycle.' };
}

// ─────────────────────────────────────────────────
// LOCAL RACES
// ─────────────────────────────────────────────────
function buildLocalRaces(state, calendar, county, city) {
  const pattern = LOCAL_PATTERNS[state] || LOCAL_PATTERNS.DEFAULT;

  // For WI, try to get county-specific clerk URL
  let clerkUrl = pattern.clerkUrl;
  if (state === 'WI' && county) {
    // Strip "County" suffix if present, try lookup
    const countyName = county.replace(/ County$/i, '').trim();
    clerkUrl = WI_COUNTY_CLERKS[countyName] || 'https://myvote.wi.gov/en-us/FindMyClerk';
  }

  const makeLocalRace = (typeKey, typeData) => ({
    id: `local-${state}-${typeKey}-${(county || 'unknown').replace(/\s+/g, '-').toLowerCase()}`,
    office: typeData.label,
    level: 'Local',
    type: typeKey,
    state,
    county: county || null,
    city: city || null,
    districtKnown: false,
    dataKnown: false, // We don't have seat-level data without BallotReady

    // Current cycle
    currentCycleStatus: typeData.currentCycleStatus,
    onBallot2026: typeKey === 'county' && ['MN','IL','OH','PA','MI'].includes(state), // Only for states where county is Nov 2026

    // Next cycle — what candidates should plan toward
    nextCycle: {
      electionDates: typeData.nextElectionDates,
      electionDatesFormatted: typeData.nextElectionDates.map(d => formatDate(d)),
      daysUntil: typeData.nextElectionDates.map(d => daysUntil(d)),
      filingWindow: typeData.nextFilingWindow,
      cycle: typeData.cycle,
    },

    notes: typeData.notes,
    resources: [
      {
        label: county
          ? `📋 ${county} County Clerk`
          : '📋 Find your county clerk',
        url: clerkUrl,
      },
      {
        label: '🗳️ State election authority',
        url: pattern.stateElectionUrl || 'https://www.usa.gov/election-office',
      },
      {
        label: '📖 Ballotpedia local elections',
        url: `https://ballotpedia.org/${state}_elections,_2027`,
      },
    ],
    isPlaceholder: true,
    upgradeNote: 'Full local race data — specific seats, incumbents, ward maps — available with BallotReady integration.',
  });

  return [
    makeLocalRace('county', pattern.county),
    makeLocalRace('municipal', pattern.municipal),
    makeLocalRace('schoolBoard', pattern.schoolBoard),
  ];
}

// ─────────────────────────────────────────────────
// DB CALENDAR LOOKUP
// ─────────────────────────────────────────────────
async function getCalendarFromDB(state, db) {
  if (!db) return null;
  try {
    const result = await db.query(`
      SELECT * FROM election_calendar
      WHERE state = $1
        AND election_date >= CURRENT_DATE
        AND level = 'federal_state'
      ORDER BY election_date ASC
      LIMIT 10
    `, [state]);
    return result.rows;
  } catch (e) {
    return null;
  }
}

function dbRowsToCalendar(rows) {
  if (!rows || !rows.length) return null;
  const primary = rows.find(r => r.type === 'primary');
  const general = rows.find(r => r.type === 'general');
  return {
    primary: primary?.election_date?.toISOString().split('T')[0] || null,
    primaryRunoff: null,
    general: general?.election_date?.toISOString().split('T')[0] || '2026-11-03',
    filingDeadline:
      primary?.registration_deadline_in_person?.toISOString().split('T')[0] ||
      primary?.registration_deadline_online?.toISOString().split('T')[0] || null,
    source: 'live',
    scrapedAt: primary?.scraped_at || null,
  };
}

// ─────────────────────────────────────────────────
// MAIN ROUTE
// ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { address, state: stateParam, level } = req.query;

  if (!address && !stateParam) {
    return res.status(400).json({ error: 'Provide ?address= or ?state=' });
  }

  try {
    let geography = null;

    if (address) {
      try {
        geography = await resolveAddress(address);
      } catch (err) {
        console.warn('[Races] Address resolution failed:', err.message);
        const stateMatch = address.match(/\b([A-Z]{2})\b/);
        geography = { state: stateMatch?.[1] || null, districts: {}, normalizedAddress: address, city: null, county: null };
      }
    } else {
      geography = { state: stateParam, districts: {}, normalizedAddress: null, city: null, county: null };
    }

    const state = geography.state;
    if (!state) return res.status(400).json({ error: 'Could not determine state from address' });

    const dbRows = await getCalendarFromDB(state, req.db);
    const calendar = (dbRows && dbRows.length)
      ? dbRowsToCalendar(dbRows)
      : STATE_ELECTION_CALENDAR[state];
    const dataSource = (dbRows && dbRows.length) ? 'live-scraped' : 'hard-coded-2026';

    const districts = geography.districts || {};
    const county = geography.county || null;
    const city = geography.city || null;

    const federal = buildFederalRaces(state, districts, calendar);
    const stateRaces = buildStateRaces(state, districts, calendar);
    const local = buildLocalRaces(state, calendar, county, city);

    let filtered = { federal, state: stateRaces, local };
    if (level === 'federal') filtered = { federal, state: [], local: [] };
    if (level === 'state') filtered = { federal: [], state: stateRaces, local: [] };
    if (level === 'local') filtered = { federal: [], state: [], local };

    const allRaces = [...filtered.federal, ...filtered.state, ...filtered.local];
    const filingOpen = allRaces.filter(r => r.filingStatus === 'open').length;
    const filingClosed = allRaces.filter(r => r.filingStatus === 'closed').length;
    const notThisCycle = allRaces.filter(r => r.filingStatus === 'not-this-cycle').length;

    res.json({
      success: true,
      geography: {
        state,
        county,
        city,
        districts,
        normalizedAddress: geography.normalizedAddress,
        hasFullDistricts: !!(districts.stateSenate && districts.stateHouse && districts.congressional),
        addressPrompt: (!districts.stateSenate || !districts.stateHouse)
          ? 'Enter your complete street address (including street number and zip code) to identify your State Assembly and Senate districts.'
          : null,
      },
      calendar: calendar ? {
        primary: calendar.primary,
        primaryFormatted: formatDate(calendar.primary),
        primaryPast: isPast(calendar.primary),
        daysUntilPrimary: daysUntil(calendar.primary),
        general: GENERAL_ELECTION_DATE,
        generalFormatted: formatDate(GENERAL_ELECTION_DATE),
        daysUntilGeneral: daysUntil(GENERAL_ELECTION_DATE),
        filingDeadline: calendar.filingDeadline,
        filingDeadlineFormatted: formatDate(calendar.filingDeadline),
        filingDeadlinePast: isPast(calendar.filingDeadline),
        daysUntilFiling: daysUntil(calendar.filingDeadline),
      } : null,
      summary: {
        totalRaces: allRaces.length,
        filingOpen,
        filingClosed,
        notThisCycle,
        dataSource: dataSource === 'live-scraped'
          ? 'Live data from USVoteFoundation.org scraper'
          : 'Party of You 2026 calendar (hard-coded fallback)',
        note: filingClosed > 0
          ? `${filingClosed} race(s) have passed their 2026 filing deadline — shown for general election planning and next-cycle preparation.`
          : null,
      },
      races: filtered,
    });
  } catch (err) {
    console.error('Race lookup error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve races', detail: err.message });
  }
});

router.get('/:id', async (req, res) => {
  res.json({ message: 'Individual race detail — coming soon', raceId: req.params.id });
});

module.exports = router;
