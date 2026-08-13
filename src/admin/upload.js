/**
 * ADMIN FILE UPLOAD ROUTES
 * src/admin/upload.js
 *
 * Handles bulk dataset file uploads from the admin dashboard.
 * Files are saved to data/raw/[source]/ then ingestion is triggered.
 *
 * Accepts: .csv, .sav, .tsv, .txt, .json, .zip, .xlsx
 * Max file size: 600MB (MIT Election Lab files can be large)
 *
 * Routes:
 *   POST /api/admin/upload/:source  — upload one or more files for a source
 *   GET  /api/admin/upload/:source  — list files already uploaded for a source
 *   DELETE /api/admin/upload/:source/:filename — remove a file
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAdmin } = require('../middleware/auth');

// All upload routes require admin auth
router.use(requireAdmin);

// Base data directory
const DATA_DIR = path.join(process.cwd(), 'data', 'raw');

// Allowed sources (must match keys in BULK_SOURCES in ingest.js)
const ALLOWED_SOURCES = [
  // Raw source data
  'mit-election-lab',
  'pew-research',
  'pew-waves',          // Individual Pew ATP wave SPSS files — add new waves anytime
  'gss',
  'anes',
  'opensecrets',
  'govtrack',
  'propublica-expenditures',
  'propublica-ftf',
  'kff',
  // Processed/ready-to-ingest datasets
  'election-intelligence',   // district_partisan_lean, district_intelligence, competitive_districts
  'election-history',        // election_history.csv (full 1976-2024)
  'precinct-2024',           // precinct_district_2024.csv
  'state-summary',           // state_summary.csv
];

// Allowed file extensions
const ALLOWED_EXTENSIONS = ['.csv', '.sav', '.tsv', '.txt', '.json', '.zip', '.xlsx', '.xls', '.dta', '.rdata', '.sas7bdat'];

// ── MULTER STORAGE CONFIG ──────────────────────────────────────
function createStorage(source) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(DATA_DIR, source);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // Keep original filename — sanitize it
      const safe = file.originalname
        .replace(/[^a-zA-Z0-9._\-]/g, '_')
        .toLowerCase();
      cb(null, safe);
    },
  });
}

function createUploader(source) {
  return multer({
    storage: createStorage(source),
    limits: {
      fileSize: 600 * 1024 * 1024, // 600MB
      files: 20, // Max 20 files per upload
    },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ALLOWED_EXTENSIONS.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`File type not allowed: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
      }
    },
  });
}

// ── LIST FILES ────────────────────────────────────────────────
// GET /api/admin/upload/:source
router.get('/:source', (req, res) => {
  const { source } = req.params;

  if (!ALLOWED_SOURCES.includes(source)) {
    return res.status(400).json({ error: `Unknown source: ${source}` });
  }

  const dir = path.join(DATA_DIR, source);

  if (!fs.existsSync(dir)) {
    return res.json({ source, files: [], totalSize: 0 });
  }

  const files = fs.readdirSync(dir)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      const stat = fs.statSync(path.join(dir, f));
      return {
        name: f,
        size: stat.size,
        sizeFormatted: formatBytes(stat.size),
        modified: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  res.json({
    source,
    directory: `data/raw/${source}/`,
    files,
    fileCount: files.length,
    totalSize: formatBytes(totalSize),
  });
});

// ── UPLOAD FILES ──────────────────────────────────────────────
// POST /api/admin/upload/:source
// Multipart form upload — field name: "files"
router.post('/:source', (req, res) => {
  const { source } = req.params;

  if (!ALLOWED_SOURCES.includes(source)) {
    return res.status(400).json({ error: `Unknown source: ${source}` });
  }

  const uploader = createUploader(source);
  const upload = uploader.array('files', 20);

  upload(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 600MB per file.' });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: 'No files received.' });
    }

    const uploaded = req.files.map(f => ({
      name: f.filename,
      originalName: f.originalname,
      size: formatBytes(f.size),
      path: `data/raw/${source}/${f.filename}`,
    }));

    // Auto-trigger ingestion if requested
    const autoIngest = req.query.ingest === 'true';
    let ingestResult = null;

    if (autoIngest && req.db) {
      try {
        const { ingestSource } = require('../jobs/ingest');
        ingestResult = await ingestSource(source, req.db);
      } catch (ingestErr) {
        ingestResult = { error: ingestErr.message };
      }
    }

    res.json({
      success: true,
      source,
      uploaded,
      fileCount: uploaded.length,
      autoIngested: autoIngest,
      ingestResult,
      message: autoIngest
        ? `${uploaded.length} file(s) uploaded and ingestion triggered.`
        : `${uploaded.length} file(s) uploaded to data/raw/${source}/. Click "Ingest" to process.`,
    });
  });
});

// ── DELETE FILE ───────────────────────────────────────────────
// DELETE /api/admin/upload/:source/:filename
router.delete('/:source/:filename', (req, res) => {
  const { source, filename } = req.params;

  if (!ALLOWED_SOURCES.includes(source)) {
    return res.status(400).json({ error: `Unknown source: ${source}` });
  }

  // Sanitize filename to prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(DATA_DIR, source, safe);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  fs.unlinkSync(filePath);

  res.json({ success: true, deleted: safe });
});

// ── HELPER ────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

module.exports = router;
