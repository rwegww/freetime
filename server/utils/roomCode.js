function normalizeRoomCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
}

function extractInviteCode(rawInput) {
  const str = String(rawInput || '').trim();
  if (!str) return '';

  const joinPathMatch = str.match(/\/join\/([A-Za-z0-9_-]{3,32})(?:[/?#&\s]|$)/i);
  if (joinPathMatch && joinPathMatch[1]) {
    return normalizeRoomCode(joinPathMatch[1]);
  }

  const urlRoomMatch = str.match(/[?&]room=([A-Za-z0-9_-]{3,32})/i);
  if (urlRoomMatch && urlRoomMatch[1]) {
    return normalizeRoomCode(urlRoomMatch[1]);
  }

  const hashMatch = str.match(/#([A-Za-z0-9_-]{3,32})\b/);
  if (hashMatch && hashMatch[1]) {
    return normalizeRoomCode(hashMatch[1]);
  }

  const phraseMatch = str.match(
    /m[aã](?:\s+nh[oó]m|\s+m[oờ]i)?(?:\s+l[aà])?\s*[:=-]?\s*#?([A-Za-z0-9_-]{3,32})\b/i
  );
  if (phraseMatch && phraseMatch[1]) {
    return normalizeRoomCode(phraseMatch[1]);
  }

  return normalizeRoomCode(str);
}

function isValidRoomCode(code) {
  const normalized = normalizeRoomCode(code);
  return normalized.length >= 3 && normalized.length <= 32;
}

function makeAvatar(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return 'TV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getCurrentMondayKey(refDate = new Date()) {
  const now = new Date(refDate);
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  const yyyy = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `FT${suffix}`;
}

module.exports = {
  normalizeRoomCode,
  extractInviteCode,
  isValidRoomCode,
  makeAvatar,
  getCurrentMondayKey,
  generateRoomCode
};

