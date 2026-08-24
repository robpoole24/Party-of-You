/**
 * CANDIDATE SCRAPER
 * src/jobs/scrape-candidates.js
 *
 * Scrapes declared candidates for state legislative, congressional,
 * and statewide races from three public sources:
 *
 *   1. PBS Wisconsin   — pbswisconsin.org/wisconsin-vote/all-candidates/
 *                        Best quality for WI. Name, party, race, incumbent,
 *                        individual candidate URLs.
 *
 *   2. Ballotpedia     — ballotpedia.org/[State]_State_Assembly_elections,[year]
 *                        All 50 states. Structured candidate tables per chamber.
 *                        URL patterns are standardized and predictable.
 *
 *   3. Wikipedia       — en.wikipedia.org/wiki/[year]_[State]_State_Assembly_election
 *                        Fallback for gaps. Wikitables are parseable but more variable.
 *
 * All sources are publicly available civic information. Scraping is done
 * with polite delays and descriptive User-Agent strings.
 *
 * Usage:
 *   node src/jobs/scrape-candidates.js pbs-wi
 *   node src/jobs/scrape-candidates.js ballotpedia WI
 *   node src/jobs/scrape-candidates.js ballotpedia all
 *   node src/jobs/scrape-candidates.js wikipedia WI
 *   node src/jobs/scrape-candidates.js all
 *
 * Admin API endpoint:
 *   POST /api/admin/scrape/candidates { source: 'pbs-wi' | 'ballotpedia' | 'wikipedia' | 'all', state: 'WI' | 'all' }
 */

const ELECTION_YEAR = 2026;

// ─────────────────────────────────────────────────
// BALLOTPEDIA URL PATTERNS
// ─────────────────────────────────────────────────

// State name → Ballotpedia slug format (Title_Case_With_Underscores)
const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New_Hampshire', NJ: 'New_Jersey', NM: 'New_Mexico', NY: 'New_York',
  NC: 'North_Carolina', ND: 'North_Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode_Island', SC: 'South_Carolina',
  SD: 'South_Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West_Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
};

// Lower chamber names by state (for Ballotpedia URL construction)
const LOWER_CHAMBER_NAMES = {
  CA: 'State_Assembly', NY: 'State_Assembly', WI: 'State_Assembly',
  WA: 'State_House_of_Representatives', NJ: 'General_Assembly',
  MD: 'House_of_Delegates', VA: 'House_of_Delegates',
  WV: 'House_of_Delegates',
  // Default for all others: 'House_of_Representatives'
};

function getLowerChamberName(state) {
  return LOWER_CHAMBER_NAMES[state] || 'House_of_Representatives';
}

function ballotpediaUrls(state, year = ELECTION_YEAR) {
  const name = STATE_NAMES[state];
  if (!name) return [];
  const lower = getLowerChamberName(state);
  return [
    {
      officeType: 'state_senate',
      url: `https://ballotpedia.org/${name}_State_Senate_elections,_${year}`,
    },
    {
      officeType: 'state_house',
      url: `https://ballotpedia.org/${name}_${lower}_elections,_${year}`,
    },
    {
      officeType: 'us_house',
      url: `https://ballotpedia.org/United_States_House_of_Representatives_elections_in_${name},_${year}`,
    },
  ];
}

function wikipediaUrls(state, year = ELECTION_YEAR) {
  const name = STATE_NAMES[state];
  if (!name) return [];
  const lower = getLowerChamberName(state);
  return [
    {
      officeType: 'state_senate',
      url: `https://en.wikipedia.org/wiki/${year}_${name}_State_Senate_election`,
    },
    {
      officeType: 'state_house',
      url: `https://en.wikipedia.org/wiki/${year}_${name}_${lower}_election`,
    },
  ];
}

// ─────────────────────────────────────────────────
// HTTP HELPER — matches election calendar scraper pattern
// ─────────────────────────────────────────────────

