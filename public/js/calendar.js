import {
  DAY_NAMES,
  SHORT_DAY_NAMES,
  START_HOUR,
  END_HOUR,
  getMondayOfDate,
  formatDateKey,
  parseLocalDateKey,
  formatShortDM,
  addDays,
  formatHourRange,
  openModal,
  closeModal,
  showToast,
  escapeHtml,
  renderAvatarHtml
} from './utils.js';
import {
  state,
  getWeekKey,
  getWeekSchedules,
  isDayIndexPast,
  getActiveMember,
  getMemberSchedule,
  getFilteredMembers
} from './state.js';
import { getSlotAvailability, computeBestFreeBlocks } from './availability.js';
import { emitUpdateSchedule, emitUpdateSchedulesBatch } from './socket.js';

let syncDebounce = null;
let didInitialTodayScroll = false;
let busyRangeMode = 'single'; // 'single' | 'multi'
let busyRangeHoursInitialized = false;

export const SHIFTS = [
  {
    id: 'morning',
    name: 'Sáng',
    badgeText: '7-12',
    rangeLabel: '07:00 - 12:00',
    shortLabel: '7-12',
    startHour: 7,
    endHour: 12,
    hours: [7, 8, 9, 10, 11]
  },
  {
    id: 'afternoon',
    name: 'Chiều',
    badgeText: '12-5',
    rangeLabel: '12:00 - 17:00',
    shortLabel: '12-5',
    startHour: 12,
    endHour: 17,
    hours: [12, 13, 14, 15, 16]
  },
  {
    id: 'evening',
    name: 'Tối',
    badgeText: '5-10h',
    rangeLabel: '17:00 - 22:00',
    shortLabel: '5-10h',
    startHour: 17,
    endHour: 22,
    hours: [17, 18, 19, 20, 21]
  }
];

export function getShiftAvailability(dayIndex, shift, targetMembers = getFilteredMembers()) {
  const weekSched = getWeekSchedules();
  const total = targetMembers.length;
  const freeMembers = [];
  const busyMembers = [];

  targetMembers.forEach(m => {
    const mSched = weekSched[m.id] || {};
    const busyEntries = [];
    shift.hours.forEach(h => {
      const entry = mSched[`${dayIndex}-${h}`];
      if (entry && entry.status === 'busy') {
        busyEntries.push({ hour: h, note: entry.note || 'Bận' });
      }
    });

    if (busyEntries.length === 0) {
      freeMembers.push(m);
    } else {
      const distinctNotes = Array.from(new Set(busyEntries.map(e => e.note)));
      busyMembers.push({
        member: m,
        busyHoursCount: busyEntries.length,
        totalHours: shift.hours.length,
        isFull: busyEntries.length === shift.hours.length,
        note: distinctNotes.join(', ') || 'Bận'
      });
    }
  });

  return {
    total,
    freeCount: freeMembers.length,
    busyCount: busyMembers.length,
    freeMembers,
    busyMembers
  };
}

export function renderMemberFilterChips() {
  const container = document.getElementById('memberFilterChips');
  if (!container || !state.room) return;
  container.innerHTML = '';

  const filterDot = document.getElementById('mobileFilterActiveDot');
  if (filterDot) {
    const isFiltered = state.selectedFilterMemberIds.size < state.room.members.length;
    filterDot.classList.toggle('hidden', !isFiltered);
  }

  state.room.members.forEach(member => {
    const isSelected = state.selectedFilterMemberIds.has(member.id);
    const chip = document.createElement('div');
    chip.className = `member-filter-chip ${isSelected ? 'selected' : ''}`;
    chip.innerHTML = `
      ${renderAvatarHtml({ avatar: member.avatar, name: member.name, color: member.color, className: 'chip-avatar' })}
      <span>${escapeHtml(member.name)}</span>
    `;
    chip.addEventListener('click', () => {
      if (state.selectedFilterMemberIds.has(member.id)) {
        if (state.selectedFilterMemberIds.size > 1) {
          state.selectedFilterMemberIds.delete(member.id);
        } else {
          showToast('Cần chọn ít nhất 1 thành viên để tính giờ trống.');
        }
      } else {
        state.selectedFilterMemberIds.add(member.id);
      }
      renderMemberFilterChips();
      renderUnifiedScheduleSection();
    });
    container.appendChild(chip);
  });
}

export function renderMobileDayStrip() {
  const strip = document.getElementById('mobileDayStrip');
  const table = document.getElementById('unifiedScheduleTable');
  const zoomHint = document.getElementById('gridZoomHint');
  if (!strip || !table || !state.room) return;

  const mon = state.currentWeekMonday;
  const todayStr = formatDateKey(new Date());
  const isAll = state.mobileDayFilter === 'all';
  table.dataset.mobileDay = String(state.mobileDayFilter);
  strip.classList.toggle('hidden', isAll);
  if (zoomHint) {
    zoomHint.textContent = isAll ? 'Chạm thứ để xem 1 ngày' : 'Chạm lại tên thứ để về cả tuần';
  }

  strip.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `mobile-day-pill back-week-pill ${isAll ? 'active' : ''}`;
  allBtn.textContent = '← Cả tuần';
  allBtn.addEventListener('click', () => {
    state.mobileDayFilter = 'all';
    renderMobileDayStrip();
  });
  strip.appendChild(allBtn);

  for (let d = 0; d < 7; d++) {
    const dateObj = addDays(mon, d);
    const dateKey = formatDateKey(dateObj);
    const isToday = dateKey === todayStr;
    const isPast = dateKey < todayStr;
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `mobile-day-pill ${state.mobileDayFilter === d ? 'active' : ''} ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''}`;
    btn.innerHTML = `<span>${SHORT_DAY_NAMES[d]}</span><small>${dd}</small>`;
    btn.addEventListener('click', () => {
      state.mobileDayFilter = d;
      renderMobileDayStrip();
    });
    strip.appendChild(btn);
  }

  if (!isAll) {
    requestAnimationFrame(() => {
      const activeBtn = strip.querySelector('.mobile-day-pill.active:not(.back-week-pill)');
      if (activeBtn) {
        strip.scrollLeft = Math.max(0, activeBtn.offsetLeft - 95);
      }
    });
  }
}

