/**
 * WEBSITE BUILDER API ROUTES
 * src/routes/site.js
 *
 * All routes require candidate auth (requireCandidate middleware applied in server.js)
 *
 * GET    /api/site/settings       — get site settings + pages
 * PATCH  /api/site/settings       — update site settings
 * GET    /api/site/issues         — get candidate issues
 * PUT    /api/site/issues         — replace all issues
 * POST   /api/site/publish        — mark site as published
 */

const express = require('express');
const router = express.Router();

// ── GET /api/site/settings ──────────────────────────────────────
router.get('/settings', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // Get or create site settings row
    let result = await db.query(
      'SELECT * FROM candidate_sites WHERE candidate_id = $1',
      [candidateId]
    );

    if (!result.rows.length) {
      // Auto-create default site settings
      result = await db.query(`
        INSERT INTO candidate_sites (candidate_id, template, nav_style)
        VALUES ($1, 'hometown', 'top')
        RETURNING *
      `, [candidateId]);
    }

    const site = result.rows[0];

    // Get pages
    const pagesResult = await db.query(
      'SELECT * FROM site_pages WHERE candidate_id = $1 ORDER BY sort_order',
      [candidateId]
    );

    res.json({
      ...site,
      pages: pagesResult.rows,
    });
  } catch (err) {
    console.error('[Site] settings error:', err.message);
    res.status(500).json({ error: 'Could not load site settings' });
  }
});

// ── PATCH /api/site/settings ────────────────────────────────────
router.patch('/settings', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  const {
    template, accent_color, font_heading, font_body, nav_style,
    site_title, site_tagline,
    social_twitter, social_facebook, social_instagram, social_youtube,
    donate_stripe_url, donate_paypal_url, donate_venmo,
    donate_cash_address, donate_fec_notice,
    stripe_auto_log, paypal_auto_log,
  } = req.body;

  try {
    await db.query(`
      INSERT INTO candidate_sites (candidate_id, template, accent_color, font_heading, font_body,
        nav_style, site_title, site_tagline, social_twitter, social_facebook, social_instagram,
        social_youtube, donate_stripe_url, donate_paypal_url, donate_venmo, donate_cash_address,
        donate_fec_notice, stripe_auto_log, paypal_auto_log, last_saved_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW())
      ON CONFLICT (candidate_id) DO UPDATE SET
        template = COALESCE($2, candidate_sites.template),
        accent_color = COALESCE($3, candidate_sites.accent_color),
        font_heading = COALESCE($4, candidate_sites.font_heading),
        font_body = COALESCE($5, candidate_sites.font_body),
        nav_style = COALESCE($6, candidate_sites.nav_style),
        site_title = COALESCE($7, candidate_sites.site_title),
        site_tagline = COALESCE($8, candidate_sites.site_tagline),
        social_twitter = COALESCE($9, candidate_sites.social_twitter),
        social_facebook = COALESCE($10, candidate_sites.social_facebook),
        social_instagram = COALESCE($11, candidate_sites.social_instagram),
        social_youtube = COALESCE($12, candidate_sites.social_youtube),
        donate_stripe_url = COALESCE($13, candidate_sites.donate_stripe_url),
        donate_paypal_url = COALESCE($14, candidate_sites.donate_paypal_url),
        donate_venmo = COALESCE($15, candidate_sites.donate_venmo),
        donate_cash_address = COALESCE($16, candidate_sites.donate_cash_address),
        donate_fec_notice = COALESCE($17, candidate_sites.donate_fec_notice),
        stripe_auto_log = COALESCE($18, candidate_sites.stripe_auto_log),
        paypal_auto_log = COALESCE($19, candidate_sites.paypal_auto_log),
        last_saved_at = NOW(),
        updated_at = NOW()
    `, [
      candidateId, template || null, accent_color || null,
      font_heading || null, font_body || null, nav_style || null,
      site_title || null, site_tagline || null,
      social_twitter || null, social_facebook || null,
      social_instagram || null, social_youtube || null,
      donate_stripe_url || null, donate_paypal_url || null,
      donate_venmo || null, donate_cash_address || null,
      donate_fec_notice || null,
      stripe_auto_log ?? null, paypal_auto_log ?? null,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error('[Site] settings update error:', err.message);
    res.status(500).json({ error: 'Could not save settings' });
  }
});

// ── GET /api/site/issues ────────────────────────────────────────
router.get('/issues', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await db.query(
      'SELECT * FROM candidate_issues WHERE candidate_id = $1 ORDER BY sort_order, created_at',
      [candidateId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Site] issues error:', err.message);
    res.status(500).json({ error: 'Could not load issues' });
  }
});

