/**
 * ELECTION CALENDAR SCRAPER
 * src/jobs/scrape-election-calendar.js
 *
 * Scrapes election dates and deadlines from USVoteFoundation.org
 * for all 50 states. Stores results in the election_calendar table
 * in the database. Designed to run on a schedule (weekly cron).
 *
 * Data source: https://www.usvotefoundation.org/[state]-election-dates-and-deadlines
 * This is publicly available government election data displayed freely.
 *
 * Usage:
 *   node src/jobs/scrape-election-calendar.js [state_abbr]
 *   node src/jobs/scrape-election-calendar.js WI
 *   node src/jobs/scrape-election-calendar.js all
 *
 * Admin API endpoint:
 *   POST /api/admin/scrape/election-calendar { state: 'WI' | 'all' }
 */

const STATE_SLUGS = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas',
  CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware',
  FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho',
  IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas',
  KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
  MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi',
  MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada',
  NH: 'new-hampshire', NJ: 'new-jersey', NM: 'new-mexico', NY: 'new-york',
  NC: 'north-carolina', ND: 'north-dakota', OH: 'ohio', OK: 'oklahoma',
  OR: 'oregon', PA: 'pennsylvania', RI: 'rhode-island', SC: 'south-carolina',
  SD: 'south-dakota', TN: 'tennessee', TX: 'texas', UT: 'utah',
  VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west-virginia',
  WI: 'wisconsin', WY: 'wyoming',
};

// Parse a date string like "Tue Aug 11, 2026" → "2026-08-11"
function parseDate(str) {
  if (!str) return null;
  str = str.trim().replace(/\s+/g, ' ');

  // Try "Tue Aug 11, 2026" format (from page headers)
  const longMatch = str.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (longMatch) {
    const months = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
    const m = months[longMatch[1].substring(0,3)];
    if (m) {
      const d = new Date(parseInt(longMatch[3]), m-1, parseInt(longMatch[2]));
      return d.toISOString().split('T')[0];
    }
  }

  // Try standard date parse
  const d = new Date(str);
  if (!isNaN(d)) return d.toISOString().split('T')[0];

  return null;
}