export function renderUnifiedScheduleSection() {
  if (!state.room) return;
  const mon = state.currentWeekMonday;
  const todayStr = formatDateKey(new Date());

  renderMobileDayStrip();

  const isShifts = state.calendarViewMode !== 'hours';
  const isPersonalScope = (state.calendarScope || 'personal') === 'personal';

  const table = document.getElementById('unifiedScheduleTable');
  if (table) {
    table.dataset.calendarView = isShifts ? 'shifts' : 'hours';
    table.dataset.calendarScope = isPersonalScope ? 'personal' : 'team';
  }
  const scheduleCard = document.getElementById('scheduleSectionCard');
  if (scheduleCard) {
    scheduleCard.dataset.calendarScope = isPersonalScope ? 'personal' : 'team';
  }

  const btnScopePersonal = document.getElementById('btnScopePersonal');
  const btnScopeTeam = document.getElementById('btnScopeTeam');
  if (btnScopePersonal) {
    btnScopePersonal.classList.toggle('active', isPersonalScope);
    btnScopePersonal.setAttribute('aria-selected', String(isPersonalScope));
  }
  if (btnScopeTeam) {
    btnScopeTeam.classList.toggle('active', !isPersonalScope);
    btnScopeTeam.setAttribute('aria-selected', String(!isPersonalScope));
  }

  const scopeBadge = document.getElementById('scopeContextBadge');
  const scopeDesc = document.getElementById('scopeContextDesc');
  if (scopeBadge) {
    scopeBadge.textContent = isPersonalScope ? '👤 Lịch của bạn' : '👥 Lịch tổng hợp nhóm';
  }
  if (scopeDesc) {
    scopeDesc.textContent = isPersonalScope
      ? 'Chỉ hiển thị lịch bận & giờ trống của riêng bạn'
      : 'Tổng hợp lịch làm việc & tìm giờ rảnh chung cả nhóm';
  }

  const legendItemsGroup = document.getElementById('legendItemsGroup');
  if (legendItemsGroup) {
    if (isPersonalScope) {
      legendItemsGroup.innerHTML = `
        <span class="legend-item"><i class="swatch swatch-my-busy"></i> Bạn bận</span>
        <span class="legend-item"><i class="swatch swatch-my-free"></i> Bạn rảnh</span>
      `;
    } else {
      legendItemsGroup.innerHTML = `
        <span class="legend-item"><i class="swatch swatch-my-busy"></i> Bạn bận</span>
        <span class="legend-item"><i class="swatch swatch-100"></i> Nhóm rảnh</span>
        <span class="legend-item"><i class="swatch swatch-partial"></i> Rảnh 1 phần</span>
      `;
    }
  }

  const btnShifts = document.getElementById('btnViewShifts');
  const btnHours = document.getElementById('btnViewHours');
  if (btnShifts) {
    btnShifts.classList.toggle('active', isShifts);
    btnShifts.setAttribute('aria-selected', String(isShifts));
  }
  if (btnHours) {
    btnHours.classList.toggle('active', !isShifts);
    btnHours.setAttribute('aria-selected', String(!isShifts));
  }

  // 1. Render Table Header
  const headTr = document.getElementById('unifiedTableHeadRow');
  headTr.innerHTML = `<th class="time-col-header"></th>`;
  let todayIndex = -1;
  for (let d = 0; d < 7; d++) {
    const dateObj = addDays(mon, d);
    const dateKey = formatDateKey(dateObj);
    const isToday = dateKey === todayStr;
    const isPast = dateKey < todayStr;
    if (isToday) todayIndex = d;
    const th = document.createElement('th');
    th.dataset.day = String(d);
    if (isToday) th.classList.add('today-col');
    if (isPast) {
      th.classList.add('past-col');
      th.title = 'Ngày đã qua — không thể đăng ký lịch';
    }
    th.innerHTML = `
      <span class="day-col-name"><span class="day-full">${DAY_NAMES[d]}</span><span class="day-short">${SHORT_DAY_NAMES[d]}</span></span>
      <span class="day-col-sub">${formatShortDM(dateObj)}</span>
    `;
    th.addEventListener('click', () => {
      if (window.innerWidth > 640) return;
      state.mobileDayFilter = state.mobileDayFilter === d ? 'all' : d;
      renderMobileDayStrip();
    });
    headTr.appendChild(th);
  }

  // 2. Render Table Body
  const tbody = document.getElementById('unifiedScheduleBody');
  tbody.innerHTML = '';

  const me = getActiveMember();
  const mySched = me ? getMemberSchedule(me.id) : {};
  const targetMembers = getFilteredMembers();
  let allFreeSlotsCount = 0;

  const now = new Date();
  const nowHour = now.getHours();
  const nowOffsetPct = Math.round((now.getMinutes() / 60) * 100);

  const isMyBusyAt = (d, h) => {
    const e = mySched[`${d}-${h}`];
    return Boolean(e && e.status === 'busy');
  };
  const isSameMyBusyNoteAt = (d, h, noteStr) => {
    const e = mySched[`${d}-${h}`];
    return Boolean(e && e.status === 'busy' && (e.note || 'Bận') === noteStr);
  };
  const isAllFreeAt = (d, h) => {
    if (h < START_HOUR || isMyBusyAt(d, h)) return false;
    const i = getSlotAvailability(d, h, targetMembers);
    return i.total > 0 && i.freeCount === i.total;
  };

  if (isShifts) {
    // ==================== CHẾ ĐỘ 3 CA (SÁNG 7-12, CHIỀU 12-5, TỐI 5-10H) ====================
    for (const shift of SHIFTS) {
      const tr = document.createElement('tr');
      tr.className = `shift-row shift-row-${shift.id}`;

      const timeTd = document.createElement('td');
      timeTd.className = 'time-cell shift-time-cell';
      const isNowInShift = todayIndex !== -1 && nowHour >= shift.startHour && nowHour < shift.endHour;
      if (isNowInShift) timeTd.classList.add('is-now-shift');
      timeTd.innerHTML = `
        <div class="shift-time-inner">
          <strong class="shift-time-name">${shift.name}</strong>
          <span class="shift-time-badge">${shift.badgeText}</span>
          <span class="shift-time-range">${shift.rangeLabel}</span>
        </div>
      `;
      timeTd.title = `Ca ${shift.name} • ${shift.rangeLabel}`;
      tr.appendChild(timeTd);

      for (let d = 0; d < 7; d++) {
        const isPast = isDayIndexPast(d);
        const myBusyEntries = [];
        shift.hours.forEach(h => {
          const e = mySched[`${d}-${h}`];
          if (e && e.status === 'busy') {
            myBusyEntries.push({ hour: h, note: e.note || 'Bận' });
          }
        });
        const isMyBusy = myBusyEntries.length > 0;
        const isMyFullyBusy = myBusyEntries.length === shift.hours.length;
        const myDistinctNotes = Array.from(new Set(myBusyEntries.map(e => e.note)));
        const myBusyNote = myDistinctNotes.join(', ') || 'Bận';

        const info = getShiftAvailability(d, shift, targetMembers);
        const isAllFree = info.total > 0 && info.freeCount === info.total;
        if (!isPast && isAllFree) {
          allFreeSlotsCount += shift.hours.length;
        }

        const td = document.createElement('td');
        td.dataset.day = String(d);
        td.dataset.shift = shift.id;
        const classes = ['unified-slot-cell', 'shift-slot-cell'];

        if (isPersonalScope) {
          // ==================== LỊCH CÁ NHÂN: Chỉ hiện trạng thái của bạn, không lẫn thông tin nhóm ====================
          if (isPast) {
            classes.push('is-past-day');
            if (isMyBusy) {
              classes.push('cell-my-busy');
            } else {
              classes.push('cell-past-locked');
            }
          } else if (isMyBusy) {
            classes.push('cell-my-busy');
          } else {
            classes.push('cell-my-free');
          }

          if (d === todayIndex) {
            classes.push('is-today');
            if (nowHour >= shift.startHour && nowHour < shift.endHour) {
              classes.push('is-now-shift-cell');
            }
          }

          td.className = classes.join(' ');

          td.title = `${DAY_NAMES[d]} • Ca ${shift.name} (${shift.rangeLabel})\n` +
            (isMyBusy ? `Bạn: ${myBusyNote} (${myBusyEntries.length}/${shift.hours.length}h)` : 'Bạn: Rảnh ca này') +
            (isPast ? '\n🔒 Ngày đã qua — không thể đăng ký lịch' : '');

          let statusHtml = '';
          if (isMyBusy) {
            const frac = !isMyFullyBusy ? `<small class="shift-frac">(${myBusyEntries.length}/5h)</small>` : '';
            statusHtml = `<span class="shift-cell-label shift-label-busy">📌 ${escapeHtml(myBusyNote)}${frac}</span>`;
          } else if (isPast) {
            statusHtml = `<span class="shift-cell-label shift-label-past">Đã qua</span>`;
          } else {
            statusHtml = `<span class="shift-cell-label shift-label-my-free">✨ Rảnh</span>`;
          }

          td.innerHTML = `
            <div class="shift-cell-inner">
              <div class="shift-cell-header">
                <span class="shift-cell-tag">${shift.badgeText}</span>
              </div>
              <div class="shift-cell-main">
                ${statusHtml}
              </div>
              <div class="shift-cell-footer">
                <span class="shift-personal-status">${isMyBusy ? 'Đã xếp bận' : 'Rảnh'}</span>
              </div>
            </div>
          `;
        } else {
          // ==================== LỊCH NHÓM: Tổng hợp tỷ lệ rảnh & avatar của tất cả thành viên ====================
          if (isPast) {
            classes.push('is-past-day');
            if (isMyBusy) {
              classes.push('cell-my-busy');
            } else {
              classes.push('cell-past-locked');
            }
          } else if (isMyBusy) {
            classes.push('cell-my-busy');
          } else if (isAllFree) {
            classes.push('cell-all-free');
          } else if (info.freeCount > 0) {
            classes.push('cell-partial');
          } else {
            classes.push('cell-none');
          }

          if (d === todayIndex) {
            classes.push('is-today');
            if (nowHour >= shift.startHour && nowHour < shift.endHour) {
              classes.push('is-now-shift-cell');
            }
          }

          td.className = classes.join(' ');

          const freeNames = info.freeMembers.map(m => m.name).join(', ') || 'Không ai';
          td.title = `${DAY_NAMES[d]} • Ca ${shift.name} (${shift.rangeLabel})\n` +
            `Trống ${info.freeCount}/${info.total}: ${freeNames}` +
            (isMyBusy ? `\nBạn: ${myBusyNote} (${myBusyEntries.length}/${shift.hours.length}h)` : '') +
            (isPast ? '\n🔒 Ngày đã qua — không thể đăng ký lịch' : '');

          let statusHtml = '';
          if (isMyBusy) {
            const frac = !isMyFullyBusy ? `<small class="shift-frac">(${myBusyEntries.length}/5h)</small>` : '';
            statusHtml = `<span class="shift-cell-label shift-label-busy">📌 ${escapeHtml(myBusyNote)}${frac}</span>`;
          } else if (isPast) {
            statusHtml = `<span class="shift-cell-label shift-label-past">Đã qua</span>`;
          } else if (isAllFree) {
            statusHtml = `<span class="shift-cell-label shift-label-free">✨ Nhóm rảnh</span>`;
          } else if (info.freeCount > 0) {
            statusHtml = `<span class="shift-cell-label shift-label-partial">⚡ Trống ${info.freeCount}/${info.total}</span>`;
          } else {
            statusHtml = `<span class="shift-cell-label shift-label-none">Bận cả nhóm</span>`;
          }

          const freeAvatarsHtml = !isPast && !isMyBusy && !isAllFree && info.freeMembers.length > 0
            ? info.freeMembers
                .slice(0, 3)
                .map(m => renderAvatarHtml({ avatar: m.avatar, name: m.name, color: m.color, className: 'mini-dot' }))
                .join('')
            : '';

          td.innerHTML = `
            <div class="shift-cell-inner">
              <div class="shift-cell-header">
                <span class="shift-cell-tag">${shift.badgeText}</span>
                <span class="shift-cell-ratio">${info.freeCount}/${info.total}</span>
              </div>
              <div class="shift-cell-main">
                ${statusHtml}
              </div>
              <div class="shift-cell-footer">
                <div class="shift-cell-avatars">${freeAvatarsHtml}</div>
                <button type="button" class="btn-cell-inspect" title="Xem chi tiết ca ${shift.name} (${shift.rangeLabel})">i</button>
              </div>
            </div>
          `;
        }

        bindShiftCellInteractions(td, d, shift);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  } else {
    // ==================== CHẾ ĐỘ TỪNG GIỜ (15H: 07:00 - 22:00) ====================
    for (let h = START_HOUR; h < END_HOUR; h++) {
      const tr = document.createElement('tr');
      if (h === 7) tr.classList.add('shift-divider-morning');
      if (h === 12) tr.classList.add('shift-divider-afternoon');
      if (h === 17) tr.classList.add('shift-divider-evening');

      const timeTd = document.createElement('td');
      timeTd.className = 'time-cell';
      if (todayIndex !== -1 && h === nowHour) timeTd.classList.add('is-now-hour');
      timeTd.textContent = `${String(h).padStart(2, '0')}:00`;
      timeTd.title = formatHourRange(h);
      tr.appendChild(timeTd);

      for (let d = 0; d < 7; d++) {
        const key = `${d}-${h}`;
        const isPast = isDayIndexPast(d);
        const myEntry = mySched[key];
        const isMyBusy = myEntry && myEntry.status === 'busy';
        const myBusyNote = isMyBusy ? (myEntry.note || 'Bận') : '';

        const info = getSlotAvailability(d, h, targetMembers);
        const isAllFree = info.total > 0 && info.freeCount === info.total;
        if (!isPast && isAllFree) allFreeSlotsCount++;

        const td = document.createElement('td');
        td.dataset.day = String(d);
        const classes = ['unified-slot-cell'];
        let isBlockCont = false;

        if (isPersonalScope) {
          // ==================== LỊCH CÁ NHÂN: Chỉ hiện trạng thái của bạn, không lẫn thông tin nhóm ====================
          if (isPast) {
            classes.push('is-past-day');
            if (isMyBusy) {
              classes.push('cell-my-busy');
              isBlockCont = h > START_HOUR && isSameMyBusyNoteAt(d, h - 1, myBusyNote);
            } else {
              classes.push('cell-past-locked');
              isBlockCont = h > START_HOUR && !isMyBusyAt(d, h - 1);
            }
          } else if (isMyBusy) {
            classes.push('cell-my-busy');
            isBlockCont = h > START_HOUR && isSameMyBusyNoteAt(d, h - 1, myBusyNote);
          } else {
            classes.push('cell-my-free');
          }

          if (isBlockCont) classes.push('block-cont');
          if (d === todayIndex) classes.push('is-today');
          if (d === todayIndex && h === nowHour) {
            classes.push('is-now');
            td.style.setProperty('--now-offset', `${nowOffsetPct}%`);
          }
          td.className = classes.join(' ');

          td.title = `${DAY_NAMES[d]} • ${formatHourRange(h)}\n` +
            (isMyBusy ? `Bạn: ${myBusyNote}` : 'Bạn: Rảnh') +
            (isPast ? '\n🔒 Ngày đã qua — không thể đăng ký lịch' : '');

          let labelHtml = '';
          if (isMyBusy) {
            labelHtml = !isBlockCont
              ? `<span class="cell-label">${escapeHtml(myBusyNote)}</span>`
              : `<span class="cell-label"></span>`;
          } else {
            labelHtml = `<span class="cell-label"></span>`;
          }

          td.innerHTML = `
            <div class="cell-inner">
              ${labelHtml}
            </div>
          `;
        } else {
          // ==================== LỊCH NHÓM: Tổng hợp tỷ lệ rảnh & avatar của tất cả thành viên ====================
          if (isPast) {
            classes.push('is-past-day');
            if (isMyBusy) {
              classes.push('cell-my-busy');
              isBlockCont = h > START_HOUR && isSameMyBusyNoteAt(d, h - 1, myBusyNote);
            } else {
              classes.push('cell-past-locked');
              isBlockCont = h > START_HOUR && !isMyBusyAt(d, h - 1);
            }
          } else if (isMyBusy) {
            classes.push('cell-my-busy');
            isBlockCont = h > START_HOUR && isSameMyBusyNoteAt(d, h - 1, myBusyNote);
          } else if (isAllFree) {
            classes.push('cell-all-free');
            isBlockCont = isAllFreeAt(d, h - 1);
          } else if (info.freeCount > 0) {
            classes.push('cell-partial');
          } else {
            classes.push('cell-none');
          }
          if (isBlockCont) classes.push('block-cont');
          if (d === todayIndex) classes.push('is-today');
          if (d === todayIndex && h === nowHour) {
            classes.push('is-now');
            td.style.setProperty('--now-offset', `${nowOffsetPct}%`);
          }
          td.className = classes.join(' ');

          const freeNames = info.freeMembers.map(m => m.name).join(', ') || 'Không ai';
          td.title = `${DAY_NAMES[d]} • ${formatHourRange(h)}\nTrống ${info.freeCount}/${info.total}: ${freeNames}` +
            (isMyBusy ? `\nBạn: ${myBusyNote}` : '') +
            (isPast ? '\n🔒 Ngày đã qua — không thể đăng ký lịch' : '');

          let labelHtml = '';
          if (isMyBusy) {
            labelHtml = !isBlockCont
              ? `<span class="cell-label">${escapeHtml(myBusyNote)}</span>`
              : `<span class="cell-label"></span>`;
          } else if (isPast) {
            labelHtml = `<span class="cell-label"></span>`;
          } else if (isAllFree && !isBlockCont) {
            labelHtml = `<span class="cell-label cell-free-text">Nhóm rảnh</span>`;
          } else if (!isMyBusy && !isAllFree && info.freeCount > 0) {
            labelHtml = `<span class="cell-label cell-partial-names">Trống: ${escapeHtml(freeNames)}</span>`;
          } else {
            labelHtml = `<span class="cell-label"></span>`;
          }

          const freeAvatarsHtml = !isPast && !isMyBusy && !isAllFree
            ? info.freeMembers
              .slice(0, 3)
              .map(m => renderAvatarHtml({ avatar: m.avatar, name: m.name, color: m.color, className: 'mini-dot' }))
              .join('')
            : '';

          td.innerHTML = `
            <div class="cell-inner">
              ${labelHtml}
              <span class="cell-right">
                <span class="cell-avatars">${freeAvatarsHtml}</span>
                <span class="cell-ratio">${info.freeCount}/${info.total}</span>
                <button type="button" class="btn-cell-inspect" title="Xem chi tiết ai rảnh / ai bận & đề xuất lịch hẹn">i</button>
              </span>
            </div>
          `;
        }

        bindSlotCellInteractions(td, d, h);
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }
  }

  // 3. Update Summary Stats
  document.getElementById('statAllFreeHours').textContent = `${allFreeSlotsCount}h rảnh`;
  const mobileFreeBadge = document.getElementById('mobileTabFreeBadge');
  if (mobileFreeBadge) mobileFreeBadge.textContent = `${allFreeSlotsCount}h rảnh`;

  const totalSlots = 7 * (END_HOUR - START_HOUR);
  if (me) {
    const myBusy = Object.values(mySched).filter(x => x && x.status === 'busy').length;
    const myFree = totalSlots - myBusy;
    document.getElementById('statMyBusyHours').textContent = `${myBusy}h bận`;
    document.getElementById('statMyFreeHours').textContent = `${myFree}h trống`;
    const mobilePersonalBadge = document.getElementById('mobileTabPersonalBadge');
    if (mobilePersonalBadge) mobilePersonalBadge.textContent = `${myBusy}h bận`;
  }

  renderBestContinuousSlots(targetMembers);

  if (!didInitialTodayScroll && todayIndex > 1) {
    didInitialTodayScroll = true;
    requestAnimationFrame(() => {
      const wrapper = document.getElementById('calendarTableWrapper');
      const todayTh = headTr.querySelector('th.today-col');
      if (wrapper && todayTh && wrapper.scrollWidth > wrapper.clientWidth + 20) {
        const targetLeft = Math.max(0, todayTh.offsetLeft - 72);
        wrapper.scrollLeft = targetLeft;
      }
    });
  }
}

function bindSlotCellInteractions(td, d, h) {
  let longPressTimer = null;
  let longPressTriggered = false;
  let pointerMoved = false;
  let startX = 0;
  let startY = 0;

  const clearLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const inspectBtn = td.querySelector('.btn-cell-inspect');
  inspectBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  inspectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openSlotInspector(d, h);
  });

  td.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.btn-cell-inspect')) return;
    if (e.button !== undefined && e.button !== 0) return;

    pointerMoved = false;
    longPressTriggered = false;
    startX = e.clientX;
    startY = e.clientY;
    clearLongPress();

    if (e.pointerType !== 'mouse') {
      // Touch / Pen: giữ 430ms để xem chi tiết khung giờ
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        if (navigator.vibrate) navigator.vibrate(12);
        openSlotInspector(d, h);
      }, 430);
    }
  });

  td.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
      pointerMoved = true;
      clearLongPress();
    }
  });

  td.addEventListener('pointerup', clearLongPress);
  td.addEventListener('pointercancel', clearLongPress);

  td.addEventListener('click', (e) => {
    if (e.target.closest('.btn-cell-inspect')) return;
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }
    if (pointerMoved) {
      pointerMoved = false;
      return;
    }
    if (state.paintMode === 'inspect') {
      openSlotInspector(d, h);
      return;
    }
    if (isDayIndexPast(d)) {
      showToast('🔒 Không thể đăng ký hoặc chỉnh sửa lịch của ngày đã qua.');
      return;
    }
    if (!state.activeMemberId) {
      openModal('memberModal');
      return;
    }
    applyPersonalSlotPaint(d, h);
  });
}

