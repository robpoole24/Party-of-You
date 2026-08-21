/**
 * RACES ROUTER — /api/races
 *
 * GET /api/races?address=...  → all races a candidate is eligible for
 * GET /api/races?state=WI     → all races in a state
 * GET /api/races/:id          → single race detail
 *
 * Uses 2026 election calendar data + FEC + OpenStates.
 * Local races show a placeholder until BallotReady integration is complete.
 */

const express = require('express');
const router = express.Router();
const { resolveAddress } = require('../data-layer/geographic');
const { STATE_ELECTION_CALENDAR, SENATE_SEATS_2026, GENERAL_ELECTION_DATE } = require('../data/election-calendar-2026');

// ── HELPERS ───────────────────────────────────────────────────────
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

function buildFederalRaces(state, districts, calendar) {
  const races = [];

  // US House — all 435 seats up
  const houseDistrict = districts?.congressional || '00';
  const districtLabel = houseDistrict === '00' ? 'At-Large' : `District ${houseDistrict}`;

  races.push({
    id: `house-${state}-${houseDistrict}`,
    office: `U.S. House of Representatives — ${state} ${districtLabel}`,
    level: 'Federal',
    type: 'house',
    state,
    district: houseDistrict,
    electionDate: GENERAL_ELECTION_DATE,
    primaryDate: calendar?.primary || null,
    primaryRunoffDate: calendar?.primaryRunoff || null,
    filingDeadline: calendar?.filingDeadline || null,
    isOpenSeat: false, // Would need FEC data to know — default false
    incumbent: null,   // Would need ProPublica/FEC — leaving null
    filingStatus: calendar?.filingDeadline && daysUntil(calendar.filingDeadline) > 0 ? 'open' : 'closed',
    notes: `All 435 House seats are on the ballot in 2026.`,
  });

  // US Senate — only states with Class 2 seats
  const senateSeat = SENATE_SEATS_2026[state];
  if (senateSeat) {
    races.push({
      id: `senate-${state}-2026`,
      office: `U.S. Senate — ${state}`,
      level: 'Federal',
      type: 'senate',
      state,
      district: null,
      electionDate: GENERAL_ELECTION_DATE,
      primaryDate: calendar?.primary || null,
      primaryRunoffDate: calendar?.primaryRunoff || null,
      filingDeadline: calendar?.filingDeadline || null,
      isOpenSeat: senateSeat.isOpenSeat || false,
      incumbent: {
        name: senateSeat.incumbent,
        party: senateSeat.party,
      },
      filingStatus: calendar?.filingDeadline && daysUntil(calendar.filingDeadline) > 0 ? 'open' : 'closed',
      notes: senateSeat.note || null,
    });
  }

  return races;
}

function buildStateRaces(state, districts, calendar) {
  const races = [];

  // State Senate
  const stateSenateDistrict = districts?.stateLeg?.stateSenate;
  if (stateSenateDistrict) {
    races.push({
      id: `state-senate-${state}-${stateSenateDistrict}`,
      office: `State Senate — District ${stateSenateDistrict}`,
      level: 'State',
      type: 'state_senate',
      state,
      district: stateSenateDistrict,
      electionDate: GENERAL_ELECTION_DATE,
      primaryDate: calendar?.primary || null,
      filingDeadline: calendar?.filingDeadline || null,
      isOpenSeat: false,
      incumbent: null,
      filingStatus: 'open',
      notes: 'Contact your state legislature for exact filing requirements.',
    });
  }

  // State House
  const stateHouseDistrict = districts?.stateLeg?.stateHouse;
  if (stateHouseDistrict) {
    races.push({
      id: `state-house-${state}-${stateHouseDistrict}`,
      office: `State Assembly / House — District ${stateHouseDistrict}`,
      level: 'State',
      type: 'state_house',
      state,
      district: stateHouseDistrict,
      electionDate: GENERAL_ELECTION_DATE,
      primaryDate: calendar?.primary || null,
      filingDeadline: calendar?.filingDeadline || null,
      isOpenSeat: false,
      incumbent: null,
      filingStatus: 'open',
      notes: 'Contact your state legislature for exact filing requirements.',
    });
  }

  return races;
}

