const fs = require('fs');
const os = require('os');
const path = require('path');

// Simple .env loader without external dependency
const envFile = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  }
}

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.env.DISABLE_SUPABASE === '1' ||
  Boolean(process.env.NODE_TEST_CONTEXT);

const isServerless = Boolean(process.env.VERCEL);

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH && !isServerless
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : isServerless
      ? path.join(os.tmpdir(), 'freetime-db.json')
      : path.resolve(__dirname, isTestEnv ? '../../data/test-db.json' : '../../data/db.json'),
  supabase: {
    url: isTestEnv ? '' : (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    publishableKey: isTestEnv ? '' : (process.env.SUPABASE_PUBLISHABLE_KEY || ''),
    secretKey: isTestEnv ? '' : (process.env.SUPABASE_SECRET_KEY || ''),
    jwksUrl: isTestEnv ? '' : (process.env.SUPABASE_JWKS_URL || '')
  }
};

module.exports = config;
