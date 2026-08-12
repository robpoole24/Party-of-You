/**
 * INTELLIGENCE ROUTER — /api/intelligence
 * Module 5: District Intelligence (Polling + Demographics)
 *
 * GET /api/intelligence?address=...
 *   → Full intelligence bundle: polling + demographics for that address's districts
 *
 * GET /api/intelligence/polling?state=WI
 *   → Polling data for a state
 *
 * GET /api/intelligence/demographics?address=...
 *   → Demographic profile for a district
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

    const [polling, demographics] = await Promise.allSettled([
      getPollingBundleForDistrict(geography),
      getDemographicsForDistrict(geography),
    ]);

    res.json({
      success: true,
      geography: {
        state: geography.state,
        districts: geography.districts,
        normalizedAddress: geography.normalizedAddress,
      },
      polling: polling.status === 'fulfilled' ? polling.value : { error: 'Polling data unavailable' },
      demographics: demographics.status === 'fulfilled' ? demographics.value : { error: 'Demographics unavailable' },
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