export function applyPersonalShiftPaint(dayIndex, shift) {
  if (isDayIndexPast(dayIndex)) {
    showToast('🔒 Không thể đăng ký hoặc chỉnh sửa lịch của ngày đã qua.');
    return;
  }
  const me = getActiveMember();
  if (!me) return;

  const weekKey = getWeekKey();
  if (!state.room.schedules[weekKey]) state.room.schedules[weekKey] = {};
  if (!state.room.schedules[weekKey][me.id]) state.room.schedules[weekKey][me.id] = {};

  const mySched = state.room.schedules[weekKey][me.id];
  const noteInput = document.getElementById('busyNoteInput').value.trim() || 'Bận';

  const isFullyBusy = shift.hours.every(h => {
    const e = mySched[`${dayIndex}-${h}`];
    return e && e.status === 'busy';
  });

  if (state.paintMode === 'busy') {
    if (isFullyBusy) {
      shift.hours.forEach(h => delete mySched[`${dayIndex}-${h}`]);
    } else {
      shift.hours.forEach(h => {
        mySched[`${dayIndex}-${h}`] = { status: 'busy', note: noteInput };
      });
    }
  } else {
    shift.hours.forEach(h => delete mySched[`${dayIndex}-${h}`]);
  }

  renderUnifiedScheduleSection();
  syncMyScheduleToServer();
}

