/**
 * INTELLIGENCE ROUTER — /api/intelligence
 */

const express = require('express');
const router = express.Router();
const { resolveAddress } = require('../data-layer/geographic');
const { getPollingBundleForDistrict } = require('../data-layer/polling');
const { getDemographicsForDistrict } = require('../data-layer/demographics');

// GET /api/intelligence?address=...
router.get('/', async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({
      error: 'Provide ?address= to get district intelligence',
      example: '/api/intelligence?address=123+Main+St+Milwaukee+WI+53221',
    });
  }

  try {
    const geography = await resolveAddress(address);
    const db = req.db;

    const [polling, demographics] = await Promise.allSettled([
      getPollingBundleForDistrict(geography),
      getDemographicsForDistrict(geography),
    ]);

    // Look up partisan lean from our DB
    let districtLean = null;
    if (db && geography.state) {
      try {
        const district = geography.districts?.congressional ||
                         geography.districts?.stateLeg?.stateHouse ||
                         '00';

        const leanResult = await db.query(`
          SELECT * FROM district_partisan_lean
          WHERE state = $1
          ORDER BY
            CASE WHEN district = $2 THEN 0
                 WHEN office = 'US House' THEN 1
                 WHEN office = 'President' THEN 2
                 ELSE 3
            END
          LIMIT 1
        `, [geography.state, String(district)]);

        if (leanResult.rows.length) {
          districtLean = leanResult.rows[0];
        }
      } catch (e) {
        console.warn('District lean lookup failed:', e.message);
      }
    }

    // Look up incumbent from races table
    let incumbent = null;
    if (db && geography.state) {
      try {
        const district = geography.districts?.congressional || '00';
        const incResult = await db.query(`
          SELECT office, incumbent_name, incumbent_party, is_open_seat,
                 incumbent_retiring, election_date, filing_deadline
          FROM races
          WHERE state = $1
            AND (district = $2 OR district IS NULL)
            AND level = 'federal'
          ORDER BY
            CASE WHEN district = $2 THEN 0 ELSE 1 END
          LIMIT 3
        `, [geography.state, String(district)]);
        incumbent = incResult.rows;
      } catch (e) {
        console.warn('Incumbent lookup failed:', e.message);
      }
    }

    res.json({
      success: true,
      geography: {
        state: geography.state,
        districts: geography.districts,
        normalizedAddress: geography.normalizedAddress,
      },
      polling: polling.status === 'fulfilled' ? polling.value : { error: 'Polling data unavailable' },
      demographics: demographics.status === 'fulfilled' ? demographics.value : { error: 'Demographics unavailable' },
      districtLean,
      incumbent,
    });
  } catch (err) {
    console.error('Intelligence error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve intelligence data', detail: err.message });
  }
});

// GET /api/intelligence/polling?state=WI
router.get('/polling', async (req, res) => {
  const { state } = req.query;
  if (!state) return res.status(400).json({ error: 'Provide ?state= (two-letter code)' });

  try {
    const { fetchVoteHubPolls } = require('../data-layer/polling');
    const polls = await fetchVoteHubPolls({ subject: state });
    res.json({ success: true, state, polls });
  } catch (err) {
    res.status(500).json({ error: 'Polling fetch failed', detail: err.message });
  }
});

module.exports = router;
