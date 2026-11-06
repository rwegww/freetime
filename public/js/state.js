import { getMondayOfDate, formatDateKey, addDays, isPastDate } from './utils.js';

export const state = {
  currentUser: null,
  myRooms: [],
  pendingInviteCode: '',
  roomCode: '',
  room: null,
  onlineMemberIds: [],
  activeMemberId: null,
  currentWeekMonday: getMondayOfDate(new Date()),
  selectedFilterMemberIds: new Set(),
  paintMode: 'busy', // 'busy' | 'free' | 'inspect'
  selectedColor: '#6366f1',
  profileColor: '#6366f1',
  inspectedSlot: null,
  typingTimeout: null,
  activeMobileTab: 'schedule', // 'schedule' | 'chat'
  unreadChatCount: 0,
  mobileDayFilter: 'all', // 'all' | 0..6
  mobileToolsOpen: false
};

export function getWeekKey() {
  return formatDateKey(state.currentWeekMonday);
}

export function isDayIndexPast(dayIndex) {
  return isPastDate(addDays(state.currentWeekMonday, dayIndex));
}

export function getActiveMember() {
  if (!state.room || !state.activeMemberId) return null;
  return state.room.members.find(m => m.id === state.activeMemberId) || null;
}

export function getWeekSchedules() {
  if (!state.room || !state.room.schedules) return {};
  return state.room.schedules[getWeekKey()] || {};
}

export function getMemberSchedule(memberId) {
  const weekSched = getWeekSchedules();
  return weekSched[memberId] || {};
}

export function getFilteredMembers() {
  if (!state.room) return [];
  const list = state.room.members.filter(m => state.selectedFilterMemberIds.has(m.id));
  return list.length > 0 ? list : state.room.members;
}
