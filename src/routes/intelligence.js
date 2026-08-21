/**
 * INTELLIGENCE ROUTER — /api/intelligence
 */

const express = require('express');
const router = express.Router();

// GET /api/intelligence?address=...
router.get('/', async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({
      error: 'Provide ?address= to get district intelligence',
      example: '/api/intelligence?address=123+Main+St+Milwaukee+WI+53221',
    });
  }

  const db = req.db;
  let geography = null;

  // Step 1: Resolve address — fail gracefully
  try {
    const { resolveAddress } = require('../data-layer/geographic');
    geography = await resolveAddress(address);
  } catch (err) {
    console.warn('[Intelligence] Address resolution failed:', err.message);
    // Try to extract state from address string as fallback
    const stateMatch = address.match(/\b([A-Z]{2})\b/);
    if (stateMatch) {
      geography = { state: stateMatch[1], districts: {}, normalizedAddress: address };
    } else {
      return res.status(400).json({
        error: 'Could not resolve address to a district',
        detail: err.message,
        address,
      });
    }
  }

  if (!geography?.state) {
    return res.status(400).json({ error: 'Could not determine state from address', address });
  }

  // Step 2: Get polling and demographics — both optional
  const [polling, demographics] = await Promise.allSettled([
    (async () => {
      try {
        const { getPollingBundleForDistrict } = require('../data-layer/polling');
        return await getPollingBundleForDistrict(geography);
      } catch (e) {
        console.warn('[Intelligence] Polling failed:', e.message);
        return { error: 'Polling data unavailable', detail: e.message };
      }
    })(),
    (async () => {
      try {
        const { getDemographicsForDistrict } = require('../data-layer/demographics');
        return await getDemographicsForDistrict(geography);
      } catch (e) {
        console.warn('[Intelligence] Demographics failed:', e.message);
        return { error: 'Demographics unavailable', detail: e.message };
      }
    })(),
  ]);

  // Step 3: District lean from DB — optional
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
      console.warn('[Intelligence] Lean lookup failed:', e.message);
    }
  }

  // Step 4: Incumbent from races table — optional
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
      console.warn('[Intelligence] Incumbent lookup failed:', e.message);
    }
  }

  // Always return 200 with whatever data we have
  res.json({
    success: true,
    geography: {
      state: geography.state,
      districts: geography.districts || {},
      normalizedAddress: geography.normalizedAddress || address,
    },
    polling: polling.status === 'fulfilled' ? polling.value : { error: 'Polling data unavailable' },
    demographics: demographics.status === 'fulfilled' ? demographics.value : { error: 'Demographics unavailable' },
    districtLean,
    incumbent,
  });
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