function bindShiftCellInteractions(td, d, shift) {
  let longPressTimer = null;
  let longPressTriggered = false;
  let pointerMoved = false;
  let startX = 0;
  let startY = 0;

  const clearLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const inspectBtn = td.querySelector('.btn-cell-inspect');
  if (inspectBtn) {
    inspectBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    inspectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSlotInspector(d, shift.startHour, shift.endHour);
    });
  }

  td.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.btn-cell-inspect')) return;
    if (e.button !== undefined && e.button !== 0) return;

    pointerMoved = false;
    longPressTriggered = false;
    startX = e.clientX;
    startY = e.clientY;
    clearLongPress();

    if (e.pointerType !== 'mouse') {
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        if (navigator.vibrate) navigator.vibrate(12);
        openSlotInspector(d, shift.startHour, shift.endHour);
      }, 430);
    }
  });

  td.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
      pointerMoved = true;
      clearLongPress();
    }
  });

  td.addEventListener('pointerup', clearLongPress);
  td.addEventListener('pointercancel', clearLongPress);

  td.addEventListener('click', (e) => {
    if (e.target.closest('.btn-cell-inspect')) return;
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }
    if (pointerMoved) {
      pointerMoved = false;
      return;
    }
    if (state.paintMode === 'inspect') {
      openSlotInspector(d, shift.startHour, shift.endHour);
      return;
    }
    if (isDayIndexPast(d)) {
      showToast('🔒 Không thể đăng ký hoặc chỉnh sửa lịch của ngày đã qua.');
      return;
    }
    if (!state.activeMemberId) {
      openModal('memberModal');
      return;
    }
    applyPersonalShiftPaint(d, shift);
  });
}

