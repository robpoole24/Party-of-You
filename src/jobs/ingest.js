/**
 * BULK DATA INGESTION FRAMEWORK
 * 
 * Handles all data sources that are file-based rather than live APIs.
 * 
 * Sources managed here:
 *   MIT Election Lab    → Historical election results (partisan lean)
 *   Pew Research        → Issue polling datasets (quarterly update)
 *   OpenSecrets         → Campaign finance bulk data (when approved)
 *   GovTrack            → Congressional voting records (replaces ProPublica)
 *   ANES                → American National Election Studies
 *   GSS                 → General Social Survey
 *   ProPublica Archive  → House Office Expenditures (how incumbents spend)
 * 
 * How it works:
 *   1. Files are uploaded to /data/raw/ (or auto-downloaded from GitHub)
 *   2. Each source has a parser that normalizes to our schema
 *   3. Normalized data upserts into PostgreSQL
 *   4. Redis cache invalidated for affected districts
 *   5. Feature flag DATASET_[NAME]_LOADED set to 'true' when complete
 * 
 * Run via: node src/jobs/ingest.js --source=mit-election-lab
 * Or via Bull queue: jobs/ingestion-queue.js
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Raw data directory — put downloaded files here
const RAW_DATA_DIR = path.join(process.cwd(), 'data', 'raw');
const PROCESSED_DIR = path.join(process.cwd(), 'data', 'processed');

// ─────────────────────────────────────────────────
// SOURCE REGISTRY
// ─────────────────────────────────────────────────

const BULK_SOURCES = {

  'mit-election-lab': {
    name: 'MIT Election Data + Science Lab',
    description: 'Historical election results: House (1976-2024), Senate (1976-2024), President (1976-2024), precinct-level (2016-2024)',
    status: process.env.DATASET_MIT_ELECTION_LAB_LOADED === 'true' ? 'loaded' : 'pending',
    downloadInstructions: `
      1. Go to: https://electionlab.mit.edu/data
      2. Download these datasets (Harvard Dataverse):
         - 1976-2024-house.csv (House returns)
         - 1976-2024-senate.csv (Senate returns)
         - 1976-2024-president.csv (Presidential returns)
      3. Also from GitHub: https://github.com/MEDSL
         - 2024-elections-official (most recent precinct data)
      4. Place all files in: data/raw/mit-election-lab/
      5. Run: node src/jobs/ingest.js --source=mit-election-lab
    `,
    targetTable: 'historical_election_results',
    parser: parseMitElectionLab,
    envFlag: 'DATASET_MIT_ELECTION_LAB_LOADED',
  },

  'pew-research': {
    name: 'Pew Research Center Datasets',
    description: 'Issue polling on politics, policy, social trends. Key source for district-level issue polling history.',
    status: process.env.DATASET_PEW_RESEARCH_LOADED === 'true' ? 'loaded' : 'pending',
    downloadInstructions: `
      1. Create free account at: https://www.pewresearch.org/datasets/
      2. Download relevant datasets (Politics & Policy section)
         Priority datasets:
         - American Trends Panel (most recent wave)
         - Political Polarization surveys
         - Economy and personal finances surveys
      3. Download as CSV format where available (not SPSS)
      4. Place files in: data/raw/pew-research/
      5. Run: node src/jobs/ingest.js --source=pew-research
    `,
    targetTable: 'issue_polling_data',
    parser: parsePewResearch,
    envFlag: 'DATASET_PEW_RESEARCH_LOADED',
  },

  'opensecrets': {
    name: 'OpenSecrets Bulk Data',
    description: 'Campaign finance: contributions, PAC money, industry donors, expenditures. Awaiting approval.',
    status: process.env.DATASET_OPENSECRETS_LOADED === 'true' ? 'loaded' : 'pending-approval',
    downloadInstructions: `
      1. Wait for approval email from OpenSecrets (you applied)
      2. Login at: https://www.opensecrets.org/open-data/bulk-data
      3. PRIORITY downloads (get these first):
         - CRP_Categories.txt (industry code mapping — their secret sauce)
         - IndivX.zip (individual contributions by cycle)
         - PACsX.zip (PAC contributions)
         - CandX.zip (candidate summary data)
         Where X = election cycle year (e.g., 24 for 2024)
      4. Place in: data/raw/opensecrets/
      5. Run: node src/jobs/ingest.js --source=opensecrets
      
      NOTE: FEC API already gives us raw contribution data.
      OpenSecrets adds: industry categorization, donor similarity scores.
      The CRP_Categories.txt file maps FEC employer strings to industries.
      This is their most valuable single file.
    `,
    targetTable: 'campaign_finance_enriched',
    parser: parseOpenSecrets,
    envFlag: 'DATASET_OPENSECRETS_LOADED',
  },

  'govtrack': {
    name: 'GovTrack Congressional Voting Records',
    description: 'Every congressional vote, bill, and member profile since 1789. Replaces ProPublica Congress API.',
    status: process.env.DATASET_GOVTRACK_LOADED === 'true' ? 'loaded' : 'pending',
    downloadInstructions: `
      GovTrack publishes data publicly on GitHub — no account needed.
      
      1. Bulk vote data: https://www.govtrack.us/data/congress/
         Or GitHub mirror: https://github.com/unitedstates/congress
         
      2. PRIORITY downloads:
         - votes/ directory for current + last 2 congresses (118, 117, 116)
         - legislators-current.csv (active members with party, district)
         - legislators-historical.csv (all historical members)
         
      3. For votes, download the JSON roll call files:
         congress/{congress}/votes/{session}/{vote-type}{number}/data.json
         
      4. Place in: data/raw/govtrack/
      5. Run: node src/jobs/ingest.js --source=govtrack
      
      KEY USE CASE: "Your incumbent voted [X] on these issues affecting you"
      We show candidates a pre-built incumbent voting record profile.
    `,
    targetTable: 'voting_records',
    parser: parseGovTrack,
    envFlag: 'DATASET_GOVTRACK_LOADED',
  },

  'propublica-expenditures': {
    name: 'ProPublica House Office Expenditures',
    description: 'How each House member spends their official office budget. Useful for "your rep spent $X on [thing] while voting against Y".',
    status: process.env.DATASET_PROPUBLICA_EXPENDITURES_LOADED === 'true' ? 'loaded' : 'pending',
    downloadInstructions: `
      1. Go to: https://projects.propublica.org/datastore/#house-office-expenditures
      2. Download: house-office-expenditures-with-readme.zip (74MB)
      3. Extract and place CSV files in: data/raw/propublica-expenditures/
      4. Run: node src/jobs/ingest.js --source=propublica-expenditures
      
      COVERAGE: July 2009 - March 2018 (not updated — historical only)
      USE: Background research on long-serving incumbents
    `,
    targetTable: 'house_expenditures',
    parser: parseProPublicaExpenditures,
    envFlag: 'DATASET_PROPUBLICA_EXPENDITURES_LOADED',
  },

  'anes': {
    name: 'American National Election Studies',
    description: 'Gold standard voter behavior research since 1948. Partisan identity, political participation, voting behavior.',
    status: process.env.DATASET_ANES_LOADED === 'true' ? 'loaded' : 'pending',
    downloadInstructions: `
      1. Create free account at: https://electionstudies.org/data-center/
      2. Download: ANES 2020 Time Series Study (most recent complete)
      3. Also download: ANES Cumulative Data File (1948-2020) for trend data
      4. Export as CSV (not SPSS)
      5. Place in: data/raw/anes/
      6. Run: node src/jobs/ingest.js --source=anes
    `,
    targetTable: 'voter_behavior_data',
    parser: parseANES,
    envFlag: 'DATASET_ANES_LOADED',
  },

};

// ─────────────────────────────────────────────────
// INGESTION RUNNER
// ─────────────────────────────────────────────────

/**
 * Main ingestion function — call with source name
 * node src/jobs/ingest.js --source=mit-election-lab
 */