// ── PUT /api/site/issues ────────────────────────────────────────
// Replaces all issues for this candidate (full replace on save)
router.put('/issues', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  const issues = req.body;
  if (!Array.isArray(issues)) return res.status(400).json({ error: 'Body must be an array of issues' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM candidate_issues WHERE candidate_id = $1', [candidateId]);

    for (let i = 0; i < issues.length; i++) {
      const { title, icon, summary, body, bullet_points, source, pledge_id } = issues[i];
      await client.query(`
        INSERT INTO candidate_issues
          (candidate_id, title, icon, summary, body, bullet_points, source, pledge_id, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        candidateId,
        title || 'Untitled Issue',
        icon || '📋',
        summary || null,
        body || null,
        JSON.stringify(bullet_points || []),
        source || 'custom',
        pledge_id || null,
        i,
      ]);
    }

    await client.query('COMMIT');
    res.json({ success: true, count: issues.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Site] issues save error:', err.message);
    res.status(500).json({ error: 'Could not save issues' });
  } finally {
    client.release();
  }
});

// ── POST /api/site/publish ──────────────────────────────────────
router.post('/publish', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    await db.query(`
      UPDATE candidate_sites
      SET is_published = TRUE, published_at = NOW(), updated_at = NOW()
      WHERE candidate_id = $1
    `, [candidateId]);

    // Also mark on candidates table
    await db.query(
      'UPDATE candidates SET site_published = TRUE WHERE id = $1',
      [candidateId]
    );

    res.json({ success: true, published_at: new Date().toISOString() });
  } catch (err) {
    console.error('[Site] publish error:', err.message);
    res.status(500).json({ error: 'Could not publish site' });
  }
});

// ── GET /api/site/pages ─────────────────────────────────────────
router.get('/pages', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const pages = await db.query(
      'SELECT * FROM site_pages WHERE candidate_id = $1 ORDER BY sort_order',
      [candidateId]
    );
    res.json(pages.rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not load pages' });
  }
});

// ── PUT /api/site/pages ─────────────────────────────────────────
router.put('/pages', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  const pages = req.body;
  if (!Array.isArray(pages)) return res.status(400).json({ error: 'Body must be an array' });

  // Get site ID
  let siteResult;
  try {
    siteResult = await db.query(
      'SELECT id FROM candidate_sites WHERE candidate_id = $1',
      [candidateId]
    );
    if (!siteResult.rows.length) return res.status(404).json({ error: 'Site not found. Save design settings first.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not find site' });
  }

  const siteId = siteResult.rows[0].id;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < pages.length; i++) {
      const { slug, title, page_type, nav_label, is_enabled } = pages[i];
      await client.query(`
        INSERT INTO site_pages (candidate_id, site_id, slug, title, page_type, nav_label, is_enabled, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (candidate_id, slug) DO UPDATE SET
          title = EXCLUDED.title,
          is_enabled = EXCLUDED.is_enabled,
          sort_order = EXCLUDED.sort_order,
          updated_at = NOW()
      `, [candidateId, siteId, slug, title, page_type, nav_label || title, is_enabled ?? true, i]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Site] pages save error:', err.message);
    res.status(500).json({ error: 'Could not save pages' });
  } finally {
    client.release();
  }
});

module.exports = router;
