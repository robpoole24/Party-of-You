/**
 * RACES ROUTER — /api/races
 * Module 2: Open Seat Tracker
 *
 * GET /api/races?address=123+Main+St+Milwaukee+WI
 *   → Resolves address to districts, returns all races the person could run in
 *
 * GET /api/races?state=WI&level=state
 *   → All state-level races in Wisconsin
 *
 * GET /api/races/:id
 *   → Single race detail
 */

const express = require('express');
const router = express.Router();
const { resolveAddress } = require('../data-layer/geographic');
const { getRacesForCandidate } = require('../data-layer/open-seats');

// GET /api/races?address=...
router.get('/', async (req, res) => {
  const { address, state, level } = req.query;

  if (!address && !state) {
    return res.status(400).json({
      error: 'Provide either ?address= or ?state= to find races',
      example: '/api/races?address=123+Main+St+Milwaukee+WI+53221',
    });
  }

  try {
    let geography = null;

    if (address) {
      // Resolve address to geography first
      geography = await resolveAddress(address);
    } else {
      // State-only query — build minimal geography object
      geography = {
        state,
        districts: {},
        normalizedAddress: null,
      };
    }

    const raceBundle = await getRacesForCandidate(geography, { level });

    res.json({
      success: true,
      geography: {
        state: geography.state,
        districts: geography.districts,
        normalizedAddress: geography.normalizedAddress,
      },
      summary: {
        totalRaces: raceBundle.totalRaces,
        openSeats: raceBundle.openSeats,
        filingOpen: raceBundle.filingOpen,
      },
      races: raceBundle.races,
      dataSources: raceBundle.dataSources,
      lastUpdated: raceBundle.lastUpdated,
    });
  } catch (err) {
    console.error('Race lookup error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve races', detail: err.message });
  }
});

// GET /api/races/:id
router.get('/:id', async (req, res) => {
  res.json({
    message: 'Individual race detail endpoint — coming soon',
    raceId: req.params.id,
  });
});

module.exports = router;
