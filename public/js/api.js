const TOKEN_STORAGE_KEY = 'freetime_auth_token';
const SESSION_TOKEN_KEY = 'freetime_auth_token_session';
const REMEMBER_PREF_KEY = 'freetime_remember_pref';
const REMEMBERED_ACCOUNT_KEY = 'freetime_remembered_account';

function readCookieToken() {
  try {
    const match = document.cookie
      .split('; ')
      .find(row => row.startsWith(`${TOKEN_STORAGE_KEY}=`));
    return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : '';
  } catch (_) {
    return '';
  }
}

function writeCookieToken(token, maxAgeSeconds) {
  try {
    document.cookie = `${TOKEN_STORAGE_KEY}=${encodeURIComponent(token)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
  } catch (_) {}
}

export function isRememberMePreferred() {
  return localStorage.getItem(REMEMBER_PREF_KEY) !== '0';
}

export function getSavedToken() {
  const sessionTok = sessionStorage.getItem(SESSION_TOKEN_KEY);
  if (sessionTok) return sessionTok;

  const localTok = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (localTok) return localTok;

  const cookieTok = readCookieToken();
  if (cookieTok) {
    localStorage.setItem(TOKEN_STORAGE_KEY, cookieTok);
    return cookieTok;
  }
  return '';
}

export function saveToken(token, { rememberMe = true } = {}) {
  if (!token) {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    writeCookieToken('', 0);
    return;
  }

  if (rememberMe !== false) {
    localStorage.setItem(REMEMBER_PREF_KEY, '1');
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    writeCookieToken(token, 365 * 24 * 60 * 60);
  } else {
    localStorage.setItem(REMEMBER_PREF_KEY, '0');
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    writeCookieToken('', 0);
  }
}

export function saveRememberedAccount(user) {
  if (!user || !user.username) return;
  try {
    localStorage.setItem(
      REMEMBERED_ACCOUNT_KEY,
      JSON.stringify({
        username: user.username,
        name: user.name || user.username,
        avatar: user.avatar || 'TV',
        color: user.color || '#6366f1',
        authProvider: user.authProvider || 'password'
      })
    );
  } catch (_) {}
}

export function getRememberedAccount() {
  try {
    const raw = localStorage.getItem(REMEMBERED_ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.username ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function clearRememberedAccount() {
  localStorage.removeItem(REMEMBERED_ACCOUNT_KEY);
}

function authHeaders(extra = {}) {
  const token = getSavedToken();
  const headers = { ...extra };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function parseJsonResponse(res, fallbackMsg) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || fallbackMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ==================== AUTH API ====================

export async function fetchAuthConfig() {
  const res = await fetch('/api/auth/config');
  return parseJsonResponse(res, 'Không thể tải cấu hình đăng nhập.');
}

export async function registerAccount({ name, username, password, rememberMe = true }) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, username, password, rememberMe })
  });
  return parseJsonResponse(res, 'Không thể đăng ký tài khoản.');
}

export async function loginAccount({ username, password, rememberMe = true }) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, rememberMe })
  });
  return parseJsonResponse(res, 'Không thể đăng nhập.');
}

export async function loginWithGoogle({
  idToken,
  accessToken,
  supabaseAccessToken,
  rememberMe = true
}) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, accessToken, supabaseAccessToken, rememberMe })
  });
  return parseJsonResponse(res, 'Không thể đăng nhập bằng Google.');
}

export async function fetchCurrentUser() {
  const res = await fetch('/api/auth/me', {
    headers: authHeaders()
  });
  return parseJsonResponse(res, 'Phiên đăng nhập đã hết hạn.');
}

export async function updateMyProfile({ name }) {
  const res = await fetch('/api/auth/profile', {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name })
  });
  return parseJsonResponse(res, 'Không thể cập nhật hồ sơ.');
}

// ==================== GROUPS API ====================

export async function fetchMyGroups() {
  const res = await fetch('/api/groups', {
    headers: authHeaders()
  });
  const data = await parseJsonResponse(res, 'Không thể tải danh sách nhóm.');
  return data.rooms || [];
}

export async function createNewGroup({ name, code, description }) {
  const res = await fetch('/api/groups', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, code, description })
  });
  return parseJsonResponse(res, 'Không thể tạo nhóm mới.');
}

export async function previewGroupByCode(rawCode) {
  const res = await fetch(`/api/groups/preview?code=${encodeURIComponent(String(rawCode || ''))}`, {
    headers: authHeaders()
  });
  return parseJsonResponse(res, 'Không thể kiểm tra mã nhóm.');
}

export async function joinGroupByCode(code) {
  const res = await fetch('/api/groups/join', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code })
  });
  return parseJsonResponse(res, 'Không thể tham gia nhóm.');
}

export async function fetchGroupDetail(code) {
  const cleanCode = String(code || '').trim().toUpperCase();
  const res = await fetch(`/api/groups/${encodeURIComponent(cleanCode)}`, {
    headers: authHeaders()
  });
  return parseJsonResponse(res, 'Không thể tải dữ liệu nhóm.');
}
