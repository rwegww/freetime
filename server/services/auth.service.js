const crypto = require('crypto');
const config = require('../config');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSigningKey() {
  const rawSecret =
    process.env.AUTH_SECRET ||
    process.env.JWT_SECRET ||
    (config.supabase && config.supabase.secretKey) ||
    'freetime-sync-local-auth-secret-2026';
  return crypto.createHash('sha256').update(rawSecret).digest();
}

function normalizeUsername(input) {
  return String(input || '').trim().toLowerCase();
}

function isValidUsername(username) {
  const clean = normalizeUsername(username);
  if (clean.length < 3 || clean.length > 64) return false;
  return /^[a-z0-9._@-]+$/.test(clean);
}

function hashPassword(password) {
  const plain = String(password || '');
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  try {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const [, salt, expectedHex] = parts;
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const actualBuf = crypto.scryptSync(String(password || ''), salt, expectedBuf.length);
    if (actualBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  } catch (_) {
    return false;
  }
}

function signToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      username: user.username,
      exp: Date.now() + TOKEN_TTL_MS
    })
  ).toString('base64url');

  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', getSigningKey()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const data = `${header}.${payload}`;
    const expectedSig = crypto.createHmac('sha256', getSigningKey()).update(data).digest();
    const actualSig = Buffer.from(sig, 'base64url');
    if (actualSig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(actualSig, expectedSig)) return null;

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!decoded || !decoded.sub || !decoded.exp || decoded.exp < Date.now()) {
      return null;
    }
    return decoded;
  } catch (_) {
    return null;
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    color: user.color,
    avatar: user.avatar,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

module.exports = {
  normalizeUsername,
  isValidUsername,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  sanitizeUser
};
