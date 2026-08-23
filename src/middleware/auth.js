/**
 * AUTH MIDDLEWARE
 * src/middleware/auth.js
 *
 * Three guards used across the platform:
 *
 *   requireAdmin      — system admin only (Rob). Checks against
 *                       ADMIN_USERNAME + ADMIN_PASSWORD env vars.
 *                       Never stored in DB — hardcoded in Railway.
 *
 *   requireCandidate  — logged-in candidate with an active account.
 *
 *   requireAuth       — any logged-in user (candidate or admin).
 *
 * JWT tokens are issued on login and sent as HttpOnly cookies.
 * They are also accepted in the Authorization header for API calls.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '30d';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Cookie domain: .partyofyou.org in production so it works across subdomains
// Leading dot is intentional — covers partyofyou.org AND www.partyofyou.org
const COOKIE_DOMAIN = process.env.NODE_ENV === 'production' ? '.partyofyou.org' : undefined;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Auth will not work.');
}

// ─────────────────────────────────────────────────
// TOKEN UTILITIES
// ─────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Like verifyToken but distinguishes expiry from invalid.
 * Returns: { payload } | { expired: true } | { invalid: true }
 */
function verifyTokenDetailed(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { payload };
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { expired: true };
    return { invalid: true };
  }
}

function extractToken(req) {
  // Check HttpOnly cookie first (browser sessions)
  if (req.cookies?.poy_token) return req.cookies.poy_token;
  // Fall back to Authorization header (API calls)
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

/**
 * Cookie options — must be identical between set and clear,
 * or the browser will not honor the clear.
 */
function cookieOptions(extra = {}) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    ...extra,
  };
}

function setAuthCookie(res, token) {
  res.cookie('poy_token', token, cookieOptions({ maxAge: COOKIE_MAX_AGE }));
}

function clearAuthCookie(res) {
  // Must pass same domain/secure/sameSite options that were used to SET the
  // cookie — without them the browser ignores the clear instruction.
  res.clearCookie('poy_token', cookieOptions());
}

// ─────────────────────────────────────────────────
// MIDDLEWARE: REQUIRE ADMIN
// Checks against env vars — not the DB.
// Admin session is also JWT-based for consistency.
// ─────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const token = extractToken(req);
  if (!token) return unauthorized(res, '/admin/login');

  const payload = verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return unauthorized(res, '/admin/login');
  }

  req.admin = { username: payload.username, role: 'admin' };
  next();
}

// ─────────────────────────────────────────────────
// MIDDLEWARE: REQUIRE CANDIDATE
// ─────────────────────────────────────────────────

function requireCandidate(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return unauthorizedApi(res, 'AUTH_REQUIRED', '/login');
  }

  const result = verifyTokenDetailed(token);

  if (result.expired) {
    // Distinguishable expiry — frontend shows "session expired" banner
    // instead of silently looping on API calls.
    clearAuthCookie(res);
    return unauthorizedApi(res, 'SESSION_EXPIRED', '/login');
  }

  if (result.invalid || !result.payload) {
    clearAuthCookie(res);
    return unauthorizedApi(res, 'AUTH_REQUIRED', '/login');
  }

  const payload = result.payload;

  if (payload.role !== 'candidate') {
    return unauthorizedApi(res, 'AUTH_REQUIRED', '/login');
  }

  req.candidate = {
    id: payload.candidateId,
    userId: payload.userId,
    email: payload.email,
    status: payload.status,
  };

  // Block suspended/closed candidates
  if (['suspended', 'closed'].includes(payload.status)) {
    if (req.accepts('html')) {
      return res.redirect('/account-suspended.html');
    }
    return res.status(403).json({
      error: 'Account suspended',
      message: 'Your account is not currently active. Contact support.',
    });
  }

  next();
}

// ─────────────────────────────────────────────────
// MIDDLEWARE: OPTIONAL AUTH
// Attaches user to req if token exists, doesn't block if not
// ─────────────────────────────────────────────────

function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
      req.isAdmin = payload.role === 'admin';
      req.isCandidate = payload.role === 'candidate';
    }
  }
  next();
}

// ─────────────────────────────────────────────────
// ADMIN LOGIN HANDLER
// POST /api/admin/login
// Body: { username, password }
// ─────────────────────────────────────────────────

