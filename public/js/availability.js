import { DAY_NAMES, START_HOUR, END_HOUR } from './utils.js';
import { getWeekSchedules, getFilteredMembers, isDayIndexPast } from './state.js';

export function getSlotAvailability(dayIndex, hour, targetMembers = getFilteredMembers()) {
  const weekSched = getWeekSchedules();
  const key = `${dayIndex}-${hour}`;
  const freeMembers = [];
  const busyMembers = [];

  targetMembers.forEach(m => {
    const mSched = weekSched[m.id] || {};
    const entry = mSched[key];
    if (entry && entry.status === 'busy') {
      busyMembers.push({ member: m, note: entry.note || 'Bận' });
    } else {
      freeMembers.push(m);
    }
  });

  const total = targetMembers.length;
  const freeCount = freeMembers.length;

  return {
    total,
    freeCount,
    busyCount: busyMembers.length,
    freeMembers,
    busyMembers
  };
}

export function computeBestFreeBlocks(targetMembers = getFilteredMembers()) {
  const blocks = [];
  if (targetMembers.length === 0) return blocks;

  for (let d = 0; d < 7; d++) {
    if (isDayIndexPast(d)) continue;
    let currentStart = null;
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      const isAllFree =
        h < END_HOUR &&
        getSlotAvailability(d, h, targetMembers).freeCount === targetMembers.length;

      if (isAllFree) {
        if (currentStart === null) currentStart = h;
      } else if (currentStart !== null) {
        blocks.push({
          dayIndex: d,
          dayName: DAY_NAMES[d],
          startHour: currentStart,
          endHour: h,
          duration: h - currentStart,
          memberCount: targetMembers.length
        });
        currentStart = null;
      }
    }
  }

  blocks.sort((a, b) => b.duration - a.duration || a.dayIndex - b.dayIndex);
  return blocks;
}