export function applyPersonalSlotPaint(dayIndex, hour) {
  if (isDayIndexPast(dayIndex)) {
    showToast('🔒 Không thể đăng ký hoặc chỉnh sửa lịch của ngày đã qua.');
    return;
  }
  const me = getActiveMember();
  if (!me) return;

  const weekKey = getWeekKey();
  if (!state.room.schedules[weekKey]) state.room.schedules[weekKey] = {};
  if (!state.room.schedules[weekKey][me.id]) state.room.schedules[weekKey][me.id] = {};

  const mySched = state.room.schedules[weekKey][me.id];
  const key = `${dayIndex}-${hour}`;
  const noteInput = document.getElementById('busyNoteInput').value.trim() || 'Bận';

  if (state.paintMode === 'busy') {
    if (mySched[key] && mySched[key].status === 'busy') {
      delete mySched[key];
    } else {
      mySched[key] = { status: 'busy', note: noteInput };
    }
  } else {
    delete mySched[key];
  }

  renderUnifiedScheduleSection();
  syncMyScheduleToServer();
}

export function syncMyScheduleToServer() {
  const me = getActiveMember();
  if (!me) return;

  const indicator = document.getElementById('syncStatusText');
  if (indicator) indicator.textContent = 'Đang lưu...';

  clearTimeout(syncDebounce);
  syncDebounce = setTimeout(() => {
    const weekKey = getWeekKey();
    const mySched = getMemberSchedule(me.id);
    emitUpdateSchedule(state.roomCode, me.id, weekKey, mySched);
    if (indicator) indicator.textContent = 'Đã đồng bộ ✓';
  }, 150);
}

export function renderBestContinuousSlots(targetMembers = getFilteredMembers()) {
  const container = document.getElementById('bestSlotsList');
  if (!container) return;
  container.innerHTML = '';

  const allBlocks = computeBestFreeBlocks(targetMembers);
  const multiHourBlocks = allBlocks.filter(b => b.duration >= 2).slice(0, 6);
  const displayBlocks = multiHourBlocks.length > 0 ? multiHourBlocks : allBlocks.slice(0, 5);

  if (displayBlocks.length === 0) {
    const isWholeWeekPast = [0, 1, 2, 3, 4, 5, 6].every(d => isDayIndexPast(d));
    container.innerHTML = isWholeWeekPast
      ? `<span class="best-slots-empty">Tuần này đã qua — hãy chuyển sang tuần hiện tại hoặc tuần sau để đăng ký lịch.</span>`
      : `<span class="best-slots-empty">Chưa có khung giờ nào cả nhóm cùng trống trong các ngày tới — thử lọc bớt thành viên.</span>`;
    return;
  }

  displayBlocks.forEach(b => {
    const card = document.createElement('div');
    card.className = 'best-slot-card';
    card.title = 'Gửi đề xuất giờ trống này sang Nhắn Tin Nhóm';
    card.innerHTML = `
      <div class="best-slot-info">
        <strong>${b.dayName} · ${formatHourRange(b.startHour, b.endHour)}</strong>
        <span>${b.duration}h liền · ${b.memberCount}/${b.memberCount} người</span>
      </div>
      <button type="button" class="btn-propose-mini">Chốt</button>
    `;
    card.addEventListener('click', () => {
      openSlotInspector(b.dayIndex, b.startHour, b.endHour);
    });
    container.appendChild(card);
  });
}