async function adminLogin(req, res) {
  const { username, password } = req.body;

  if (
    !ADMIN_USERNAME || !ADMIN_PASSWORD ||
    username !== ADMIN_USERNAME ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken({
    role: 'admin',
    username: ADMIN_USERNAME,
    iat: Math.floor(Date.now() / 1000),
  });

  setAuthCookie(res, token);

  res.json({ success: true, redirect: '/admin/' });
}

// ─────────────────────────────────────────────────
// CANDIDATE LOGIN HANDLER
// POST /api/auth/login
// Body: { email, password }
// ─────────────────────────────────────────────────

async function candidateLogin(req, res, db) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const bcrypt = require('bcrypt');

    const userResult = await db.query(
      `SELECT u.id, u.email, u.password_hash, u.role, u.is_active,
              c.id as candidate_id, c.status as candidate_status, c.full_name,
              c.onboarding_step, c.platform_agreed
       FROM users u
       LEFT JOIN candidates c ON c.user_id = u.id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is not active. Check your email for a verification link.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await db.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    const token = signToken({
      role: 'candidate',
      userId: user.id,
      candidateId: user.candidate_id,
      email: user.email,
      status: user.candidate_status || 'onboarding',
    });

    setAuthCookie(res, token);

    const onboardingDone = user.platform_agreed && user.onboarding_step >= 5;

    res.json({
      success: true,
      redirect: onboardingDone ? '/dashboard/' : '/onboarding/',
      candidate: {
        name: user.full_name,
        status: user.candidate_status,
        onboardingStep: user.onboarding_step,
        platformAgreed: user.platform_agreed,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}

// ─────────────────────────────────────────────────
// LOGOUT HANDLER
// POST /api/auth/logout
// ─────────────────────────────────────────────────

function logout(req, res) {
  clearAuthCookie(res);
  res.json({ success: true, redirect: '/' });
}

// ─────────────────────────────────────────────────
// PASSWORD RESET — FORGOT PASSWORD
// POST /api/auth/forgot-password
// Body: { email }
//
// Generates a signed reset token (separate from JWT session),
// stores hash in DB, sends link via Postmark.
// Always returns 200 — never confirm whether email exists.
// ─────────────────────────────────────────────────

async function forgotPassword(req, res, db) {
  const { email } = req.body;

  // Always return 200 — don't reveal whether email is registered
  const safeResponse = () => res.json({
    success: true,
    message: 'If that email is registered, you will receive a reset link shortly.',
  });

  if (!email || !email.includes('@')) return safeResponse();
  if (!db) return safeResponse();

  try {
    const userResult = await db.query(
      'SELECT id, email, is_active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    const user = userResult.rows[0];
    if (!user || !user.is_active) return safeResponse();

    // Generate a cryptographically random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Ensure password_reset_tokens table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Invalidate any existing unused tokens for this user
    await db.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [user.id]
    );

    // Store the hash (never the raw token)
    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt]
    );

    // Send email via Postmark
    const resetUrl = `${process.env.APP_URL || 'https://partyofyou.org'}/reset-password.html?token=${rawToken}`;
    await sendResetEmail(user.email, resetUrl);

    console.log(`[Auth] Password reset requested for: ${user.email}`);
  } catch (err) {
    // Log but don't expose error — still return safe response
    console.error('[Auth] Forgot password error:', err.message);
  }

  return safeResponse();
}

// ─────────────────────────────────────────────────
// PASSWORD RESET — SET NEW PASSWORD
// POST /api/auth/reset-password
// Body: { token, password }
// ─────────────────────────────────────────────────

async function resetPassword(req, res, db) {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required.' });
  }

  if (password.length < 10) {
    return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  }

  if (!db) {
    return res.status(503).json({ error: 'Service unavailable. Please try again.' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenResult = await db.query(`
      SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at
      FROM password_reset_tokens prt
      WHERE prt.token_hash = $1
    `, [tokenHash]);

    const record = tokenResult.rows[0];

    if (!record) {
      return res.status(400).json({ error: 'Reset link is invalid. Please request a new one.' });
    }

    if (record.used_at) {
      return res.status(400).json({ error: 'Reset link has already been used. Please request a new one.' });
    }

    if (new Date() > new Date(record.expires_at)) {
      return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
    }

    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(password, 12);

    // Update password and mark token used in one transaction
    await db.query('BEGIN');
    try {
      await db.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [hash, record.user_id]
      );
      await db.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
        [record.id]
      );
      await db.query('COMMIT');
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }

    console.log(`[Auth] Password reset completed for user: ${record.user_id}`);
    res.json({ success: true, message: 'Password updated. You can now log in.' });
  } catch (err) {
    console.error('[Auth] Reset password error:', err.message);
    res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
}

// ─────────────────────────────────────────────────
// EMAIL SENDER — POSTMARK
// Postmark free tier: 100 emails/day, no credit card.
// Set POSTMARK_API_KEY + POSTMARK_FROM_EMAIL in Railway.
// ─────────────────────────────────────────────────

async function sendResetEmail(toEmail, resetUrl) {
  const apiKey = process.env.POSTMARK_API_KEY;
  const fromEmail = process.env.POSTMARK_FROM_EMAIL || 'noreply@partyofyou.org';

  if (!apiKey) {
    // Dev fallback — log the URL so you can test without Postmark configured
    console.log(`[Auth] DEV MODE — Password reset URL for ${toEmail}:`);
    console.log(`  ${resetUrl}`);
    return;
  }

  const axios = require('axios');

  await axios.post(
    'https://api.postmarkapp.com/email',
    {
      From: fromEmail,
      To: toEmail,
      Subject: 'Reset your Party of You password',
      TextBody: [
        'You requested a password reset for your Party of You account.',
        '',
        'Click the link below to set a new password. This link expires in 1 hour.',
        '',
        resetUrl,
        '',
        'If you did not request this, you can safely ignore this email.',
        'Your password will not change until you click the link above.',
        '',
        '— The Party of You Team',
      ].join('\n'),
      HtmlBody: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;color:#1a2540">
          <div style="margin-bottom:32px">
            <img src="https://partyofyou.org/images/PartyofYouLogo.png"
                 alt="Party of You" style="height:40px" />
          </div>
          <h2 style="margin:0 0 16px;font-size:22px">Reset your password</h2>
          <p style="margin:0 0 24px;color:#444;line-height:1.6">
            You requested a password reset. Click the button below to set a new password.
            This link expires in <strong>1 hour</strong>.
          </p>
          <a href="${resetUrl}"
             style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                    padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px">
            Reset Password
          </a>
          <p style="margin:32px 0 0;font-size:13px;color:#888;line-height:1.5">
            If you didn't request this, you can safely ignore this email.
            Your password won't change unless you click the link above.
          </p>
          <hr style="margin:32px 0;border:none;border-top:1px solid #eee" />
          <p style="margin:0;font-size:12px;color:#aaa">Party of You · partyofyou.org</p>
        </div>
      `,
      MessageStream: 'outbound',
    },
    {
      headers: {
        'X-Postmark-Server-Token': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 8000,
    }
  );
}

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