// Parse markdown content from USVoteFoundation page into structured data
function parseStateCalendar(markdown, stateAbbr, stateName) {
  const elections = [];
  const lines = markdown.split('\n');

  // Helper: get next non-blank line after index i
  function nextValue(i) {
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const v = lines[j].trim();
      if (v) return v;
    }
    return '';
  }

  let currentElection = null;
  let currentSection = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect election header — page uses h3 tags which become ### in markdown
    // e.g. "### Tue Aug 11, 2026 - Wisconsin Congressional Primary Election"
    const electionMatch = line.match(/^#{2,4}\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\w+\s+\d+,\s+\d+)\s+-\s+(.+)$/i);
    if (electionMatch) {
      if (currentElection) elections.push(currentElection);
      const dateStr = electionMatch[1];
      const title = electionMatch[2];

      const isPrimary = /primary/i.test(title);
      const isGeneral = /general/i.test(title);
      const isLocal = /local|municipal|city|county|school/i.test(title);
      const isSpecial = /special/i.test(title);

      currentElection = {
        state: stateAbbr,
        stateName,
        electionDate: parseDate(dateStr),
        title,
        type: isPrimary ? 'primary' : isGeneral ? 'general' : isSpecial ? 'special' : 'other',
        level: isLocal ? 'local' : 'federal_state',
        registrationDeadlines: {},
        absenteeRequestDeadline: {},
        absenteeReturnDeadline: null,
        earlyVoting: {},
        scrapedAt: new Date().toISOString(),
        source: 'usvotefoundation.org',
      };
      currentSection = null;
      continue;
    }

    if (!currentElection) continue;

    // Detect section headers (h4 on real page = #### in markdown, but match any # level)
    if (/#{1,4}\s+Voter Registration Deadline/i.test(line)) { currentSection = 'registration'; continue; }
    if (/#{1,4}\s+Absentee Ballot Request Deadline/i.test(line)) { currentSection = 'absenteeRequest'; continue; }
    if (/#{1,4}\s+Absentee Ballot Return Deadline/i.test(line)) { currentSection = 'absenteeReturn'; continue; }
    if (/#{1,4}\s+Early Voting/i.test(line)) { currentSection = 'earlyVoting'; continue; }
    // Stop at overseas/military sections
    if (/#{1,4}\s+Overseas|#{1,4}\s+Military/i.test(line)) { currentSection = null; continue; }

    if (!currentSection || !line) continue;

    // Parse deadline items — use nextValue() to skip blank lines between label and date
    if (currentSection === 'registration') {
      if (/\*\*Postmarked by\*\*/i.test(line)) {
        const val = line.replace(/.*\*\*Postmarked by\*\*\s*/i, '') || nextValue(i);
        currentElection.registrationDeadlines.postmark = parseDate(val) || parseDate(nextValue(i));
      }
      if (/\*\*Online by\*\*/i.test(line)) {
        const inline = line.replace(/.*\*\*Online by\*\*\s*/i, '').replace(/\s*\d+:\d+\w*/g, '').trim();
        const next   = nextValue(i).replace(/\s*\d+:\d+\w*/g, '').trim();
        currentElection.registrationDeadlines.online = parseDate(inline) || parseDate(next);
      }
      if (/\*\*In-Person(?:\s+Request)?\s+by\*\*/i.test(line)) {
        const inline = line.replace(/.*\*\*In-Person[^*]*\*\*\s*/i, '').replace(/\s*\d+:\d+\w*/g, '').trim();
        const next   = nextValue(i).replace(/\s*\d+:\d+\w*/g, '').trim();
        currentElection.registrationDeadlines.inPerson = parseDate(inline) || parseDate(next);
      }
      if (/\*\*Election Day Registration/i.test(line)) {
        currentElection.registrationDeadlines.electionDay = true;
      }
    }

    if (currentSection === 'absenteeRequest') {
      // Matches: "Email by", "Online by", "Fax by", "Email, Online or Fax by"
      if (/\*\*(?:Email|Online|Fax)[^*]*by\*\*/i.test(line)) {
        const inline = line.replace(/.*\*\*[^*]+by\*\*\s*/i, '').trim();
        const next   = nextValue(i).trim();
        currentElection.absenteeRequestDeadline.online = parseDate(inline) || parseDate(next);
      }
      if (/\*\*Post(?:\s+Received)?\s+by\*\*/i.test(line)) {
        const inline = line.replace(/.*\*\*Post[^*]*by\*\*\s*/i, '').replace(/\s*\d+:\d+\w*/g, '').trim();
        const next   = nextValue(i).replace(/\s*\d+:\d+\w*/g, '').trim();
        currentElection.absenteeRequestDeadline.postReceived = parseDate(inline) || parseDate(next);
      }
    }

    if (currentSection === 'absenteeReturn') {
      if (/\*\*Received by\*\*/i.test(line)) {
        const inline = line.replace(/.*\*\*Received by\*\*\s*/i, '').replace(/\s*\d+:\d+\w*/g, '').trim();
        const next   = nextValue(i).replace(/\s*\d+:\d+\w*/g, '').trim();
        currentElection.absenteeReturnDeadline = parseDate(inline) || parseDate(next);
      }
    }

    if (currentSection === 'earlyVoting') {
      // "From Tue Jul 28, 2026 to Sun Aug 9, 2026"
      const fromMatch = line.match(/From\s+([\w\s,]+?)\s+to\s+([\w\s,]+?)(?:\s*$)/i);
      if (fromMatch) {
        currentElection.earlyVoting = {
          start: parseDate(fromMatch[1].trim()),
          end:   parseDate(fromMatch[2].trim()),
        };
      }
    }
  }

  if (currentElection) elections.push(currentElection);
  return elections.filter(e => e.electionDate);
}

// Fetch and parse one state
async function scrapeState(stateAbbr, db = null) {
  const slug = STATE_SLUGS[stateAbbr.toUpperCase()];
  if (!slug) throw new Error(`Unknown state: ${stateAbbr}`);

  const url = `https://www.usvotefoundation.org/${slug}-election-dates-and-deadlines`;
  console.log(`[Scraper] Fetching ${url}`);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Party of You Civic Platform / election-data-aggregator (partyofyou.org)',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const html = await res.text();

  // DEBUG: log first 500 chars of response to diagnose parsing issues
  console.log(`[Scraper] ${stateAbbr}: HTTP ${res.status}, body length: ${html.length}, first 200 chars: ${html.substring(0, 200).replace(/\n/g, '\\n')}`);

  // Convert HTML to parseable text
  // Extract the main content area by finding election date headers
  const markdown = html
    // Convert h2 tags
    .replace(/<h2[^>]*>(.*?)<\/h2>/gis, '\n## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gis, '\n### $1\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gis, '\n#### $1\n')
    // Convert strong/b to markdown bold
    .replace(/<strong>(.*?)<\/strong>/gis, '**$1**')
    .replace(/<b>(.*?)<\/b>/gis, '**$1**')
    // Convert li items
    .replace(/<li[^>]*>(.*?)<\/li>/gis, '- $1\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Clean up HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&#\d+;/g, '')
    // Clean up whitespace
    .replace(/\s{3,}/g, '\n\n')
    .trim();

  const stateName = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  // DEBUG: show markdown around election headers
  const h2idx = markdown.indexOf('\n## ');
  console.log(`[Scraper] ${stateAbbr}: markdown length: ${markdown.length}, first ## at index: ${h2idx}`);
  if (h2idx > -1) {
    console.log(`[Scraper] ${stateAbbr}: header context: ${markdown.substring(h2idx, h2idx + 150).replace(/\n/g, '\\n')}`);
  } else {
    console.log(`[Scraper] ${stateAbbr}: NO ## headers found. Sample markdown: ${markdown.substring(0, 300).replace(/\n/g, '\\n')}`);
  }

  const elections = parseStateCalendar(markdown, stateAbbr.toUpperCase(), stateName);

  console.log(`[Scraper] ${stateAbbr}: found ${elections.length} elections`);

  // Store in DB if connection provided
  if (db && elections.length > 0) {
    for (const election of elections) {
      try {
        await db.query(`
          INSERT INTO election_calendar (
            state, state_name, election_date, title, type, level,
            registration_deadline_online, registration_deadline_postmark,
            registration_deadline_in_person, election_day_registration,
            absentee_request_deadline_online, absentee_request_deadline_post,
            absentee_return_deadline,
            early_voting_start, early_voting_end,
            source, scraped_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,$10,
            $11,$12,$13,
            $14,$15,
            $16, NOW()
          )
          ON CONFLICT (state, election_date, type, level)
          DO UPDATE SET
            title = EXCLUDED.title,
            registration_deadline_online = EXCLUDED.registration_deadline_online,
            registration_deadline_postmark = EXCLUDED.registration_deadline_postmark,
            registration_deadline_in_person = EXCLUDED.registration_deadline_in_person,
            election_day_registration = EXCLUDED.election_day_registration,
            absentee_request_deadline_online = EXCLUDED.absentee_request_deadline_online,
            absentee_request_deadline_post = EXCLUDED.absentee_request_deadline_post,
            absentee_return_deadline = EXCLUDED.absentee_return_deadline,
            early_voting_start = EXCLUDED.early_voting_start,
            early_voting_end = EXCLUDED.early_voting_end,
            scraped_at = NOW()
        `, [
          election.state, election.stateName,
          election.electionDate, election.title,
          election.type, election.level,
          election.registrationDeadlines.online || null,
          election.registrationDeadlines.postmark || null,
          election.registrationDeadlines.inPerson || null,
          election.registrationDeadlines.electionDay || false,
          election.absenteeRequestDeadline.online || null,
          election.absenteeRequestDeadline.postReceived || null,
          election.absenteeReturnDeadline || null,
          election.earlyVoting.start || null,
          election.earlyVoting.end || null,
          election.source,
        ]);
      } catch (e) {
        console.error(`[Scraper] DB insert failed for ${stateAbbr} ${election.electionDate}:`, e.message);
      }
    }
  }

  return elections;
}

// Scrape all 50 states with rate limiting
async function scrapeAll(db = null, delay = 2000) {
  const states = Object.keys(STATE_SLUGS);
  const results = { success: [], failed: [], total: states.length };

  for (const state of states) {
    try {
      const elections = await scrapeState(state, db);
      results.success.push({ state, elections: elections.length });
    } catch (err) {
      console.error(`[Scraper] Failed ${state}:`, err.message);
      results.failed.push({ state, error: err.message });
    }

    // Polite delay between requests — be a good citizen
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.log(`[Scraper] Complete: ${results.success.length} succeeded, ${results.failed.length} failed`);
  return results;
}

// Create DB table if it doesn't exist
async function ensureTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS election_calendar (
      id SERIAL PRIMARY KEY,
      state CHAR(2) NOT NULL,
      state_name TEXT,
      election_date DATE NOT NULL,
      title TEXT,
      type TEXT,    -- 'primary', 'general', 'special', 'other'
      level TEXT,   -- 'federal_state', 'local'
      registration_deadline_online DATE,
      registration_deadline_postmark DATE,
      registration_deadline_in_person DATE,
      election_day_registration BOOLEAN DEFAULT false,
      absentee_request_deadline_online DATE,
      absentee_request_deadline_post DATE,
      absentee_return_deadline DATE,
      early_voting_start DATE,
      early_voting_end DATE,
      source TEXT DEFAULT 'usvotefoundation.org',
      scraped_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(state, election_date, type, level)
    );
    CREATE INDEX IF NOT EXISTS idx_election_calendar_state ON election_calendar(state);
    CREATE INDEX IF NOT EXISTS idx_election_calendar_date ON election_calendar(election_date);
  `);
}

module.exports = { scrapeState, scrapeAll, ensureTable, parseStateCalendar, STATE_SLUGS };

// Run directly: node src/jobs/scrape-election-calendar.js WI
if (require.main === module) {
  const arg = process.argv[2] || 'WI';
  console.log(`Running scraper for: ${arg}`);

  (async () => {
    try {
      if (arg.toLowerCase() === 'all') {
        const results = await scrapeAll(null, 1000);
        console.log(JSON.stringify(results, null, 2));
      } else {
        const elections = await scrapeState(arg.toUpperCase());
        console.log(JSON.stringify(elections, null, 2));
      }
    } catch (err) {
      console.error('Scraper error:', err.message);
      process.exit(1);
    }
  })();
}
