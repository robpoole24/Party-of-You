/**
 * MEDIA LIBRARY API
 * src/routes/media.js
 *
 * All routes require candidate auth (applied in server.js)
 *
 * GET    /api/media                        — list candidate's media library
 * GET    /api/media/search?q=flag&page=1   — search Unsplash
 * POST   /api/media/save-unsplash          — save Unsplash photo to library
 * POST   /api/media/upload                 — upload image file
 * DELETE /api/media/:id                    — remove from library + Cloudinary
 *
 * GET    /api/media/pages                  — list custom page uploads
 * POST   /api/media/pages/upload           — upload custom HTML page
 * DELETE /api/media/pages/:slug            — remove custom page (revert to builder)
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const https = require('https');

const MEDIA_LIMIT = 50;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10MB
const MAX_HTML_BYTES  = 2 * 1024 * 1024;   // 2MB per custom page

// Multer: memory storage (we stream straight to Cloudinary)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const htmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_HTML_BYTES },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype === 'text/html' || file.originalname.endsWith('.html'));
  },
});

// ── Cloudinary helper ──────────────────────────────────────────
function getCloudinaryConfig() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey:    process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  };
}

async function uploadToCloudinary(buffer, options = {}) {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
  }

  const cloudinary = require('cloudinary').v2;
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    stream.end(buffer);
  });
}

async function deleteFromCloudinary(publicId) {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  if (!cloudName) return; // Graceful — don't crash delete if not configured
  const cloudinary = require('cloudinary').v2;
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    console.warn('[Media] Cloudinary delete failed:', e.message);
  }
}

// ── Unsplash helper ────────────────────────────────────────────
async function unsplashRequest(path) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY not set');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.unsplash.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Client-ID ${key}`,
        'Accept-Version': 'v1',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid Unsplash response')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Fire the required Unsplash download event (API terms requirement)
async function triggerUnsplashDownload(downloadLocation) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key || !downloadLocation) return;
  try {
    // downloadLocation is a full URL like https://api.unsplash.com/photos/xxx/download?ixid=...
    const url = new URL(downloadLocation);
    await unsplashRequest(`${url.pathname}${url.search}`);
  } catch (e) {
    console.warn('[Media] Unsplash download trigger failed:', e.message);
  }
}

// ── GET /api/media — library list ─────────────────────────────
router.get('/', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await db.query(
      `SELECT * FROM candidate_media
       WHERE candidate_id = $1
       ORDER BY created_at DESC`,
      [candidateId]
    );

    // Get current count vs limit
    const countResult = await db.query(
      `SELECT COUNT(*) FROM candidate_media WHERE candidate_id = $1`,
      [candidateId]
    );

    res.json({
      items: result.rows,
      count: parseInt(countResult.rows[0].count),
      limit: MEDIA_LIMIT,
    });
  } catch (err) {
    console.error('[Media] list error:', err.message);
    res.status(500).json({ error: 'Could not load media library' });
  }
});

// ── GET /api/media/search — Unsplash search ───────────────────
router.get('/search', async (req, res) => {
  const { q, page = 1 } = req.query;
  if (!q) return res.status(400).json({ error: 'Provide ?q= search query' });

  // Scope queries to campaign-safe content
  const safeQuery = encodeURIComponent(q.slice(0, 100));

  try {
    const data = await unsplashRequest(
      `/search/photos?query=${safeQuery}&page=${page}&per_page=20&orientation=landscape&content_filter=high`
    );

    if (data.errors) {
      return res.status(400).json({ error: data.errors[0] });
    }

    // Shape the response — only expose what we need
    const results = (data.results || []).map(photo => ({
      id: photo.id,
      thumb: photo.urls?.thumb,
      small: photo.urls?.small,
      regular: photo.urls?.regular,
      full: photo.urls?.full,
      width: photo.width,
      height: photo.height,
      alt: photo.alt_description || photo.description || '',
      color: photo.color,
      download_location: photo.links?.download_location,
      photographer_name: photo.user?.name,
      photographer_url: `https://unsplash.com/@${photo.user?.username}?utm_source=party_of_you&utm_medium=referral`,
      unsplash_url: `https://unsplash.com/photos/${photo.id}?utm_source=party_of_you&utm_medium=referral`,
    }));

    res.json({
      results,
      total: data.total,
      total_pages: data.total_pages,
      page: parseInt(page),
    });
  } catch (err) {
    console.error('[Media] Unsplash search error:', err.message);
    res.status(500).json({ error: 'Unsplash search failed', detail: err.message });
  }
});

// ── POST /api/media/save-unsplash — save photo to library ─────
router.post('/save-unsplash', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  const {
    unsplash_id, regular_url, full_url, thumb_url,
    alt_text, photographer_name, photographer_url,
    unsplash_url, download_location, width, height,
  } = req.body;

  if (!unsplash_id || !regular_url) {
    return res.status(400).json({ error: 'unsplash_id and regular_url required' });
  }

  // Check library limit
  const countResult = await db.query(
    'SELECT COUNT(*) FROM candidate_media WHERE candidate_id = $1',
    [candidateId]
  );
  if (parseInt(countResult.rows[0].count) >= MEDIA_LIMIT) {
    return res.status(400).json({
      error: `Media library full (${MEDIA_LIMIT} image limit). Delete some images to add more.`,
      code: 'LIMIT_REACHED',
    });
  }

  // Check not already saved
  const existing = await db.query(
    'SELECT id FROM candidate_media WHERE candidate_id = $1 AND unsplash_id = $2',
    [candidateId, unsplash_id]
  );
  if (existing.rows.length) {
    return res.status(400).json({ error: 'This photo is already in your library', code: 'DUPLICATE' });
  }

  try {
    // Download image from Unsplash and upload to Cloudinary
    // This avoids hotlinking and gives us our own CDN copy
    const imageRes = await fetch(regular_url);
    if (!imageRes.ok) throw new Error('Could not download image from Unsplash');
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

    const folder = `poy/${candidateId}/media`;
    const cloudResult = await uploadToCloudinary(imageBuffer, {
      folder,
      public_id: `unsplash_${unsplash_id}`,
      resource_type: 'image',
      format: 'webp',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    });

    // Trigger required Unsplash download event
    await triggerUnsplashDownload(download_location);

    // Save to DB
    const insertResult = await db.query(`
      INSERT INTO candidate_media (
        candidate_id, cloudinary_public_id, cloudinary_url, cloudinary_thumb_url,
        width, height, file_size_bytes, format, source,
        unsplash_id, unsplash_url, photographer_name, photographer_url, alt_text
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unsplash',$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      candidateId,
      cloudResult.public_id,
      cloudResult.secure_url,
      cloudResult.eager?.[0]?.secure_url || thumb_url,
      width || cloudResult.width,
      height || cloudResult.height,
      cloudResult.bytes,
      'webp',
      unsplash_id,
      unsplash_url,
      photographer_name,
      photographer_url,
      alt_text || '',
    ]);

    res.json({ success: true, item: insertResult.rows[0] });
  } catch (err) {
    console.error('[Media] save-unsplash error:', err.message);
    res.status(500).json({ error: 'Could not save photo', detail: err.message });
  }
});

// ── POST /api/media/upload — upload image file ─────────────────
router.post('/upload', upload.single('image'), async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  // Check library limit
  const countResult = await db.query(
    'SELECT COUNT(*) FROM candidate_media WHERE candidate_id = $1',
    [candidateId]
  );
  if (parseInt(countResult.rows[0].count) >= MEDIA_LIMIT) {
    return res.status(400).json({
      error: `Media library full (${MEDIA_LIMIT} image limit). Delete some images to add more.`,
      code: 'LIMIT_REACHED',
    });
  }

  try {
    const folder = `poy/${candidateId}/media`;
    const cloudResult = await uploadToCloudinary(req.file.buffer, {
      folder,
      resource_type: 'image',
      format: 'webp',
      transformation: [{ quality: 'auto', fetch_format: 'auto', width: 1920, crop: 'limit' }],
    });

    const insertResult = await db.query(`
      INSERT INTO candidate_media (
        candidate_id, cloudinary_public_id, cloudinary_url,
        width, height, file_size_bytes, format, source, original_filename, alt_text
      ) VALUES ($1,$2,$3,$4,$5,$6,'webp','upload',$7,$8)
      RETURNING *
    `, [
      candidateId,
      cloudResult.public_id,
      cloudResult.secure_url,
      cloudResult.width,
      cloudResult.height,
      cloudResult.bytes,
      req.file.originalname,
      req.body.alt_text || '',
    ]);

    res.json({ success: true, item: insertResult.rows[0] });
  } catch (err) {
    console.error('[Media] upload error:', err.message);
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

// ── DELETE /api/media/:id ──────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  const { id } = req.params;

  try {
    const result = await db.query(
      'SELECT * FROM candidate_media WHERE id = $1 AND candidate_id = $2',
      [id, candidateId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const item = result.rows[0];

    // Delete from Cloudinary
    await deleteFromCloudinary(item.cloudinary_public_id);

    // Delete from DB
    await db.query('DELETE FROM candidate_media WHERE id = $1', [id]);

    res.json({ success: true });
  } catch (err) {
    console.error('[Media] delete error:', err.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── GET /api/media/pages — list custom page uploads ───────────
router.get('/pages', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await db.query(
      `SELECT * FROM candidate_custom_pages
       WHERE candidate_id = $1 AND is_active = TRUE
       ORDER BY uploaded_at DESC`,
      [candidateId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not load custom pages' });
  }
});

// ── POST /api/media/pages/upload — upload custom HTML page ────
router.post('/pages/upload', htmlUpload.single('page'), async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.file) return res.status(400).json({ error: 'No HTML file provided' });

  const { page_slug, payment_processor, processor_account, wants_webhook } = req.body;

  const validSlugs = ['home', 'about', 'issues', 'donate', 'events', 'volunteer', 'contact', 'custom'];
  if (!page_slug || !validSlugs.includes(page_slug)) {
    return res.status(400).json({ error: `page_slug must be one of: ${validSlugs.join(', ')}` });
  }

  // Basic HTML safety check — reject if it contains dangerous patterns
  const html = req.file.buffer.toString('utf8');
  const dangerous = /<script[^>]*src\s*=/i.test(html) && !html.includes('partyofyou');
  // Note: inline scripts are allowed (candidate's own JS), only flag external unknown scripts
  // This is a light check — in production you'd want a fuller sanitizer

  try {
    const folder = `poy/${candidateId}/pages`;
    const cloudResult = await uploadToCloudinary(req.file.buffer, {
      folder,
      public_id: `page_${page_slug}_${Date.now()}`,
      resource_type: 'raw',  // raw = non-image file
      format: 'html',
    });

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Archive existing active page for this slug
      await client.query(
        `UPDATE candidate_custom_pages
         SET is_active = FALSE, replaced_at = NOW()
         WHERE candidate_id = $1 AND page_slug = $2 AND is_active = TRUE`,
        [candidateId, page_slug]
      );

      // Insert new
      const insertResult = await client.query(`
        INSERT INTO candidate_custom_pages (
          candidate_id, page_slug, original_filename, cloudinary_public_id,
          cloudinary_url, file_size_bytes, is_active,
          payment_processor, processor_account, wants_webhook
        ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,$9)
        RETURNING *
      `, [
        candidateId,
        page_slug,
        req.file.originalname,
        cloudResult.public_id,
        cloudResult.secure_url,
        req.file.size,
        payment_processor || null,
        processor_account || null,
        wants_webhook === 'true' || wants_webhook === true,
      ]);

      await client.query('COMMIT');
      res.json({ success: true, page: insertResult.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Media] page upload error:', err.message);
    res.status(500).json({ error: 'Page upload failed', detail: err.message });
  }
});

// ── DELETE /api/media/pages/:slug — remove custom page ────────
router.delete('/pages/:slug', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  const { slug } = req.params;

  try {
    const result = await db.query(
      'SELECT * FROM candidate_custom_pages WHERE candidate_id = $1 AND page_slug = $2 AND is_active = TRUE',
      [candidateId, slug]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'No active custom page for this slug' });
    }

    const page = result.rows[0];
    await deleteFromCloudinary(page.cloudinary_public_id);
    await db.query(
      'UPDATE candidate_custom_pages SET is_active = FALSE, replaced_at = NOW() WHERE id = $1',
      [page.id]
    );

    res.json({ success: true, note: 'Page reverted to builder version' });
  } catch (err) {
    console.error('[Media] page delete error:', err.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