/**
 * Unified unauthorized response.
 * API requests (XHR/fetch) get JSON — never an HTML redirect.
 * Browser navigation gets redirected to login.
 *
 * Frontend detects SESSION_EXPIRED vs AUTH_REQUIRED to show
 * the right message ("session expired" vs "please log in").
 */
function unauthorizedApi(res, code = 'AUTH_REQUIRED', loginUrl = '/login') {
  const req = res.req;
  const isApiCall = req.path.startsWith('/api/') ||
                    req.headers['x-requested-with'] === 'XMLHttpRequest' ||
                    req.headers.accept?.includes('application/json');

  if (isApiCall) {
    return res.status(401).json({
      error: code,
      message: code === 'SESSION_EXPIRED'
        ? 'Your session has expired. Please log in again.'
        : 'Authentication required.',
    });
  }

  // HTML navigation — redirect to login with return path
  return res.redirect(`${loginUrl}?redirect=${encodeURIComponent(req.path)}`);
}

// Keep old name as alias for any callers outside this file
function unauthorized(res, loginUrl = '/login') {
  return unauthorizedApi(res, 'AUTH_REQUIRED', loginUrl);
}

module.exports = {
  requireAdmin,
  requireCandidate,
  optionalAuth,
  adminLogin,
  candidateLogin,
  logout,
  forgotPassword,
  resetPassword,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
};