async function fetchPage(url, label = '') {
  console.log(`[CandidateScraper] Fetching ${label || url}`);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Party of You Civic Platform / candidate-data-aggregator (partyofyou.org; civic engagement tool; contact: robpoole24@gmail.com)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────
// HTML → TEXT UTILITY
// ─────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Extract text content of an HTML element (first match)
function extractTag(html, tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? stripHtml(match[1]).trim() : null;
}

// ─────────────────────────────────────────────────
// SOURCE 1: PBS WISCONSIN
// Scrapes the all-candidates table at pbswisconsin.org.
// Returns array of candidate objects.
// ─────────────────────────────────────────────────

function parsePbsWiTable(html) {
  const candidates = [];

  // The fetched page comes back as markdown (web_fetch converts HTML→markdown).
  // Candidate rows look like:
  //   | [Name](url) \* | Party | [Race label](url) | Incumbent |
  //   | [Name](url)    | Party | [Race label](url) |           |
  //
  // Split into lines and parse each pipe-delimited row.

  const lines = html.split('\n');

  for (const line of lines) {
    // Must be a pipe-delimited row with at least 3 columns
    if (!line.trim().startsWith('|')) continue;

    const cells = line.split('|').map(c => c.trim()).filter((c, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 3) continue;

    const [nameCell, partyCell, raceCell, incumbentCell = ''] = cells;

    // Skip header and separator rows
    if (/^[-:\s]+$/.test(nameCell) || /^Name$/i.test(nameCell)) continue;

    // Extract name and URL from markdown link: [Name](url) or [Name](url) \*
    const nameMatch = nameCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (!nameMatch) continue;

    const name = nameMatch[1].replace(/\s*\\?\*\s*$/, '').trim();
    const candidateUrl = nameMatch[2];

    // Party
    const party = partyCell.trim();
    if (!party || /^[-|\s]*$/.test(party)) continue;

    // Race label and URL
    const raceMatch = raceCell.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const raceLabel = raceMatch ? raceMatch[1].trim() : raceCell.trim();
    const raceUrl = raceMatch ? raceMatch[2] : null;

    // Incumbent: cell 4 contains "Incumbent" text, or name cell has \*
    const isIncumbent = /incumbent/i.test(incumbentCell) ||
                        /\\?\*/.test(nameCell);

    const { officeType, district } = parseWiRaceLabel(raceLabel);

    if (!name || !party) continue;

    candidates.push({
      state: 'WI',
      officeType,
      district,
      name,
      party: normalizeParty(party),
      isIncumbent,
      sourceUrl: candidateUrl.startsWith('http') ? candidateUrl : `https://pbswisconsin.org${candidateUrl}`,
      raceUrl: raceUrl ? (raceUrl.startsWith('http') ? raceUrl : `https://pbswisconsin.org${raceUrl}`) : null,
      source: 'pbs_wi',
      electionYear: ELECTION_YEAR,
    });
  }

  console.log(`[CandidateScraper] PBS WI: parsed ${candidates.length} candidates`);
  return candidates;
}

function parseWiRaceLabel(label) {
  // "Assembly District 56" → state_house, "56"
  const assemblyMatch = label.match(/Assembly\s+District\s+(\d+)/i);
  if (assemblyMatch) return { officeType: 'state_house', district: assemblyMatch[1] };

  // "Senate District 3" → state_senate, "3"
  const senateMatch = label.match(/Senate\s+District\s+(\d+)/i);
  if (senateMatch) return { officeType: 'state_senate', district: senateMatch[1] };

  // "U.S. Representative District 2" → us_house, "2"
  const usHouseMatch = label.match(/U\.?S\.?\s+Representative\s+District\s+(\d+)/i);
  if (usHouseMatch) return { officeType: 'us_house', district: usHouseMatch[1] };

  // Statewide offices
  if (/governor/i.test(label)) return { officeType: 'governor', district: 'statewide' };
  if (/lieutenant\s+governor/i.test(label)) return { officeType: 'lt_governor', district: 'statewide' };
  if (/attorney\s+general/i.test(label)) return { officeType: 'attorney_general', district: 'statewide' };
  if (/secretary\s+of\s+state/i.test(label)) return { officeType: 'secretary_of_state', district: 'statewide' };
  if (/treasurer/i.test(label)) return { officeType: 'treasurer', district: 'statewide' };

  return { officeType: 'other', district: null };
}

async function scrapePbsWisconsin(db = null) {
  const url = 'https://pbswisconsin.org/wisconsin-vote/all-candidates/';

  let html;
  try {
    html = await fetchPage(url, 'PBS Wisconsin all-candidates');
  } catch (err) {
    console.error('[CandidateScraper] PBS WI fetch failed:', err.message);
    return { success: false, error: err.message, candidates: [] };
  }

  const candidates = parsePbsWiTable(html);

  if (db && candidates.length > 0) {
    const inserted = await upsertCandidates(candidates, db);
    console.log(`[CandidateScraper] PBS WI: upserted ${inserted} candidates`);
  }

  return { success: true, source: 'pbs_wi', state: 'WI', count: candidates.length, candidates };
}

// ─────────────────────────────────────────────────
// SOURCE 2: BALLOTPEDIA
// Scrapes candidate tables from Ballotpedia election pages.
// ─────────────────────────────────────────────────

function parseBallotpediaTable(html, state, officeType) {
  const candidates = [];

  // Ballotpedia candidate tables have a wikitable class
  // Columns are typically: Candidate | Party | [Status/Incumbent]
  // Find all wikitable sections
  const tables = html.match(/<table[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/gi) || [];

  // Also look for the specific "candidates" section tables
  // Ballotpedia uses sortable tables too
  const allTables = html.match(/<table[^>]*class="[^"]*(wikitable|sortable)[^"]*"[\s\S]*?<\/table>/gi) || [];
  const tablesToParse = allTables.length > 0 ? allTables : tables;

  for (const table of tablesToParse) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    let headers = [];

    for (const row of rows) {
      // Parse header row
      if (/<th/i.test(row)) {
        headers = (row.match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [])
          .map(h => stripHtml(h).toLowerCase().trim());
        continue;
      }

      const cells = (row.match(/<td[\s\S]*?<\/td>/gi) || []);
      if (cells.length < 2) continue;

      // Try to extract candidate name and party
      // Ballotpedia format varies — try multiple strategies

      // Strategy 1: Look for a link in the first cell (candidate name links to their page)
      const firstCell = cells[0];
      const nameLink = firstCell.match(/href="([^"]+)"[^>]*>([^<]+)</i);
      const name = nameLink ? nameLink[2].trim() : stripHtml(firstCell).trim();
      const candidateUrl = nameLink ? nameLink[1] : null;

      if (!name || name.length < 2) continue;

      // Strategy 2: Party in second cell
      const party = cells[1] ? normalizeParty(stripHtml(cells[1]).trim()) : null;

      // Strategy 3: Incumbent detection — look for checkmark, "incumbent", or bold
      const rowText = stripHtml(row).toLowerCase();
      const isIncumbent = /incumbent|✓|✔|current/.test(rowText) ||
                          /font-weight:\s*bold|<b>/.test(cells[0]);

      // Strategy 4: Extract district from URL or context
      // Ballotpedia district pages have URLs like /Wisconsin_State_Assembly_District_26
      const district = extractDistrictFromUrl(candidateUrl) ||
                       extractDistrictFromContext(row, officeType);

      if (!name || !party) continue;
      // Skip header-looking rows
      if (/^(?:candidate|name|party|office)$/i.test(name)) continue;

      candidates.push({
        state,
        officeType,
        district: district || null,
        name,
        party,
        isIncumbent,
        sourceUrl: candidateUrl
          ? (candidateUrl.startsWith('http') ? candidateUrl : `https://ballotpedia.org${candidateUrl}`)
          : null,
        source: 'ballotpedia',
        electionYear: ELECTION_YEAR,
      });
    }
  }

  return candidates;
}

function extractDistrictFromUrl(url) {
  if (!url) return null;
  // /Wisconsin_State_Assembly_District_26 → "26"
  const match = url.match(/District_(\d+)/i);
  return match ? match[1] : null;
}

function extractDistrictFromContext(rowHtml, officeType) {
  // Look for district numbers in links within the row
  const districtMatch = rowHtml.match(/District\s+(\d+)/i);
  return districtMatch ? districtMatch[1] : null;
}

async function scrapeBallotpediaState(state, db = null, delay = 2000) {
  const urls = ballotpediaUrls(state, ELECTION_YEAR);
  const allCandidates = [];

  for (const { officeType, url } of urls) {
    try {
      const html = await fetchPage(url, `Ballotpedia ${state} ${officeType}`);
      const candidates = parseBallotpediaTable(html, state, officeType);

      console.log(`[CandidateScraper] Ballotpedia ${state} ${officeType}: ${candidates.length} candidates`);
      allCandidates.push(...candidates);

      if (delay > 0) await sleep(delay);
    } catch (err) {
      console.warn(`[CandidateScraper] Ballotpedia ${state} ${officeType} failed: ${err.message}`);
    }
  }

  if (db && allCandidates.length > 0) {
    const inserted = await upsertCandidates(allCandidates, db);
    console.log(`[CandidateScraper] Ballotpedia ${state}: upserted ${inserted} total`);
  }

  return { success: true, source: 'ballotpedia', state, count: allCandidates.length };
}

async function scrapeBallotpediaAll(db = null, delay = 2000) {
  const states = Object.keys(STATE_NAMES);
  const results = { success: [], failed: [], total: states.length };

  for (const state of states) {
    try {
      const result = await scrapeBallotpediaState(state, db, delay);
      results.success.push({ state, count: result.count });
    } catch (err) {
      console.error(`[CandidateScraper] Ballotpedia ${state} failed:`, err.message);
      results.failed.push({ state, error: err.message });
    }
    // Extra delay between states
    await sleep(delay);
  }

  console.log(`[CandidateScraper] Ballotpedia all: ${results.success.length} states succeeded, ${results.failed.length} failed`);
  return results;
}

// ─────────────────────────────────────────────────
// SOURCE 3: WIKIPEDIA
// Fallback scraper for states/chambers not covered by Ballotpedia.
// Wikipedia election articles use wikitables with similar structure.
// ─────────────────────────────────────────────────

function parseWikipediaTable(html, state, officeType) {
  // Wikipedia wikitables have class="wikitable"
  // Candidate tables in election articles are typically:
  // | Candidate | Party | District | Status |
  // Very similar to Ballotpedia — reuse same parser with Wikipedia-specific tweaks

  const candidates = parseBallotpediaTable(html, state, officeType);

  // Mark source as wikipedia
  return candidates.map(c => ({ ...c, source: 'wikipedia' }));
}

async function scrapeWikipediaState(state, db = null, delay = 2000) {
  const urls = wikipediaUrls(state, ELECTION_YEAR);
  const allCandidates = [];

  for (const { officeType, url } of urls) {
    try {
      const html = await fetchPage(url, `Wikipedia ${state} ${officeType}`);
      const candidates = parseWikipediaTable(html, state, officeType);

      console.log(`[CandidateScraper] Wikipedia ${state} ${officeType}: ${candidates.length} candidates`);
      allCandidates.push(...candidates);

      if (delay > 0) await sleep(delay);
    } catch (err) {
      console.warn(`[CandidateScraper] Wikipedia ${state} ${officeType} failed: ${err.message}`);
    }
  }

  if (db && allCandidates.length > 0) {
    const inserted = await upsertCandidates(allCandidates, db);
    console.log(`[CandidateScraper] Wikipedia ${state}: upserted ${inserted} total`);
  }

  return { success: true, source: 'wikipedia', state, count: allCandidates.length };
}

// ─────────────────────────────────────────────────
// NORMALIZERS
// ─────────────────────────────────────────────────

function normalizeParty(raw) {
  if (!raw) return null;
  const p = raw.trim().toLowerCase();
  if (/^d(em)?|democratic/.test(p)) return 'Democratic';
  if (/^r(ep)?|republican/.test(p)) return 'Republican';
  if (/^i(nd)?|independent/.test(p)) return 'Independent';
  if (/green/.test(p)) return 'Green';
  if (/libertarian/.test(p)) return 'Libertarian';
  if (/working\s+families/.test(p)) return 'Working Families';
  if (/constitution/.test(p)) return 'Constitution';
  // Return title-cased original if no match
  return raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase();
}

// ─────────────────────────────────────────────────
// DATABASE OPERATIONS
// ─────────────────────────────────────────────────

async function ensureTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS election_candidates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      state CHAR(2) NOT NULL,
      office_type TEXT NOT NULL,
      district TEXT,
      name TEXT NOT NULL,
      party TEXT,
      is_incumbent BOOLEAN DEFAULT FALSE,
      source TEXT NOT NULL,
      source_url TEXT,
      race_url TEXT,
      photo_url TEXT,
      website_url TEXT,
      bio_snippet TEXT,
      election_year INTEGER NOT NULL DEFAULT ${ELECTION_YEAR},
      scraped_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(state, office_type, district, name, election_year)
    );
    CREATE INDEX IF NOT EXISTS idx_election_candidates_state ON election_candidates(state);
    CREATE INDEX IF NOT EXISTS idx_election_candidates_district ON election_candidates(state, office_type, district);
    CREATE INDEX IF NOT EXISTS idx_election_candidates_year ON election_candidates(election_year);
  `);
  console.log('[CandidateScraper] election_candidates table ensured');
}

async function upsertCandidates(candidates, db) {
  let count = 0;
  for (const c of candidates) {
    try {
      await db.query(`
        INSERT INTO election_candidates (
          state, office_type, district, name, party, is_incumbent,
          source, source_url, race_url, photo_url, website_url, bio_snippet,
          election_year, scraped_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
        ON CONFLICT (state, office_type, district, name, election_year)
        DO UPDATE SET
          party          = COALESCE(EXCLUDED.party, election_candidates.party),
          is_incumbent   = EXCLUDED.is_incumbent OR election_candidates.is_incumbent,
          source         = CASE
                             WHEN EXCLUDED.source = 'pbs_wi' THEN EXCLUDED.source
                             ELSE election_candidates.source
                           END,
          source_url     = COALESCE(EXCLUDED.source_url, election_candidates.source_url),
          race_url       = COALESCE(EXCLUDED.race_url, election_candidates.race_url),
          photo_url      = COALESCE(EXCLUDED.photo_url, election_candidates.photo_url),
          website_url    = COALESCE(EXCLUDED.website_url, election_candidates.website_url),
          bio_snippet    = COALESCE(EXCLUDED.bio_snippet, election_candidates.bio_snippet),
          scraped_at     = NOW()
      `, [
        c.state, c.officeType, c.district || null, c.name, c.party || null,
        c.isIncumbent || false,
        c.source, c.sourceUrl || null, c.raceUrl || null,
        c.photoUrl || null, c.websiteUrl || null, c.bioSnippet || null,
        c.electionYear || ELECTION_YEAR,
      ]);
      count++;
    } catch (err) {
      console.error(`[CandidateScraper] DB upsert failed for ${c.name} (${c.state} ${c.officeType} ${c.district}):`, err.message);
    }
  }
  return count;
}

/**
 * Query candidates for a specific race — used by races.js to attach
 * real candidate data to race cards.
 */
async function getCandidatesForRace(db, state, officeType, district, year = ELECTION_YEAR) {
  if (!db) return [];
  try {
    const result = await db.query(`
      SELECT name, party, is_incumbent, source, source_url, photo_url, website_url
      FROM election_candidates
      WHERE state = $1
        AND office_type = $2
        AND (district = $3 OR ($3 IS NULL AND district IS NULL))
        AND election_year = $4
      ORDER BY is_incumbent DESC, name ASC
    `, [state, officeType, district || null, year]);
    return result.rows;
  } catch (err) {
    // Table may not exist yet — non-fatal
    return [];
  }
}

// ─────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────

async function scrapeAll(db = null, delay = 2000) {
  const results = {};

  // PBS Wisconsin first — highest quality WI data
  console.log('[CandidateScraper] Starting PBS Wisconsin scrape...');
  results.pbsWi = await scrapePbsWisconsin(db);

  await sleep(delay);

  // Ballotpedia for all states
  console.log('[CandidateScraper] Starting Ballotpedia scrape (all states)...');
  results.ballotpedia = await scrapeBallotpediaAll(db, delay);

  console.log('[CandidateScraper] All sources complete.');
  return results;
}

// ─────────────────────────────────────────────────
// EXPORTS — same shape as scrape-election-calendar.js
// ─────────────────────────────────────────────────

module.exports = {
  scrapePbsWisconsin,
  scrapeBallotpediaState,
  scrapeBallotpediaAll,
  scrapeWikipediaState,
  scrapeAll,
  ensureTable,
  getCandidatesForRace,
  parsePbsWiTable,
  parseBallotpediaTable,
  normalizeParty,
  STATE_NAMES,
};

// ─────────────────────────────────────────────────
// CLI — node src/jobs/scrape-candidates.js [source] [state]
// ─────────────────────────────────────────────────

if (require.main === module) {
  const source = process.argv[2] || 'pbs-wi';
  const stateArg = (process.argv[3] || 'WI').toUpperCase();

  console.log(`[CandidateScraper] Starting: source=${source} state=${stateArg}`);

  (async () => {
    try {
      let result;

      switch (source.toLowerCase()) {
        case 'pbs-wi':
        case 'pbs_wi':
          result = await scrapePbsWisconsin();
          break;

        case 'ballotpedia':
          if (stateArg === 'ALL') {
            result = await scrapeBallotpediaAll(null, 2000);
          } else {
            result = await scrapeBallotpediaState(stateArg);
          }
          break;

        case 'wikipedia':
          result = await scrapeWikipediaState(stateArg);
          break;

        case 'all':
          result = await scrapeAll(null, 2000);
          break;

        default:
          console.error(`Unknown source: ${source}`);
          console.error('Usage: node scrape-candidates.js [pbs-wi|ballotpedia|wikipedia|all] [STATE|all]');
          process.exit(1);
      }

      // Print summary
      if (result?.candidates) {
        console.log(`\nSample candidates (first 10):`);
        result.candidates.slice(0, 10).forEach(c => {
          console.log(`  ${c.name} (${c.party}) — ${c.officeType} ${c.district || ''} [${c.isIncumbent ? 'incumbent' : 'challenger'}]`);
        });
      }
      console.log(`\nResult:`, JSON.stringify(
        result?.candidates ? { ...result, candidates: `[${result.candidates.length} candidates]` } : result,
        null, 2
      ));

    } catch (err) {
      console.error('[CandidateScraper] Fatal error:', err.message);
      process.exit(1);
    }
  })();
}
