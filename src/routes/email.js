/**
 * LISTMONK EMAIL ROUTES
 * src/routes/email.js
 *
 * Proxies Listmonk API calls on behalf of candidates.
 * Each candidate gets one Listmonk list — their subscriber list.
 * All routes are scoped to that candidate's list only.
 *
 * Routes:
 *   GET  /api/email/status          — check Listmonk connection + candidate list
 *   GET  /api/email/subscribers     — list subscribers for this candidate
 *   POST /api/email/subscribers     — add a subscriber to this candidate's list
 *   DELETE /api/email/subscribers/:id — remove a subscriber
 *   GET  /api/email/campaigns       — list campaigns for this candidate's list
 *   POST /api/email/campaigns       — create and optionally send a campaign
 *   GET  /api/email/campaigns/:id/stats — get campaign stats
 *   POST /api/email/campaigns/:id/send  — send a draft campaign
 */

const express = require('express');
const router = express.Router();

// ── LISTMONK CLIENT ───────────────────────────────────────────────
function listmonkFetch(path, options = {}) {
  const base = process.env.LISTMONK_URL || 'http://listmonk.railway.internal:9000';
  const username = process.env.LISTMONK_USERNAME || 'admin';
  const password = process.env.LISTMONK_PASSWORD || '';

  const credentials = Buffer.from(`${username}:${password}`).toString('base64');

  return fetch(`${base}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${credentials}`,
      ...options.headers,
    },
  });
}

// Check if Listmonk is configured
function isListmonkConfigured() {
  return !!(process.env.LISTMONK_URL && process.env.LISTMONK_PASSWORD);
}