export function openSlotInspector(dayIndex, hour, suggestedEndHour = null) {
  const endHour = suggestedEndHour || Math.min(END_HOUR, hour + 1);
  state.inspectedSlot = { dayIndex, hour, endHour };
  const isPast = isDayIndexPast(dayIndex);
  const targetMembers = getFilteredMembers();

  let info;
  if (endHour > hour + 1) {
    const weekSched = getWeekSchedules();
    const freeMembers = [];
    const busyMembers = [];
    targetMembers.forEach(m => {
      const mSched = weekSched[m.id] || {};
      const busyHours = [];
      for (let h = hour; h < endHour; h++) {
        const entry = mSched[`${dayIndex}-${h}`];
        if (entry && entry.status === 'busy') {
          busyHours.push({ hour: h, note: entry.note || 'Bận' });
        }
      }
      if (busyHours.length === 0) {
        freeMembers.push(m);
      } else {
        const distinctNotes = Array.from(new Set(busyHours.map(e => e.note)));
        busyMembers.push({
          member: m,
          note: `${distinctNotes.join(', ')} (${busyHours.length}/${endHour - hour}h)`
        });
      }
    });
    info = {
      total: targetMembers.length,
      freeCount: freeMembers.length,
      busyCount: busyMembers.length,
      freeMembers,
      busyMembers
    };
  } else {
    info = getSlotAvailability(dayIndex, hour, targetMembers);
  }

  const dateObj = addDays(state.currentWeekMonday, dayIndex);
  const rangeTitle = endHour > hour + 1 ? formatHourRange(hour, endHour) : formatHourRange(hour);
  document.getElementById('slotModalTitle').textContent = `${DAY_NAMES[dayIndex]} (${formatShortDM(dateObj)}) • ${rangeTitle}`;

  const banner = document.getElementById('slotModalSummaryBanner');
  if (isPast) {
    banner.style.background = '#f1f5f9';
    banner.style.color = '#475569';
    banner.textContent = `🔒 Ngày này đã qua — chỉ có thể xem lại lịch, không thể đăng ký hoặc đề xuất giờ hẹn.`;
  } else if (info.freeCount === info.total && info.total > 0) {
    banner.style.background = '#d1fae5';
    banner.style.color = '#065f46';
    banner.textContent = `✨ Cả ${info.freeCount}/${info.total} thành viên đều đang trống vào khung giờ này!`;
  } else if (info.freeCount > 0) {
    banner.style.background = '#fef3c7';
    banner.style.color = '#92400e';
    banner.textContent = `⚡ ${info.freeCount}/${info.total} người trống lịch • ${info.busyCount} người bận làm việc.`;
  } else {
    banner.style.background = '#fee2e2';
    banner.style.color = '#991b1b';
    banner.textContent = `🔴 Tất cả thành viên đều đã đăng ký làm việc vào giờ này.`;
  }

  const proposeBox = document.querySelector('#slotDetailModal .slot-propose-box');
  const toggleSlotBtn = document.getElementById('btnToggleMySlotInModal');
  const sendProposalBtn = document.getElementById('btnSendSlotProposal');
  if (proposeBox) proposeBox.classList.toggle('hidden', isPast);
  if (toggleSlotBtn) toggleSlotBtn.classList.toggle('hidden', isPast);
  if (sendProposalBtn) sendProposalBtn.classList.toggle('hidden', isPast);

  document.getElementById('slotFreeCount').textContent = info.freeCount;
  document.getElementById('slotBusyCount').textContent = info.busyCount;

  document.getElementById('slotFreeMembersList').innerHTML = info.freeMembers.length
    ? info.freeMembers.map(m => `
        <li class="slot-member-item">
          ${renderAvatarHtml({ avatar: m.avatar, name: m.name, color: m.color, className: 'chip-avatar' })}
          <div>
            <strong>${escapeHtml(m.name)}</strong>
          </div>
        </li>
      `).join('')
    : `<li style="font-size:11.5px;color:#64748b;">Không có thành viên nào trống</li>`;

  document.getElementById('slotBusyMembersList').innerHTML = info.busyMembers.length
    ? info.busyMembers.map(({ member, note }) => `
        <li class="slot-member-item">
          ${renderAvatarHtml({ avatar: member.avatar, name: member.name, color: member.color, className: 'chip-avatar' })}
          <div>
            <strong>${escapeHtml(member.name)}</strong>
            <small style="display:block;color:#dc2626;font-weight:600;">📌 ${escapeHtml(note)}</small>
          </div>
        </li>
      `).join('')
    : `<li style="font-size:11.5px;color:#64748b;">Không có ai bận làm việc</li>`;

  const startSel = document.getElementById('slotProposeStart');
  const endSel = document.getElementById('slotProposeEnd');
  startSel.innerHTML = '';
  endSel.innerHTML = '';

  for (let h = START_HOUR; h < END_HOUR; h++) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = `${String(h).padStart(2, '0')}:00`;
    if (h === hour) opt.selected = true;
    startSel.appendChild(opt);
  }

  const defaultEnd = endHour;
  for (let h = START_HOUR + 1; h <= END_HOUR; h++) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = `${String(h).padStart(2, '0')}:00`;
    if (h === defaultEnd) opt.selected = true;
    endSel.appendChild(opt);
  }

  openModal('slotDetailModal');
}

// ==================== NHẬP KHOẢNG GIỜ BẬN (1 NGÀY / NHIỀU NGÀY LIÊN TIẾP) ====================

function ensureBusyRangeHourSelects() {
  const startSel = document.getElementById('busyRangeStartHour');
  const endSel = document.getElementById('busyRangeEndHour');
  if (!startSel || !endSel || busyRangeHoursInitialized) return;

  startSel.innerHTML = '';
  for (let h = START_HOUR; h < END_HOUR; h++) {
    const opt = document.createElement('option');
    opt.value = String(h);
    opt.textContent = `${String(h).padStart(2, '0')}:00`;
    if (h === 7) opt.selected = true;
    startSel.appendChild(opt);
  }

  endSel.innerHTML = '';
  for (let h = START_HOUR + 1; h <= END_HOUR; h++) {
    const opt = document.createElement('option');
    opt.value = String(h);
    opt.textContent = `${String(h).padStart(2, '0')}:00`;
    if (h === 22) opt.selected = true;
    endSel.appendChild(opt);
  }

  busyRangeHoursInitialized = true;
}

function syncQuickHourChipsHighlight() {
  const startSel = document.getElementById('busyRangeStartHour');
  const endSel = document.getElementById('busyRangeEndHour');
  if (!startSel || !endSel) return;
  const sig = `${startSel.value}-${endSel.value}`;
  document.querySelectorAll('#busyQuickHourChips [data-quick-hours]').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.quickHours === sig);
  });
}

function getMondayDayIdx(dateObj) {
  return (dateObj.getDay() + 6) % 7;
}

