import {
  DAY_NAMES,
  SHORT_DAY_NAMES,
  START_HOUR,
  END_HOUR,
  formatDateKey,
  formatShortDM,
  addDays,
  formatHourRange,
  openModal,
  showToast,
  escapeHtml,
  renderAvatarHtml
} from './utils.js';
import {
  state,
  getWeekKey,
  isDayIndexPast,
  getActiveMember,
  getMemberSchedule,
  getFilteredMembers
} from './state.js';
import { getSlotAvailability, computeBestFreeBlocks } from './availability.js';
import { emitUpdateSchedule } from './socket.js';

let syncDebounce = null;
let didInitialTodayScroll = false;

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
    return Boolean(e && e.status === 'busy' && (e.note || 'Ca làm việc') === noteStr);
  };
  const isAllFreeAt = (d, h) => {
    if (h < START_HOUR || isMyBusyAt(d, h)) return false;
    const i = getSlotAvailability(d, h, targetMembers);
    return i.total > 0 && i.freeCount === i.total;
  };

  for (let h = START_HOUR; h < END_HOUR; h++) {
    const tr = document.createElement('tr');
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
      const myBusyNote = isMyBusy ? (myEntry.note || 'Ca làm việc') : '';

      const info = getSlotAvailability(d, h, targetMembers);
      const isAllFree = info.total > 0 && info.freeCount === info.total;
      if (!isPast && isAllFree) allFreeSlotsCount++;

      const td = document.createElement('td');
      td.dataset.day = String(d);
      const classes = ['unified-slot-cell'];
      let isBlockCont = false;
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

      bindSlotCellInteractions(td, d, h);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
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
  const noteInput = document.getElementById('busyNoteInput').value.trim() || 'Ca làm việc';

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
  state.inspectedSlot = { dayIndex, hour };
  const isPast = isDayIndexPast(dayIndex);
  const targetMembers = getFilteredMembers();
  const info = getSlotAvailability(dayIndex, hour, targetMembers);

  const dateObj = addDays(state.currentWeekMonday, dayIndex);
  document.getElementById('slotModalTitle').textContent = `${DAY_NAMES[dayIndex]} (${formatShortDM(dateObj)}) • ${formatHourRange(hour)}`;

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

  const defaultEnd = suggestedEndHour || Math.min(END_HOUR, hour + 2);
  for (let h = START_HOUR + 1; h <= END_HOUR; h++) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = `${String(h).padStart(2, '0')}:00`;
    if (h === defaultEnd) opt.selected = true;
    endSel.appendChild(opt);
  }

  openModal('slotDetailModal');
}
