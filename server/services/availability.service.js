const DAY_NAMES = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];

/**
 * Pure function: Tính toán danh sách thành viên rảnh và bận tại một khung giờ cụ thể
 */
function computeSlotAvailability(weekSchedules = {}, members = [], dayIndex, hour) {
  const key = `${dayIndex}-${hour}`;
  const freeMembers = [];
  const busyMembers = [];

  for (const m of members) {
    const mSched = weekSchedules[m.id] || {};
    const entry = mSched[key];
    if (entry && entry.status === 'busy') {
      busyMembers.push({ member: m, note: entry.note || 'Bận' });
    } else {
      freeMembers.push(m);
    }
  }

  const total = members.length;
  const freeCount = freeMembers.length;
  const ratio = total > 0 ? freeCount / total : 0;

  return {
    total,
    freeCount,
    busyCount: busyMembers.length,
    ratio,
    freeMembers,
    busyMembers
  };
}

/**
 * Pure function: Tìm các khoảng thời gian trống liên tiếp của tất cả thành viên được chọn
 */
function computeBestFreeBlocks(weekSchedules = {}, members = [], startHour = 7, endHour = 22) {
  const blocks = [];
  if (!members || members.length === 0) return blocks;

  for (let d = 0; d < 7; d++) {
    let currentStart = null;
    for (let h = startHour; h <= endHour; h++) {
      const isAllFree =
        h < endHour &&
        computeSlotAvailability(weekSchedules, members, d, h).freeCount === members.length;

      if (isAllFree) {
        if (currentStart === null) currentStart = h;
      } else if (currentStart !== null) {
        blocks.push({
          dayIndex: d,
          dayName: DAY_NAMES[d],
          startHour: currentStart,
          endHour: h,
          duration: h - currentStart,
          memberCount: members.length
        });
        currentStart = null;
      }
    }
  }

  blocks.sort((a, b) => b.duration - a.duration || a.dayIndex - b.dayIndex);
  return blocks;
}

/**
 * Chuẩn hóa dữ liệu lịch trước khi lưu
 */
function sanitizeScheduleData(rawSchedule) {
  if (!rawSchedule || typeof rawSchedule !== 'object') return {};
  const cleaned = {};
  for (const [key, val] of Object.entries(rawSchedule)) {
    if (val && val.status === 'busy') {
      cleaned[key] = {
        status: 'busy',
        note: String(val.note || 'Bận').trim()
      };
    }
  }
  return cleaned;
}

function formatLocalYMD(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Ngăn không cho đăng ký hoặc thay đổi lịch của những ngày đã qua
 * (giữ nguyên dữ liệu lịch sử của các ngày < hôm nay, chỉ cập nhật từ hôm nay trở đi)
 */
function enforceNoPastScheduleChanges(existingSchedule = {}, incomingCleaned = {}, weekKey = '', nowDate = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekKey))) {
    return incomingCleaned;
  }

  const todayKey = formatLocalYMD(nowDate);
  const [y, m, day] = String(weekKey).split('-').map(Number);
  const merged = {};

  for (let d = 0; d < 7; d++) {
    const slotDate = new Date(y, m - 1, day + d);
    const isPast = formatLocalYMD(slotDate) < todayKey;
    const source = isPast ? (existingSchedule || {}) : (incomingCleaned || {});
    const prefix = `${d}-`;

    for (const [k, v] of Object.entries(source)) {
      if (k.startsWith(prefix) && v && v.status === 'busy') {
        merged[k] = v;
      }
    }
  }

  return merged;
}

module.exports = {
  DAY_NAMES,
  computeSlotAvailability,
  computeBestFreeBlocks,
  sanitizeScheduleData,
  enforceNoPastScheduleChanges
};

