const crypto = require('crypto');
const config = require('../config');

const REMEMBER_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 365 days ("nhớ cho lần vào tiếp theo")
const SESSION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (when rememberMe is unchecked)

let cachedSupabaseGoogle = {
  checkedAt: 0,
  enabled: false
};

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

function isGoogleOnlyUser(user) {
  return Boolean(user && typeof user.passwordHash === 'string' && user.passwordHash.startsWith('oauth$google$'));
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

function signToken(user, { rememberMe = true } = {}) {
  const ttl = rememberMe === false ? SESSION_TOKEN_TTL_MS : REMEMBER_TOKEN_TTL_MS;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      username: user.username,
      rem: rememberMe !== false,
      exp: Date.now() + ttl
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

async function getPublicAuthConfig({ fetchImpl = fetch } = {}) {
  const googleClientId = String(config.googleClientId || process.env.GOOGLE_CLIENT_ID || '').trim();
  const supabaseUrl = String((config.supabase && config.supabase.url) || '').trim();
  const apiKey = String(
    (config.supabase && (config.supabase.publishableKey || config.supabase.secretKey)) || ''
  ).trim();

  let supabaseGoogleEnabled = false;
  if (supabaseUrl && apiKey) {
    if (Date.now() - cachedSupabaseGoogle.checkedAt < 60000) {
      supabaseGoogleEnabled = cachedSupabaseGoogle.enabled;
    } else {
      try {
        const res = await fetchImpl(`${supabaseUrl}/auth/v1/settings`, {
          headers: { apikey: apiKey }
        });
        if (res.ok) {
          const settings = await res.json();
          supabaseGoogleEnabled = Boolean(settings && settings.external && settings.external.google);
          cachedSupabaseGoogle = { checkedAt: Date.now(), enabled: supabaseGoogleEnabled };
        }
      } catch (_) {
        supabaseGoogleEnabled = false;
      }
    }
  }

  return {
    googleClientId,
    supabaseUrl: supabaseGoogleEnabled ? supabaseUrl : '',
    supabaseGoogleEnabled
  };
}

async function verifyGoogleAuthPayload(
  { idToken, accessToken, supabaseAccessToken } = {},
  { fetchImpl = fetch } = {}
) {
  const expectedClientId = String(config.googleClientId || process.env.GOOGLE_CLIENT_ID || '').trim();

  // 1. Verify Google Identity Services ID Token (JWT)
  if (idToken) {
    if (!expectedClientId) {
      const err = new Error('Máy chủ chưa cấu hình GOOGLE_CLIENT_ID.');
      err.status = 400;
      throw err;
    }
    const res = await fetchImpl(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(idToken))}`
    );
    if (!res.ok) {
      const err = new Error('Phiên xác thực Google không hợp lệ hoặc đã hết hạn.');
      err.status = 401;
      throw err;
    }
    const info = await res.json();
    const emailVerified = info.email_verified === true || info.email_verified === 'true';
    if (!info || info.aud !== expectedClientId || !info.email || !emailVerified) {
      const err = new Error('Xác thực tài khoản Google thất bại (sai Client ID hoặc email chưa xác minh).');
      err.status = 401;
      throw err;
    }
    return {
      sub: String(info.sub || info.email),
      email: String(info.email).trim().toLowerCase(),
      name: String(info.name || info.given_name || info.email.split('@')[0]).trim()
    };
  }

  // 2. Verify Google OAuth2 Access Token (from google.accounts.oauth2.initTokenClient popup)
  if (accessToken) {
    if (!expectedClientId) {
      const err = new Error('Máy chủ chưa cấu hình GOOGLE_CLIENT_ID.');
      err.status = 400;
      throw err;
    }
    const [tokenInfoRes, userInfoRes] = await Promise.all([
      fetchImpl(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(String(accessToken))}`),
      fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${String(accessToken)}` }
      })
    ]);

    if (!tokenInfoRes.ok || !userInfoRes.ok) {
      const err = new Error('Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn.');
      err.status = 401;
      throw err;
    }

    const tokenInfo = await tokenInfoRes.json();
    const userInfo = await userInfoRes.json();
    const aud = tokenInfo.aud || tokenInfo.azp;
    const emailVerified = userInfo.email_verified === true || userInfo.email_verified === 'true';

    if (aud !== expectedClientId || !userInfo.email || !emailVerified) {
      const err = new Error('Tài khoản Google không khớp cấu hình ứng dụng.');
      err.status = 401;
      throw err;
    }

    return {
      sub: String(userInfo.sub || userInfo.email),
      email: String(userInfo.email).trim().toLowerCase(),
      name: String(userInfo.name || userInfo.given_name || userInfo.email.split('@')[0]).trim()
    };
  }

  // 3. Verify Supabase Google OAuth Access Token
  if (supabaseAccessToken) {
    const supabaseUrl = String((config.supabase && config.supabase.url) || '').trim();
    const apiKey = String(
      (config.supabase && (config.supabase.publishableKey || config.supabase.secretKey)) || ''
    ).trim();
    if (!supabaseUrl || !apiKey) {
      const err = new Error('Chưa cấu hình kết nối Supabase OAuth.');
      err.status = 400;
      throw err;
    }

    const res = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${String(supabaseAccessToken)}`
      }
    });
    if (!res.ok) {
      const err = new Error('Phiên đăng nhập Google qua Supabase không hợp lệ.');
      err.status = 401;
      throw err;
    }
    const supaUser = await res.json();
    if (!supaUser || !supaUser.email) {
      const err = new Error('Không lấy được email từ tài khoản Google.');
      err.status = 401;
      throw err;
    }
    const meta = supaUser.user_metadata || {};
    return {
      sub: String(meta.sub || supaUser.id || supaUser.email),
      email: String(supaUser.email).trim().toLowerCase(),
      name: String(meta.full_name || meta.name || supaUser.email.split('@')[0]).trim()
    };
  }

  const err = new Error('Thiếu mã xác thực Google.');
  err.status = 400;
  throw err;
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
    authProvider: isGoogleOnlyUser(user) ? 'google' : 'password',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

module.exports = {
  normalizeUsername,
  isValidUsername,
  hashPassword,
  isGoogleOnlyUser,
  verifyPassword,
  signToken,
  verifyToken,
  getPublicAuthConfig,
  verifyGoogleAuthPayload,
  sanitizeUser
};