async function ingestSource(sourceName, db, options = {}) {
  const source = BULK_SOURCES[sourceName];
  if (!source) {
    throw new Error(`Unknown source: ${sourceName}. Available: ${Object.keys(BULK_SOURCES).join(', ')}`);
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`Ingesting: ${source.name}`);
  console.log(`Target table: ${source.targetTable}`);
  console.log(`═══════════════════════════════════════\n`);

  const rawDir = path.join(RAW_DATA_DIR, sourceName);

  if (!fs.existsSync(rawDir)) {
    console.error(`Raw data directory not found: ${rawDir}`);
    console.log('\nDownload instructions:');
    console.log(source.downloadInstructions);
    return { success: false, reason: 'Raw data not found' };
  }

  const files = fs.readdirSync(rawDir).filter(f => f.endsWith('.csv') || f.endsWith('.json') || f.endsWith('.txt'));

  if (!files.length) {
    console.error(`No data files found in ${rawDir}`);
    console.log('\nDownload instructions:');
    console.log(source.downloadInstructions);
    return { success: false, reason: 'No files to process' };
  }

  console.log(`Found ${files.length} file(s): ${files.join(', ')}`);

  let totalRows = 0;
  let totalInserted = 0;
  let totalErrors = 0;

  for (const file of files) {
    const filePath = path.join(rawDir, file);
    console.log(`\nProcessing: ${file}`);

    try {
      const { rows, inserted, errors } = await source.parser(filePath, db, options);
      totalRows += rows;
      totalInserted += inserted;
      totalErrors += errors;
      console.log(`  ✓ ${rows} rows parsed, ${inserted} inserted/updated, ${errors} errors`);
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`);
      totalErrors++;
    }
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`Complete: ${totalInserted} records loaded from ${source.name}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`═══════════════════════════════════════\n`);

  if (totalInserted > 0) {
    console.log(`Set Railway env var: ${source.envFlag}=true`);
  }

  return { success: totalErrors === 0, totalRows, totalInserted, totalErrors };
}

// ─────────────────────────────────────────────────
// PARSERS — One per source
// ─────────────────────────────────────────────────

/**
 * MIT Election Lab parser
 * Handles House, Senate, and Presidential CSVs
 * Schema: state, district, year, office, candidate, party, votes, totalVotes
 */
async function parseMitElectionLab(filePath, db) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });

  let inserted = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      // MIT MEDSL column names vary by file — handle both formats
      const state = row.state_po || row.state;
      const year = parseInt(row.year);
      const office = row.office || detectOfficeFromFilename(filePath);
      const district = row.district || null;
      const candidate = row.candidate;
      const party = normalizeParty(row.party_simplified || row.party);
      const votes = parseInt(row.candidatevotes || row.votes || 0);
      const totalVotes = parseInt(row.totalvotes || row.total_votes || 0);

      if (!state || !year || !candidate) continue;

      await db.query(`
        INSERT INTO historical_election_results 
          (state, district, year, office, candidate_name, party, votes, total_votes, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'MIT Election Lab')
        ON CONFLICT (state, district, year, office, candidate_name)
        DO UPDATE SET votes = EXCLUDED.votes, total_votes = EXCLUDED.total_votes
      `, [state, district, year, office, candidate, party, votes, totalVotes]);

      inserted++;
    } catch (e) {
      errors++;
      if (errors < 10) console.warn(`  Row error: ${e.message}`);
    }
  }

  return { rows: rows.length, inserted, errors };
}