function buildLocalRaces(state, calendar) {
  // Local races placeholder — will be replaced with BallotReady data
  return [{
    id: `local-${state}-general`,
    office: 'Local Office (County Board, City Council, School Board)',
    level: 'Local',
    type: 'local',
    state,
    district: null,
    electionDate: GENERAL_ELECTION_DATE,
    primaryDate: calendar?.primary || null,
    filingDeadline: null,
    isOpenSeat: false,
    incumbent: null,
    filingStatus: 'unknown',
    notes: 'Contact your county or city clerk for local race filing requirements and deadlines. Local race data will be enhanced when BallotReady integration is complete.',
    isPlaceholder: true,
  }];
}

// ── DB CALENDAR LOOKUP ────────────────────────────────────────────
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
    // Table doesn't exist yet — fall back to hard-coded data
    return null;
  }
}

// Convert DB rows to calendar format matching hard-coded structure
function dbRowsToCalendar(rows) {
  if (!rows || !rows.length) return null;

  const primary = rows.find(r => r.type === 'primary');
  const general = rows.find(r => r.type === 'general');

  return {
    primary: primary?.election_date?.toISOString().split('T')[0] || null,
    primaryRunoff: null,
    general: general?.election_date?.toISOString().split('T')[0] || '2026-11-03',
    filingDeadline: primary?.registration_deadline_in_person?.toISOString().split('T')[0] ||
                    primary?.registration_deadline_online?.toISOString().split('T')[0] || null,
    earlyVotingStart: primary?.early_voting_start?.toISOString().split('T')[0] || null,
    earlyVotingEnd: primary?.early_voting_end?.toISOString().split('T')[0] || null,
    electionDayRegistration: primary?.election_day_registration || false,
    source: 'live',
    scrapedAt: primary?.scraped_at || null,
  };
}
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
        // Extract state from address string as fallback
        const stateMatch = address.match(/\b([A-Z]{2})\b/);
        geography = {
          state: stateMatch?.[1] || null,
          districts: {},
          normalizedAddress: address,
        };
      }
    } else {
      geography = { state: stateParam, districts: {}, normalizedAddress: null };
    }

    const state = geography.state;
    if (!state) return res.status(400).json({ error: 'Could not determine state from address' });

    // Try live DB calendar first, fall back to hard-coded
    const dbRows = await getCalendarFromDB(state, req.db);
    const calendar = (dbRows && dbRows.length)
      ? dbRowsToCalendar(dbRows)
      : STATE_ELECTION_CALENDAR[state];
    const dataSource = (dbRows && dbRows.length) ? 'live-scraped' : 'hard-coded-2026';

    const districts = geography.districts || {};

    const federal = buildFederalRaces(state, districts, calendar);
    const stateRaces = buildStateRaces(state, districts, calendar);
    const local = buildLocalRaces(state, calendar);

    // Apply level filter if provided
    let filtered = { federal, state: stateRaces, local };
    if (level === 'federal') filtered = { federal, state: [], local: [] };
    if (level === 'state') filtered = { federal: [], state: stateRaces, local: [] };
    if (level === 'local') filtered = { federal: [], state: [], local };

    const allRaces = [...filtered.federal, ...filtered.state, ...filtered.local];

    res.json({
      success: true,
      geography: {
        state,
        districts,
        normalizedAddress: geography.normalizedAddress,
      },
      calendar: calendar ? {
        primary: calendar.primary,
        primaryFormatted: formatDate(calendar.primary),
        daysUntilPrimary: daysUntil(calendar.primary),
        general: GENERAL_ELECTION_DATE,
        generalFormatted: formatDate(GENERAL_ELECTION_DATE),
        daysUntilGeneral: daysUntil(GENERAL_ELECTION_DATE),
        filingDeadline: calendar.filingDeadline,
        filingDeadlineFormatted: formatDate(calendar.filingDeadline),
        daysUntilFiling: daysUntil(calendar.filingDeadline),
      } : null,
      summary: {
        totalRaces: allRaces.length,
        openSeats: allRaces.filter(r => r.isOpenSeat).length,
        filingOpen: allRaces.filter(r => r.filingStatus === 'open').length,
        dataSource: dataSource === 'live-scraped'
          ? 'Live scraped from USVoteFoundation.org + FEC + OpenStates'
          : 'Party of You 2026 Hard-Coded Calendar + FEC + OpenStates (run scraper to get live data)',
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
