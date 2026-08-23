/**
 * CAMPAIGN FINANCE API
 * src/routes/finance.js
 *
 * All routes require candidate auth (applied in server.js)
 *
 * GET    /api/finance/donations          — list all donations
 * POST   /api/finance/donations          — log a donation
 * DELETE /api/finance/donations/:id      — delete a donation
 *
 * GET    /api/finance/expenses           — list all expenses
 * POST   /api/finance/expenses           — log an expense
 * DELETE /api/finance/expenses/:id       — delete an expense
 *
 * GET    /api/finance/summary            — totals + cash on hand
 */

const express = require('express');
const router = express.Router();

function currentReportingPeriod() {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `Q${q}-${now.getFullYear()}`;
}

// ── GET /api/finance/donations ──────────────────────────────────
router.get('/donations', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await db.query(
      `SELECT * FROM campaign_donations
       WHERE candidate_id = $1 AND is_refunded = FALSE
       ORDER BY received_date DESC, created_at DESC`,
      [candidateId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Finance] donations error:', err.message);
    res.status(500).json({ error: 'Could not load donations' });
  }
});

// ── POST /api/finance/donations ─────────────────────────────────
router.post('/donations', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  const {
    donor_name, donor_email, donor_employer, donor_occupation,
    donor_address, donor_city, donor_state, donor_zip,
    amount_cents, received_date, payment_method,
    transaction_id, notes, is_inkind, inkind_description,
  } = req.body;

  if (!amount_cents || amount_cents <= 0) {
    return res.status(400).json({ error: 'amount_cents required and must be > 0' });
  }
  if (!received_date) {
    return res.status(400).json({ error: 'received_date required' });
  }

  try {
    const result = await db.query(`
      INSERT INTO campaign_donations (
        candidate_id, donor_name, donor_email, donor_employer, donor_occupation,
        donor_address, donor_city, donor_state, donor_zip,
        amount_cents, received_date, payment_method, transaction_id,
        notes, is_inkind, inkind_description, reporting_period, source
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'manual')
      RETURNING *
    `, [
      candidateId,
      donor_name || null,
      donor_email || null,
      donor_employer || null,
      donor_occupation || null,
      donor_address || null,
      donor_city || null,
      donor_state?.toUpperCase() || null,
      donor_zip || null,
      amount_cents,
      received_date,
      payment_method || 'other',
      transaction_id || null,
      notes || null,
      is_inkind || false,
      inkind_description || null,
      currentReportingPeriod(),
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Finance] donation save error:', err.message);
    res.status(500).json({ error: 'Could not save donation', detail: err.message });
  }
});

// ── DELETE /api/finance/donations/:id ──────────────────────────
router.delete('/donations/:id', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await db.query(
      'DELETE FROM campaign_donations WHERE id = $1 AND candidate_id = $2 RETURNING id',
      [req.params.id, candidateId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Donation not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[Finance] donation delete error:', err.message);
    res.status(500).json({ error: 'Could not delete donation' });
  }
});

// ── GET /api/finance/expenses ───────────────────────────────────
router.get('/expenses', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await db.query(
      `SELECT * FROM campaign_expenses
       WHERE candidate_id = $1
       ORDER BY expense_date DESC, created_at DESC`,
      [candidateId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Finance] expenses error:', err.message);
    res.status(500).json({ error: 'Could not load expenses' });
  }
});

// ── POST /api/finance/expenses ──────────────────────────────────
router.post('/expenses', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  const {
    payee_name, payee_address, payee_city, payee_state, payee_zip,
    amount_cents, expense_date, payment_method, check_number,
    expense_category, description, notes, receipt_url,
  } = req.body;

  if (!amount_cents || amount_cents <= 0) return res.status(400).json({ error: 'amount_cents required' });
  if (!expense_date) return res.status(400).json({ error: 'expense_date required' });
  if (!payee_name)   return res.status(400).json({ error: 'payee_name required' });
  if (!description)  return res.status(400).json({ error: 'description required' });

  try {
    const result = await db.query(`
      INSERT INTO campaign_expenses (
        candidate_id, payee_name, payee_address, payee_city, payee_state, payee_zip,
        amount_cents, expense_date, payment_method, check_number,
        expense_category, description, notes, receipt_url, reporting_period
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      candidateId,
      payee_name,
      payee_address || null,
      payee_city || null,
      payee_state?.toUpperCase() || null,
      payee_zip || null,
      amount_cents,
      expense_date,
      payment_method || 'other',
      check_number || null,
      expense_category || 'other',
      description,
      notes || null,
      receipt_url || null,
      currentReportingPeriod(),
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Finance] expense save error:', err.message);
    res.status(500).json({ error: 'Could not save expense', detail: err.message });
  }
});

// ── DELETE /api/finance/expenses/:id ───────────────────────────
router.delete('/expenses/:id', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await db.query(
      'DELETE FROM campaign_expenses WHERE id = $1 AND candidate_id = $2 RETURNING id',
      [req.params.id, candidateId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Expense not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[Finance] expense delete error:', err.message);
    res.status(500).json({ error: 'Could not delete expense' });
  }
});

// ── GET /api/finance/summary ────────────────────────────────────
router.get('/summary', async (req, res) => {
  const db = req.db;
  const candidateId = req.candidate?.id;
  if (!candidateId) return res.status(401).json({ error: 'Not authenticated' });

  const period = req.query.period || currentReportingPeriod();

  try {
    const [donResult, expResult] = await Promise.all([
      db.query(
        `SELECT COALESCE(SUM(amount_cents),0) as total, COUNT(*) as count
         FROM campaign_donations WHERE candidate_id = $1 AND is_refunded = FALSE`,
        [candidateId]
      ),
      db.query(
        `SELECT COALESCE(SUM(amount_cents),0) as total, COUNT(*) as count
         FROM campaign_expenses WHERE candidate_id = $1`,
        [candidateId]
      ),
    ]);

    const raised = parseInt(donResult.rows[0].total);
    const spent  = parseInt(expResult.rows[0].total);

    res.json({
      total_raised_cents: raised,
      total_spent_cents:  spent,
      cash_on_hand_cents: raised - spent,
      donor_count:        parseInt(donResult.rows[0].count),
      expense_count:      parseInt(expResult.rows[0].count),
      reporting_period:   period,
    });
  } catch (err) {
    console.error('[Finance] summary error:', err.message);
    res.status(500).json({ error: 'Could not load summary' });
  }
});

module.exports = router;