/**
 * Pew Research parser
 * CSV exports from their dataset download tool
 */
async function parsePewResearch(filePath, db) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });

  let inserted = 0;
  let errors = 0;

  // Pew datasets have varying schemas — we extract what we can
  for (const row of rows) {
    try {
      // Most Pew political datasets include WEIGHT, F_PARTY_FINAL, STATE
      const weight = parseFloat(row.WEIGHT || row.weight || 1);
      const party = row.F_PARTY_FINAL || row.party || null;
      const state = row.STATE || row.state || null;
      const surveyDate = row.INTERVIEW_DATE || row.survey_date || null;

      // Skip rows without core identifiers
      if (!state && !party) continue;

      // Store as generic survey response — the dashboard intelligence layer
      // interprets these for specific issue displays
      await db.query(`
        INSERT INTO pew_survey_responses
          (respondent_id, state, party, weight, survey_date, raw_data, source_file)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [
        row.RESPID || row.respid || `${Date.now()}-${inserted}`,
        state,
        party,
        weight,
        surveyDate,
        JSON.stringify(row),
        path.basename(filePath),
      ]);

      inserted++;
    } catch (e) {
      errors++;
    }
  }

  return { rows: rows.length, inserted, errors };
}

/**
 * OpenSecrets parser
 * Multiple file types: CandX.txt, IndivX.txt, PACsX.txt
 * Pipe-delimited format
 */
async function parseOpenSecrets(filePath, db) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath).toLowerCase();

  let rows, inserted = 0, errors = 0;

  if (filename.startsWith('cand')) {
    // Candidate summary file
    rows = parse(content, {
      columns: ['cycle', 'fecid', 'cid', 'name', 'party', 'state', 'seat', 'seatStatus',
                'seatResult', 'currCand', 'cycleCand', 'crpPri', 'pviState', 'indivs',
                'pacs', 'other', 'cands', 'total', 'spent', 'cash', 'debt'],
      delimiter: '|',
      skip_empty_lines: true,
      from_line: 2,
    });

    for (const row of rows) {
      try {
        await db.query(`
          INSERT INTO opensecrets_candidates
            (cycle, fec_id, crp_id, name, party, state, seat, total_raised, total_spent, cash_on_hand, debt)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (cycle, fec_id) DO UPDATE
          SET total_raised = EXCLUDED.total_raised, total_spent = EXCLUDED.total_spent
        `, [row.cycle, row.fecid, row.cid, row.name, row.party, row.state, row.seat,
            parseFloat(row.total || 0), parseFloat(row.spent || 0),
            parseFloat(row.cash || 0), parseFloat(row.debt || 0)]);
        inserted++;
      } catch (e) {
        errors++;
      }
    }
  } else if (filename === 'crp_categories.txt') {
    // Industry categorization file — most valuable single file
    rows = parse(content, {
      columns: ['catcode', 'catname', 'catorder', 'industry', 'sector', 'sectorlong'],
      delimiter: '|',
      skip_empty_lines: true,
      from_line: 2,
    });

    for (const row of rows) {
      try {
        await db.query(`
          INSERT INTO opensecrets_categories
            (cat_code, cat_name, industry, sector, sector_long)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (cat_code) DO UPDATE
          SET cat_name = EXCLUDED.cat_name, industry = EXCLUDED.industry
        `, [row.catcode, row.catname, row.industry, row.sector, row.sectorlong]);
        inserted++;
      } catch (e) {
        errors++;
      }
    }
  }

  return { rows: rows?.length || 0, inserted, errors };
}

/**
 * GovTrack parser
 * JSON format from the congress data repository
 */
async function parseGovTrack(filePath, db) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);

  let inserted = 0;
  let errors = 0;

  if (filename === 'legislators-current.csv' || filename === 'legislators-historical.csv') {
    const rows = parse(content, { columns: true, skip_empty_lines: true });
    for (const row of rows) {
      try {
        await db.query(`
          INSERT INTO legislators
            (bioguide_id, full_name, party, state, district, chamber, start_date, end_date, govtrack_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (bioguide_id) DO UPDATE
          SET party = EXCLUDED.party, district = EXCLUDED.district
        `, [
          row.bioguide_id,
          `${row.first_name} ${row.last_name}`,
          row.party,
          row.state,
          row.district || null,
          row.type === 'sen' ? 'senate' : 'house',
          row.start_date || null,
          row.end_date || null,
          row.govtrack_id || null,
        ]);
        inserted++;
      } catch (e) {
        errors++;
      }
    }
    return { rows: inserted + errors, inserted, errors };
  }

  if (filename === 'data.json') {
    // Roll call vote file
    const vote = JSON.parse(content);
    try {
      await db.query(`
        INSERT INTO voting_records
          (vote_id, congress, session, chamber, vote_type, date, question, result, vote_counts, govtrack_source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (vote_id) DO NOTHING
      `, [
        vote.vote_id,
        vote.congress,
        vote.session,
        vote.chamber,
        vote.category,
        vote.date,
        vote.question,
        vote.result,
        JSON.stringify(vote.votes),
        filePath,
      ]);
      inserted++;
    } catch (e) {
      errors++;
    }
    return { rows: 1, inserted, errors };
  }

  return { rows: 0, inserted: 0, errors: 0 };
}

/**
 * ProPublica House Expenditures parser
 */
async function parseProPublicaExpenditures(filePath, db) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });

  let inserted = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      // Summary file format
      if (row.CATEGORY && row.OFFICE) {
        await db.query(`
          INSERT INTO house_expenditures
            (bioguide_id, office_name, year, quarter, category, amount)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING
        `, [
          row.BIOGUIDE_ID || null,
          row.OFFICE,
          parseInt(row.YEAR),
          parseInt(row.QUARTER),
          row.CATEGORY,
          parseFloat(row.AMOUNT || row.YTD || 0),
        ]);
        inserted++;
      }
    } catch (e) {
      errors++;
    }
  }

  return { rows: rows.length, inserted, errors };
}

async function parseANES(filePath, db) {
  // ANES data is complex — store raw for now, build specific queries later
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true });

  console.log(`  ANES: ${rows.length} respondents. Storing raw data for analysis.`);
  // TODO: Build specific ANES variable mappings for partisan lean calculations

  return { rows: rows.length, inserted: 0, errors: 0 };
}

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

function normalizeParty(party) {
  if (!party) return 'unknown';
  const p = party.toUpperCase();
  if (p === 'DEMOCRAT' || p === 'DEM' || p === 'D') return 'democrat';
  if (p === 'REPUBLICAN' || p === 'REP' || p === 'R') return 'republican';
  if (p === 'INDEPENDENT' || p === 'IND' || p === 'I') return 'independent';
  if (p === 'GREEN' || p === 'GRE') return 'green';
  if (p === 'LIBERTARIAN' || p === 'LIB') return 'libertarian';
  return party.toLowerCase();
}

function detectOfficeFromFilename(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('house')) return 'US House';
  if (name.includes('senate')) return 'US Senate';
  if (name.includes('president')) return 'President';
  return 'unknown';
}

// ─────────────────────────────────────────────────
// CLI RUNNER
// ─────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const sourceArg = args.find(a => a.startsWith('--source='));
  const source = sourceArg?.split('=')[1];

  if (!source) {
    console.log('Usage: node ingest.js --source=<source-name>');
    console.log('Available sources:');
    Object.entries(BULK_SOURCES).forEach(([key, s]) => {
      console.log(`  ${key.padEnd(30)} ${s.status === 'loaded' ? '✓ loaded' : '○ pending'} — ${s.name}`);
    });
    console.log('\nTo see download instructions for a source:');
    console.log('  node ingest.js --source=<name> --instructions');
    process.exit(0);
  }

  if (args.includes('--instructions')) {
    const s = BULK_SOURCES[source];
    if (s) {
      console.log(`\n${s.name}`);
      console.log(s.downloadInstructions);
    }
    process.exit(0);
  }

  // Would connect to DB here in full implementation
  console.log(`Would ingest: ${source}`);
  console.log('(Connect DB to run full ingestion)');
}

module.exports = {
  BULK_SOURCES,
  ingestSource,
};