function renderBusyRangeQuickDays() {
  const container = document.getElementById('busyRangeQuickDays');
  const labelEl = document.getElementById('busyQuickDaysLabel');
  const startInput = document.getElementById('busyStartDate');
  const endInput = document.getElementById('busyEndDate');
  if (!container || !startInput || !endInput) return;

  container.innerHTML = '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDateKey(today);

  if (busyRangeMode === 'single') {
    const viewingFutureWeek = state.currentWeekMonday && formatDateKey(state.currentWeekMonday) > todayStr;
    if (labelEl) {
      labelEl.textContent = viewingFutureWeek ? 'Chọn nhanh ngày trong tuần đang xem' : 'Chọn nhanh 7 ngày tới';
    }
    const firstQuickDt = viewingFutureWeek ? state.currentWeekMonday : today;
    const tomorrowStr = formatDateKey(addDays(today, 1));

    for (let i = 0; i < 7; i++) {
      const dt = addDays(firstQuickDt, i);
      const key = formatDateKey(dt);
      const dayIdx = getMondayDayIdx(dt);
      const isToday = key === todayStr;
      const isTomorrow = key === tomorrowStr;
      const isActive = startInput.value === key;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `busy-chip ${isActive ? 'active' : ''}`;
      const prefix = isToday ? 'Hôm nay · ' : (isTomorrow ? 'Ngày mai · ' : '');
      btn.textContent = `${prefix}${SHORT_DAY_NAMES[dayIdx]} ${formatShortDM(dt)}`;
      btn.addEventListener('click', () => {
        startInput.value = key;
        if (!endInput.value || endInput.value < key) {
          endInput.value = formatDateKey(addDays(dt, 1));
        }
        renderBusyRangeQuickDays();
        updateBusyRangePreview();
      });
      container.appendChild(btn);
    }

    requestAnimationFrame(() => {
      const activeChip = container.querySelector('.busy-chip.active');
      if (activeChip) {
        container.scrollLeft = Math.max(0, activeChip.offsetLeft - 24);
      }
    });
    return;
  }

  if (labelEl) labelEl.textContent = 'Chọn nhanh chuỗi ngày liên tiếp';
  const baseStart = parseLocalDateKey(startInput.value) || today;
  const clampedStart = formatDateKey(baseStart) < todayStr ? today : baseStart;
  const currentSunday = addDays(getMondayOfDate(today), 6);
  const nextMonday = addDays(getMondayOfDate(today), 7);
  const nextFriday = addDays(nextMonday, 4);

  const presets = [
    { label: '2 ngày liên tiếp', start: clampedStart, end: addDays(clampedStart, 1) },
    { label: '3 ngày liên tiếp', start: clampedStart, end: addDays(clampedStart, 2) },
    { label: '5 ngày liên tiếp', start: clampedStart, end: addDays(clampedStart, 4) },
    { label: '7 ngày liên tiếp', start: clampedStart, end: addDays(clampedStart, 6) }
  ];

  if (formatDateKey(today) < formatDateKey(currentSunday)) {
    presets.push({ label: 'Từ nay hết tuần', start: today, end: currentSunday });
  }
  presets.push({ label: 'T2–T6 tuần sau', start: nextMonday, end: nextFriday });

  presets.forEach(p => {
    const sKey = formatDateKey(p.start);
    const eKey = formatDateKey(p.end);
    const isActive = startInput.value === sKey && endInput.value === eKey;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `busy-chip ${isActive ? 'active' : ''}`;
    btn.textContent = p.label;
    btn.addEventListener('click', () => {
      startInput.value = sKey;
      endInput.value = eKey;
      endInput.min = sKey;
      renderBusyRangeQuickDays();
      updateBusyRangePreview();
    });
    container.appendChild(btn);
  });
}

function validateBusyRangeInputs() {
  const startInput = document.getElementById('busyStartDate');
  const endInput = document.getElementById('busyEndDate');
  const startSel = document.getElementById('busyRangeStartHour');
  const endSel = document.getElementById('busyRangeEndHour');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDateKey(today);

  const startDateStr = startInput ? startInput.value : '';
  const endDateStr = busyRangeMode === 'single' ? startDateStr : (endInput ? endInput.value : '');
  const startDt = parseLocalDateKey(startDateStr);
  const endDt = parseLocalDateKey(endDateStr);
  const startHour = startSel ? parseInt(startSel.value, 10) : 7;
  const endHour = endSel ? parseInt(endSel.value, 10) : 22;

  if (!startDt || !endDt) {
    return { valid: false, error: 'Vui lòng chọn đầy đủ ngày bận.' };
  }
  if (startDateStr < todayStr) {
    return { valid: false, error: '🔒 Không thể đăng ký lịch cho ngày đã qua. Hãy chọn từ hôm nay trở đi.' };
  }
  if (endDateStr < startDateStr) {
    return { valid: false, error: 'Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.' };
  }
  const dayCount = Math.round((endDt.getTime() - startDt.getTime()) / 86400000) + 1;
  if (dayCount > 60) {
    return { valid: false, error: 'Mỗi lần chỉ nhập tối đa 60 ngày liên tiếp để tránh nhầm lẫn.' };
  }
  if (!(startHour >= START_HOUR && endHour <= END_HOUR && startHour < endHour)) {
    return { valid: false, error: 'Giờ kết thúc phải lớn hơn giờ bắt đầu.' };
  }

  return {
    valid: true,
    startDt,
    endDt,
    startDateStr,
    endDateStr,
    dayCount,
    startHour,
    endHour,
    hoursPerDay: endHour - startHour
  };
}

function updateBusyRangePreview() {
  const previewEl = document.getElementById('busyRangePreviewBanner');
  const applyBtn = document.getElementById('btnApplyBusyRange');
  const clearBtn = document.getElementById('btnClearBusyRange');
  if (!previewEl) return;

  const check = validateBusyRangeInputs();
  if (!check.valid) {
    previewEl.classList.add('is-error');
    previewEl.textContent = check.error;
    if (applyBtn) applyBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    return;
  }

  previewEl.classList.remove('is-error');
  if (applyBtn) applyBtn.disabled = false;
  if (clearBtn) clearBtn.disabled = false;

  const { startDt, endDt, dayCount, startHour, endHour, hoursPerDay } = check;
  const sDayName = DAY_NAMES[getMondayDayIdx(startDt)];
  const eDayName = DAY_NAMES[getMondayDayIdx(endDt)];
  const timeText = formatHourRange(startHour, endHour);

  if (dayCount === 1) {
    previewEl.innerHTML = `📌 Đang chọn: <strong>${sDayName} (${formatShortDM(startDt)}/${startDt.getFullYear()})</strong> • khung giờ <strong>${timeText}</strong> (${hoursPerDay} tiếng).`;
  } else {
    previewEl.innerHTML = `📌 Đang chọn: <strong>${dayCount} ngày liên tiếp</strong> (<strong>${sDayName} ${formatShortDM(startDt)} → ${eDayName} ${formatShortDM(endDt)}</strong>) • <strong>${timeText}</strong> mỗi ngày (tổng ${dayCount * hoursPerDay} tiếng).`;
  }
}

export function setBusyRangeMode(mode) {
  busyRangeMode = mode === 'multi' ? 'multi' : 'single';
  const btnSingle = document.getElementById('btnRangeModeSingle');
  const btnMulti = document.getElementById('btnRangeModeMulti');
  const grid = document.getElementById('busyDateInputsGrid');
  const endWrap = document.getElementById('busyEndDateWrap');
  const startLabel = document.getElementById('busyStartDateLabel');
  const startInput = document.getElementById('busyStartDate');
  const endInput = document.getElementById('busyEndDate');

  if (btnSingle) {
    btnSingle.classList.toggle('active', busyRangeMode === 'single');
    btnSingle.setAttribute('aria-selected', String(busyRangeMode === 'single'));
  }
  if (btnMulti) {
    btnMulti.classList.toggle('active', busyRangeMode === 'multi');
    btnMulti.setAttribute('aria-selected', String(busyRangeMode === 'multi'));
  }
  if (grid) grid.dataset.mode = busyRangeMode;
  if (endWrap) endWrap.classList.toggle('hidden', busyRangeMode === 'single');
  if (startLabel) {
    startLabel.textContent = busyRangeMode === 'single' ? 'Ngày bạn bận' : 'Từ ngày';
  }

  if (busyRangeMode === 'multi' && startInput && endInput) {
    const startDt = parseLocalDateKey(startInput.value);
    if (startDt && (!endInput.value || endInput.value <= startInput.value)) {
      endInput.value = formatDateKey(addDays(startDt, 1));
    }
    if (startInput.value) {
      endInput.min = startInput.value;
    }
  }

  renderBusyRangeQuickDays();
  updateBusyRangePreview();
}

