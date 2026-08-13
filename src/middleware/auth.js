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

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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

function extractToken(req) {
  // Check HttpOnly cookie first (browser sessions)
  if (req.cookies?.poy_token) return req.cookies.poy_token;
  // Fall back to Authorization header (API calls)
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function setAuthCookie(res, token) {
  res.cookie('poy_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

function clearAuthCookie(res) {
  res.clearCookie('poy_token');
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
  if (!token) return unauthorized(res, '/login');

  const payload = verifyToken(token);
  if (!payload || payload.role !== 'candidate') {
    return unauthorized(res, '/login');
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
    // Generic error — don't confirm whether username or password was wrong
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

    // Look up user
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
      return res.status(401).json({ error: 'Account is not active' });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
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

    // Redirect to onboarding if not complete
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
// HELPERS
// ─────────────────────────────────────────────────

function unauthorized(res, loginUrl = '/login') {
  if (res.req.accepts('html')) {
    return res.redirect(loginUrl + '?redirect=' + encodeURIComponent(res.req.path));
  }
  return res.status(401).json({ error: 'Authentication required' });
}

module.exports = {
  requireAdmin,
  requireCandidate,
  optionalAuth,
  adminLogin,
  candidateLogin,
  logout,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
};
