const dbRepo = require('../repositories/db.repository');
const { verifyToken } = require('../services/auth.service');

function extractBearerToken(req) {
  const authHeader = req.headers && req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

async function resolveUserFromToken(token) {
  const payload = verifyToken(token);
  if (!payload || !payload.sub) return null;
  const user = await dbRepo.getUserById(payload.sub);
  return user || null;
}

async function optionalAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);
    req.user = token ? await resolveUserFromToken(token) : null;
    next();
  } catch (err) {
    next(err);
  }
}

async function requireAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);
    const user = token ? await resolveUserFromToken(token) : null;
    if (!user) {
      return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  extractBearerToken,
  resolveUserFromToken,
  optionalAuth,
  requireAuth
};