export function openBusyRangeModal() {
  if (!state.room) return;
  if (!state.activeMemberId) {
    openModal('memberModal');
    return;
  }

  ensureBusyRangeHourSelects();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDateKey(today);

  let defaultStartDt = today;
  if (typeof state.mobileDayFilter === 'number' && state.mobileDayFilter >= 0 && state.mobileDayFilter <= 6) {
    const zoomedDt = addDays(state.currentWeekMonday, state.mobileDayFilter);
    if (formatDateKey(zoomedDt) >= todayStr) {
      defaultStartDt = zoomedDt;
    }
  } else if (state.currentWeekMonday && formatDateKey(state.currentWeekMonday) > todayStr) {
    defaultStartDt = state.currentWeekMonday;
  }

  const startInput = document.getElementById('busyStartDate');
  const endInput = document.getElementById('busyEndDate');
  const noteInput = document.getElementById('busyRangeNote');
  const toolbarNote = document.getElementById('busyNoteInput');

  const defaultStartStr = formatDateKey(defaultStartDt);
  if (startInput) {
    startInput.min = todayStr;
    startInput.value = defaultStartStr;
  }
  if (endInput) {
    endInput.min = defaultStartStr;
    if (!endInput.value || endInput.value < defaultStartStr) {
      endInput.value = formatDateKey(addDays(defaultStartDt, 1));
    }
  }
  if (noteInput && !noteInput.value && toolbarNote && toolbarNote.value.trim()) {
    noteInput.value = toolbarNote.value.trim();
  }

  syncQuickHourChipsHighlight();
  setBusyRangeMode(busyRangeMode);
  openModal('busyRangeModal');
}

export function initBusyRangeModalEvents({ onAfterApply } = {}) {
  const btnOpen = document.getElementById('btnOpenBusyRangeModal');
  if (btnOpen) {
    btnOpen.addEventListener('click', () => openBusyRangeModal());
  }

  const btnOpenDrawer = document.getElementById('btnOpenBusyRangeFromDrawer');
  if (btnOpenDrawer) {
    btnOpenDrawer.addEventListener('click', () => openBusyRangeModal());
  }

  document.querySelectorAll('[data-range-mode]').forEach(tab => {
    tab.addEventListener('click', () => setBusyRangeMode(tab.dataset.rangeMode));
  });

  const startInput = document.getElementById('busyStartDate');
  const endInput = document.getElementById('busyEndDate');
  if (startInput) {
    startInput.addEventListener('change', () => {
      if (endInput && startInput.value) {
        endInput.min = startInput.value;
        if (endInput.value && endInput.value < startInput.value) {
          endInput.value = startInput.value;
        }
      }
      renderBusyRangeQuickDays();
      updateBusyRangePreview();
    });
  }
  if (endInput) {
    endInput.addEventListener('change', () => {
      renderBusyRangeQuickDays();
      updateBusyRangePreview();
    });
  }

  const startSel = document.getElementById('busyRangeStartHour');
  const endSel = document.getElementById('busyRangeEndHour');
  if (startSel && endSel) {
    startSel.addEventListener('change', () => {
      const s = parseInt(startSel.value, 10);
      const e = parseInt(endSel.value, 10);
      if (e <= s) {
        endSel.value = String(Math.min(END_HOUR, s + 1));
      }
      syncQuickHourChipsHighlight();
      updateBusyRangePreview();
    });
    endSel.addEventListener('change', () => {
      const s = parseInt(startSel.value, 10);
      const e = parseInt(endSel.value, 10);
      if (e <= s) {
        startSel.value = String(Math.max(START_HOUR, e - 1));
      }
      syncQuickHourChipsHighlight();
      updateBusyRangePreview();
    });
  }

  document.querySelectorAll('#busyQuickHourChips [data-quick-hours]').forEach(chip => {
    chip.addEventListener('click', () => {
      ensureBusyRangeHourSelects();
      const [s, e] = chip.dataset.quickHours.split('-').map(Number);
      if (startSel && endSel) {
        startSel.value = String(s);
        endSel.value = String(e);
      }
      syncQuickHourChipsHighlight();
      updateBusyRangePreview();
    });
  });

  const handleApply = (mode) => {
    const me = getActiveMember();
    if (!me || !state.room) return;

    const check = validateBusyRangeInputs();
    if (!check.valid) {
      showToast('⚠️ ' + check.error);
      return;
    }

    const { startDt, endDt, dayCount, startHour, endHour } = check;
    const noteEl = document.getElementById('busyRangeNote');
    const note = (noteEl && noteEl.value.trim()) || 'Bận';
    const dirtyWeeks = {};

    for (let i = 0; i < dayCount; i++) {
      const dt = addDays(startDt, i);
      const mon = getMondayOfDate(dt);
      const wk = formatDateKey(mon);
      const dayIdx = getMondayDayIdx(dt);

      if (!state.room.schedules[wk]) state.room.schedules[wk] = {};
      if (!state.room.schedules[wk][me.id]) state.room.schedules[wk][me.id] = {};
      const mySched = state.room.schedules[wk][me.id];

      for (let h = startHour; h < endHour; h++) {
        const key = `${dayIdx}-${h}`;
        if (mode === 'busy') {
          mySched[key] = { status: 'busy', note };
        } else {
          delete mySched[key];
        }
      }
      dirtyWeeks[wk] = mySched;
    }

    const indicator = document.getElementById('syncStatusText');
    if (indicator) indicator.textContent = 'Đang lưu...';
    clearTimeout(syncDebounce);

    emitUpdateSchedulesBatch(state.roomCode, me.id, dirtyWeeks).finally(() => {
      if (indicator) indicator.textContent = 'Đã đồng bộ ✓';
    });

    state.currentWeekMonday = getMondayOfDate(startDt);
    if (dayCount > 1 && state.mobileDayFilter !== 'all') {
      state.mobileDayFilter = 'all';
    }

    if (typeof onAfterApply === 'function') {
      onAfterApply();
    } else {
      renderUnifiedScheduleSection();
    }

    closeModal('busyRangeModal');

    const timeLabel = formatHourRange(startHour, endHour);
    if (mode === 'busy') {
      if (dayCount === 1) {
        showToast(`✅ Đã lưu giờ bận ${DAY_NAMES[getMondayDayIdx(startDt)]} (${formatShortDM(startDt)} • ${timeLabel})!`);
      } else {
        showToast(`✅ Đã lưu giờ bận cho ${dayCount} ngày liên tiếp (${formatShortDM(startDt)} – ${formatShortDM(endDt)} • ${timeLabel})!`);
      }
    } else {
      if (dayCount === 1) {
        showToast(`✨ Đã đặt lại thành Rảnh vào ${DAY_NAMES[getMondayDayIdx(startDt)]} (${formatShortDM(startDt)} • ${timeLabel}).`);
      } else {
        showToast(`✨ Đã đặt lại thành Rảnh cho ${dayCount} ngày (${formatShortDM(startDt)} – ${formatShortDM(endDt)} • ${timeLabel}).`);
      }
    }
  };

  const applyBtn = document.getElementById('btnApplyBusyRange');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => handleApply('busy'));
  }

  const clearBtn = document.getElementById('btnClearBusyRange');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => handleApply('free'));
  }
}