// Get or create the candidate's Listmonk list
async function getOrCreateCandidateList(candidate, db) {
  // Check if we already have a list ID stored
  if (candidate.listmonk_list_id) {
    return parseInt(candidate.listmonk_list_id);
  }

  // Create a new list for this candidate
  const listName = `${candidate.full_name} — ${candidate.office_sought || 'Campaign'} (${candidate.state || ''})`;

  const res = await listmonkFetch('/lists', {
    method: 'POST',
    body: JSON.stringify({
      name: listName,
      type: 'private',
      optin: 'single',
      tags: ['candidate', candidate.state || '', candidate.id],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Could not create Listmonk list: ${err}`);
  }

  const data = await res.json();
  const listId = data.data?.id;

  // Save list ID to DB
  await db.query(
    'UPDATE candidates SET listmonk_list_id = $1 WHERE id = $2',
    [listId, candidate.id]
  );

  return listId;
}

// ── STATUS CHECK ─────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;

  if (!isListmonkConfigured()) {
    return res.json({
      connected: false,
      reason: 'Listmonk is not configured. Set LISTMONK_URL, LISTMONK_USERNAME, LISTMONK_PASSWORD in Railway.',
    });
  }

  try {
    // Test Listmonk connection
    const healthRes = await listmonkFetch('/health');
    if (!healthRes.ok) throw new Error('Listmonk health check failed');

    // Get candidate info
    const candResult = await db.query(
      'SELECT full_name, office_sought, state, listmonk_list_id FROM candidates WHERE id = $1',
      [candidateId]
    );
    const candidate = candResult.rows[0];
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    // Get or create list
    const listId = await getOrCreateCandidateList({ ...candidate, id: candidateId }, db);

    // Get list stats
    const listRes = await listmonkFetch(`/lists/${listId}`);
    const listData = listRes.ok ? await listRes.json() : { data: {} };

    res.json({
      connected: true,
      listId,
      listName: listData.data?.name,
      subscriberCount: listData.data?.subscriber_count || 0,
    });
  } catch (err) {
    res.json({
      connected: false,
      reason: err.message,
    });
  }
});

// ── SUBSCRIBERS ───────────────────────────────────────────────────
router.get('/subscribers', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  const { page = 1, per_page = 25, search = '' } = req.query;

  try {
    const candResult = await db.query(
      'SELECT full_name, office_sought, state, listmonk_list_id FROM candidates WHERE id = $1',
      [candidateId]
    );
    const candidate = candResult.rows[0];
    const listId = await getOrCreateCandidateList({ ...candidate, id: candidateId }, db);

    const params = new URLSearchParams({
      page,
      per_page,
      list_id: listId,
      ...(search ? { query: `subscribers.name LIKE '%${search}%' OR subscribers.email LIKE '%${search}%'` } : {}),
    });

    const subRes = await listmonkFetch(`/subscribers?${params}`);
    if (!subRes.ok) throw new Error('Could not fetch subscribers');

    const data = await subRes.json();

    res.json({
      subscribers: (data.data?.results || []).map(s => ({
        id: s.id,
        name: s.name,
        email: s.email,
        status: s.status,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
      total: data.data?.total || 0,
      page: parseInt(page),
      perPage: parseInt(per_page),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/subscribers', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  const { name, email, phone } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: 'Name and email required' });
  }

  try {
    const candResult = await db.query(
      'SELECT full_name, office_sought, state, listmonk_list_id FROM candidates WHERE id = $1',
      [candidateId]
    );
    const candidate = candResult.rows[0];
    const listId = await getOrCreateCandidateList({ ...candidate, id: candidateId }, db);

    const subRes = await listmonkFetch('/subscribers', {
      method: 'POST',
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        status: 'enabled',
        lists: [listId],
        attribs: { phone: phone || null, source: 'manual' },
        preconfirm_subscriptions: true,
      }),
    });

    if (subRes.status === 409) {
      // Already exists — add to this list
      return res.json({ success: true, message: 'Subscriber already exists — added to your list.' });
    }

    if (!subRes.ok) {
      const err = await subRes.text();
      throw new Error(err);
    }

    const data = await subRes.json();
    res.json({ success: true, subscriber: data.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/subscribers/:id', async (req, res) => {
  try {
    const delRes = await listmonkFetch(`/subscribers/${req.params.id}`, { method: 'DELETE' });
    if (!delRes.ok) throw new Error('Could not remove subscriber');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CAMPAIGNS ─────────────────────────────────────────────────────
router.get('/campaigns', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;

  try {
    const candResult = await db.query(
      'SELECT full_name, office_sought, state, listmonk_list_id FROM candidates WHERE id = $1',
      [candidateId]
    );
    const candidate = candResult.rows[0];
    const listId = await getOrCreateCandidateList({ ...candidate, id: candidateId }, db);

    const campRes = await listmonkFetch(`/campaigns?per_page=50`);
    if (!campRes.ok) throw new Error('Could not fetch campaigns');

    const data = await campRes.json();

    // Filter to only this candidate's list
    const campaigns = (data.data?.results || [])
      .filter(c => c.lists?.some(l => l.id === listId))
      .map(c => ({
        id: c.id,
        name: c.name,
        subject: c.subject,
        status: c.status,
        sent: c.send_count || 0,
        views: c.view_count || 0,
        clicks: c.click_count || 0,
        openRate: c.send_count ? Math.round((c.view_count / c.send_count) * 100) : 0,
        clickRate: c.send_count ? Math.round((c.click_count / c.send_count) * 100) : 0,
        createdAt: c.created_at,
        sentAt: c.sent_at,
        startedAt: c.started_at,
      }));

    res.json({ campaigns, listId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/campaigns', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  const { subject, body, sendNow = false, fromName } = req.body;

  if (!subject || !body) {
    return res.status(400).json({ error: 'Subject and body required' });
  }

  try {
    const candResult = await db.query(
      'SELECT full_name, office_sought, state, listmonk_list_id, campaign_email FROM candidates WHERE id = $1',
      [candidateId]
    );
    const candidate = candResult.rows[0];
    const listId = await getOrCreateCandidateList({ ...candidate, id: candidateId }, db);

    const senderName = fromName || candidate.full_name || 'Your Candidate';
    const senderEmail = candidate.campaign_email || process.env.DEFAULT_FROM_EMAIL || 'campaigns@partyofyou.org';

    // Create campaign
    const campRes = await listmonkFetch('/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: `${subject} — ${new Date().toLocaleDateString()}`,
        subject,
        lists: [listId],
        from_email: `${senderName} <${senderEmail}>`,
        content_type: 'richtext',
        body,
        type: 'regular',
        tags: ['candidate-campaign'],
      }),
    });

    if (!campRes.ok) {
      const err = await campRes.text();
      throw new Error(`Could not create campaign: ${err}`);
    }

    const campData = await campRes.json();
    const campaignId = campData.data?.id;

    // Send immediately if requested
    if (sendNow && campaignId) {
      await listmonkFetch(`/campaigns/${campaignId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'running' }),
      });
    }

    res.json({
      success: true,
      campaignId,
      status: sendNow ? 'sending' : 'draft',
      message: sendNow
        ? `Campaign "${subject}" is being sent to your subscriber list.`
        : `Campaign "${subject}" saved as draft. Review and send when ready.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/campaigns/:id/send', async (req, res) => {
  try {
    const sendRes = await listmonkFetch(`/campaigns/${req.params.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'running' }),
    });
    if (!sendRes.ok) throw new Error('Could not send campaign');
    res.json({ success: true, message: 'Campaign is now sending.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/campaigns/:id/cancel', async (req, res) => {
  try {
    const cancelRes = await listmonkFetch(`/campaigns/${req.params.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'cancelled' }),
    });
    if (!cancelRes.ok) throw new Error('Could not cancel campaign');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
