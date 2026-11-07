export const DAY_NAMES = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];
export const SHORT_DAY_NAMES = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
export const START_HOUR = 7;
export const END_HOUR = 22;

export function getMondayOfDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

export function formatDateKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function isPastDate(date) {
  return formatDateKey(date) < formatDateKey(new Date());
}

export function formatShortDM(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function formatHourRange(h, endH = h + 1) {
  return `${String(h).padStart(2, '0')}:00 - ${String(endH).padStart(2, '0')}:00`;
}

export function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(el => el.classList.add('hidden'));
}

export function openModal(id) {
  closeAllModals();
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

export function showToast(text) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast-msg';
  t.textContent = text;
  container.appendChild(t);
  setTimeout(() => {
    t.remove();
  }, 3000);
}

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function normalizeInviteCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
}

export function extractInviteCode(rawInput) {
  const str = String(rawInput || '').trim();
  if (!str) return '';

  const urlRoomMatch = str.match(/[?&]room=([A-Za-z0-9_-]{3,32})/i);
  if (urlRoomMatch && urlRoomMatch[1]) {
    return normalizeInviteCode(urlRoomMatch[1]);
  }

  const hashMatch = str.match(/#([A-Za-z0-9_-]{3,32})\b/);
  if (hashMatch && hashMatch[1]) {
    return normalizeInviteCode(hashMatch[1]);
  }

  const phraseMatch = str.match(
    /m[aã](?:\s+nh[oó]m|\s+m[oờ]i)?(?:\s+l[aà])?\s*[:=-]?\s*#?([A-Za-z0-9_-]{3,32})\b/i
  );
  if (phraseMatch && phraseMatch[1]) {
    return normalizeInviteCode(phraseMatch[1]);
  }

  return normalizeInviteCode(str);
}

export function slugifyUsernameSuggestion(rawText) {
  return String(rawText || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9._@-]/g, '')
    .slice(0, 32);
}
