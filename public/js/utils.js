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

  const joinPathMatch = str.match(/\/join\/([A-Za-z0-9_-]{3,32})(?:[/?#&\s]|$)/i);
  if (joinPathMatch && joinPathMatch[1]) {
    return normalizeInviteCode(joinPathMatch[1]);
  }

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

export function isAvatarImageUrl(avatar) {
  return typeof avatar === 'string' && /^https?:\/\//i.test(avatar.trim());
}

export function getAvatarInitials(name, fallback = 'TV') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function renderAvatarHtml({
  avatar,
  name = '',
  color = '#6366f1',
  className = 'avatar-circle',
  extraStyle = ''
} = {}) {
  const bg = escapeHtml(color || '#6366f1');
  const styleAttr = extraStyle ? `background:${bg};${extraStyle}` : `background:${bg}`;
  const initials = getAvatarInitials(name, !isAvatarImageUrl(avatar) && avatar ? String(avatar) : 'TV');

  if (isAvatarImageUrl(avatar)) {
    const safeUrl = escapeHtml(String(avatar).trim());
    return `<span class="${className} has-avatar-img" style="${styleAttr}"><img src="${safeUrl}" alt="" class="avatar-img-fill" referrerpolicy="no-referrer" decoding="async" onerror="this.remove()" /><span class="avatar-initials-fb">${escapeHtml(initials)}</span></span>`;
  }

  const textVal = String(avatar || initials || 'TV').slice(0, 3);
  return `<span class="${className}" style="${styleAttr}">${escapeHtml(textVal)}</span>`;
}

export function applyAvatarElement(el, { avatar, name = '', color = '#6366f1' } = {}) {
  if (!el) return;
  const initials = getAvatarInitials(name, !isAvatarImageUrl(avatar) && avatar ? String(avatar) : 'TV');
  el.style.backgroundColor = color || '#6366f1';

  if (isAvatarImageUrl(avatar)) {
    el.classList.add('has-avatar-img');
    el.innerHTML = '';
    const img = document.createElement('img');
    img.src = String(avatar).trim();
    img.alt = name || 'Avatar';
    img.className = 'avatar-img-fill';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.remove();
      el.classList.remove('has-avatar-img');
    });
    const fb = document.createElement('span');
    fb.className = 'avatar-initials-fb';
    fb.textContent = initials;
    el.appendChild(img);
    el.appendChild(fb);
  } else {
    el.classList.remove('has-avatar-img');
    el.textContent = String(avatar || initials || 'TV').slice(0, 3);
  }
}
