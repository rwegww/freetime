const TOKEN_STORAGE_KEY = 'freetime_auth_token';

export function getSavedToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function saveToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
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

export async function registerAccount({ name, username, password, role, color }) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, username, password, role, color })
  });
  return parseJsonResponse(res, 'Không thể đăng ký tài khoản.');
}

export async function loginAccount({ username, password }) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return parseJsonResponse(res, 'Không thể đăng nhập.');
}

export async function fetchCurrentUser() {
  const res = await fetch('/api/auth/me', {
    headers: authHeaders()
  });
  return parseJsonResponse(res, 'Phiên đăng nhập đã hết hạn.');
}

export async function updateMyProfile({ name, role, color }) {
  const res = await fetch('/api/auth/profile', {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, role, color })
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
