import {
  DAY_NAMES,
  START_HOUR,
  END_HOUR,
  getMondayOfDate,
  formatShortDM,
  addDays,
  formatHourRange,
  openModal,
  closeModal,
  closeAllModals,
  showToast,
  escapeHtml,
  extractInviteCode,
  slugifyUsernameSuggestion
} from './utils.js';
import {
  state,
  getWeekKey,
  isDayIndexPast,
  getActiveMember,
  getMemberSchedule,
  getFilteredMembers
} from './state.js';
import {
  getSavedToken,
  saveToken,
  registerAccount,
  loginAccount,
  fetchCurrentUser,
  updateMyProfile,
  fetchMyGroups,
  createNewGroup,
  previewGroupByCode,
  joinGroupByCode,
  fetchGroupDetail
} from './api.js';
import { computeBestFreeBlocks } from './availability.js';
import {
  authenticateSocket,
  emitJoinRoom,
  emitSendMessage,
  emitTyping,
  bindSocketEvents
} from './socket.js';
import {
  renderMemberFilterChips,
  renderUnifiedScheduleSection,
  syncMyScheduleToServer,
  openSlotInspector
} from './calendar.js';
import {
  renderChatHeader,
  renderChatMessages,
  createMessageElement
} from './chat.js';
import {
  initCloudTourEvents,
  startCloudTour,
  stopCloudTour,
  syncOnboardingCloudTip,
  dismissOnboardingCloudTip
} from './tour.js';

document.addEventListener('DOMContentLoaded', () => {
  bootstrapApp();
});

async function bootstrapApp() {
  const params = new URLSearchParams(window.location.search);
  const urlRoom = params.get('room');
  if (urlRoom && urlRoom.trim()) {
    state.pendingInviteCode = extractInviteCode(urlRoom);
  }

  bindAuthEvents();
  bindOnboardingEvents();
  bindWorkspaceEvents();
  initCloudTourEvents();
  initSocketListeners();

  const savedToken = getSavedToken();
  if (!savedToken) {
    setAppStage('auth');
    return;
  }

  authenticateSocket(savedToken);
  try {
    const data = await fetchCurrentUser();
    await handlePostAuth(data.user, data.rooms);
  } catch (err) {
    saveToken('');
    authenticateSocket('');
    setAppStage('auth');
  }
}

function setAppStage(stage) {
  document.body.dataset.appStage = stage;
  if (stage !== 'workspace') {
    closeAllModals();
    stopCloudTour({ markSeen: false });
  }

  if (stage === 'auth') {
    renderAuthInviteBanner();
  } else if (stage === 'onboarding') {
    renderOnboardingHeader();
  }
}

function renderAuthInviteBanner() {
  const banner = document.getElementById('authInviteBanner');
  if (!banner) return;
  if (state.pendingInviteCode) {
    banner.innerHTML = `🔗 Bạn đang mở link mời của nhóm <strong>#${escapeHtml(state.pendingInviteCode)}</strong>. Hãy đăng nhập hoặc tạo tài khoản mới để vào thẳng cuộc trò chuyện chung!`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function renderOnboardingHeader() {
  const user = state.currentUser;
  if (!user) return;
  const avatarEl = document.getElementById('onboardingUserAvatar');
  const nameEl = document.getElementById('onboardingUserName');
  const userEl = document.getElementById('onboardingUserUsername');

  if (avatarEl) {
    avatarEl.textContent = user.avatar || 'TV';
    avatarEl.style.backgroundColor = user.color || '#6366f1';
  }
  if (nameEl) {
    nameEl.textContent = `Xin chào, ${user.name}! 👋`;
  }
  if (userEl) {
    userEl.textContent = `@${user.username}`;
  }
  syncOnboardingCloudTip(user.id);
}

async function handlePostAuth(user, rooms = []) {
  state.currentUser = user;
  state.myRooms = Array.isArray(rooms) ? rooms : [];
  state.profileColor = user.color || '#6366f1';
  showAuthError('');

  if (state.pendingInviteCode) {
    const inviteCode = state.pendingInviteCode;
    state.pendingInviteCode = '';
    try {
      const joined = await joinGroupByCode(inviteCode);
      enterLoadedGroup(joined.room, joined.member, joined.onlineMemberIds);
      if (joined.isNew) {
        showToast(`🎉 Đã tham gia nhóm "${joined.room.name}" (#${joined.room.code})!`);
      }
      return;
    } catch (err) {
      showToast('⚠️ ' + err.message);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  if (state.myRooms.length > 0) {
    const lastCode = localStorage.getItem(`freetime_last_room_${user.id}`) || '';
    const targetCode = state.myRooms.some(r => r.code === lastCode)
      ? lastCode
      : state.myRooms[0].code;
    await openGroupWorkspace(targetCode);
    return;
  }

  window.history.replaceState({}, '', window.location.pathname);
  setAppStage('onboarding');
}

function scheduleAutoCloudTour() {
  if (!state.currentUser || !state.currentUser.id) return;
  setTimeout(() => {
    const anyModalOpen = Boolean(document.querySelector('.modal-backdrop:not(.hidden)'));
    if (anyModalOpen || document.body.dataset.appStage !== 'workspace') return;
    startCloudTour({
      userId: state.currentUser.id,
      force: false,
      onBeforeStart: () => {
        if (window.innerWidth <= 960) switchMobileTab('schedule');
      }
    });
  }, 260);
}

function enterLoadedGroup(room, member, onlineMemberIds = [], { deferAutoTour = false } = {}) {
  state.roomCode = room.code;
  state.room = room;
  state.activeMemberId = member ? member.id : null;
  state.onlineMemberIds = onlineMemberIds || [];
  state.unreadChatCount = 0;
  updateUnreadBadge();

  if (state.currentUser) {
    localStorage.setItem(`freetime_last_room_${state.currentUser.id}`, room.code);
  }

  const newUrl = `${window.location.pathname}?room=${encodeURIComponent(room.code)}`;
  window.history.replaceState({}, '', newUrl);

  state.selectedFilterMemberIds = new Set(room.members.map(m => m.id));
  setAppStage('workspace');
  emitJoinRoom(state.roomCode, state.activeMemberId);
  renderAll();

  if (!deferAutoTour) {
    scheduleAutoCloudTour();
  }
}

async function openGroupWorkspace(code) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) {
    setAppStage('onboarding');
    return;
  }

  try {
    const data = await fetchGroupDetail(cleanCode);
    enterLoadedGroup(data.room, data.member, data.onlineMemberIds);
  } catch (err) {
    if (err.status === 403 && err.data && err.data.canJoin) {
      try {
        const joined = await joinGroupByCode(cleanCode);
        enterLoadedGroup(joined.room, joined.member, joined.onlineMemberIds);
        showToast(`🎉 Đã tham gia nhóm "${joined.room.name}" (#${joined.room.code})!`);
        return;
      } catch (joinErr) {
        showToast('⚠️ ' + joinErr.message);
      }
    } else {
      showToast('⚠️ ' + err.message);
    }

    if (!state.room) {
      window.history.replaceState({}, '', window.location.pathname);
      setAppStage('onboarding');
    }
  }
}

function performLogout() {
  saveToken('');
  authenticateSocket('');
  state.currentUser = null;
  state.myRooms = [];
  state.roomCode = '';
  state.room = null;
  state.activeMemberId = null;
  state.onlineMemberIds = [];
  state.unreadChatCount = 0;
  state.pendingInviteCode = '';
  updateUnreadBadge();

  window.history.replaceState({}, '', window.location.pathname);
  setAppStage('auth');
  showToast('Đã đăng xuất khỏi tài khoản.');
}

function renderAll() {
  if (!state.room) return;
  renderHeader();
  renderMemberFilterChips();
  renderUnifiedScheduleSection();
  renderChatHeader();
  renderChatMessages();
  renderMemberModalList();
}

function renderHeader() {
  document.getElementById('headerRoomCode').textContent = state.room.code;
  document.getElementById('headerRoomName').textContent = state.room.name;

  const mon = state.currentWeekMonday;
  const sun = addDays(mon, 6);
  const thisMonday = getMondayOfDate(new Date());
  const diffWeeks = Math.round((mon - thisMonday) / (7 * 86400000));

  let weekTitle = 'Tuần hiện tại';
  if (diffWeeks === -1) weekTitle = 'Tuần trước';
  else if (diffWeeks === 1) weekTitle = 'Tuần sau';
  else if (diffWeeks < -1) weekTitle = `${Math.abs(diffWeeks)} tuần trước`;
  else if (diffWeeks > 1) weekTitle = `${diffWeeks} tuần sau`;

  document.getElementById('currentWeekLabel').textContent = weekTitle;
  document.getElementById('currentWeekRange').textContent = `${formatShortDM(mon)} - ${formatShortDM(sun)}/${sun.getFullYear()}`;

  const me = getActiveMember() || state.currentUser;
  const avatarEl = document.getElementById('activeUserAvatar');
  const nameEl = document.getElementById('activeUserName');
  const roleEl = document.getElementById('activeUserRole');
  const toolbarMemberEl = document.getElementById('toolbarMemberName');

  if (me) {
    avatarEl.textContent = me.avatar || 'TV';
    avatarEl.style.backgroundColor = me.color || '#6366f1';
    nameEl.textContent = me.name;
    roleEl.textContent = `${me.role || 'Thành viên'} • Tài khoản`;
    if (toolbarMemberEl) toolbarMemberEl.textContent = me.name;
  }
}

function renderMemberModalList() {
  const user = state.currentUser;
  if (user) {
    const profileAvatar = document.getElementById('modalProfileAvatar');
    const profileName = document.getElementById('modalProfileName');
    const profileUsername = document.getElementById('accountUsernameDisplay');
    const nameInput = document.getElementById('profileNameInput');
    const roleInput = document.getElementById('profileRoleInput');

    if (profileAvatar) {
      profileAvatar.textContent = user.avatar || 'TV';
      profileAvatar.style.backgroundColor = user.color || '#6366f1';
    }
    if (profileName) profileName.textContent = user.name;
    if (profileUsername) profileUsername.textContent = `@${user.username}`;
    if (nameInput && document.activeElement !== nameInput) nameInput.value = user.name || '';
    if (roleInput && document.activeElement !== roleInput) roleInput.value = user.role || '';

    state.profileColor = user.color || state.profileColor || '#6366f1';
    document.querySelectorAll('#memberColorPicker .color-swatch').forEach(sw => {
      sw.classList.toggle('selected', sw.dataset.color === state.profileColor);
    });
  }

  const grid = document.getElementById('existingMembersSelectGrid');
  if (!grid || !state.room) return;
  grid.innerHTML = '';

  const onlineSet = new Set(state.onlineMemberIds || []);
  if (state.activeMemberId) onlineSet.add(state.activeMemberId);

  state.room.members.forEach(m => {
    const isMe = m.id === state.activeMemberId;
    const isOnline = onlineSet.has(m.id);
    const item = document.createElement('div');
    item.className = `member-select-btn ${isMe ? 'active' : ''}`;
    item.style.cursor = 'default';
    item.innerHTML = `
      <span class="avatar-circle" style="background:${m.color}">${escapeHtml(m.avatar)}</span>
      <div style="overflow:hidden;flex:1;min-width:0;">
        <strong style="display:block;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(m.name)}${isMe ? ' (Bạn)' : ''}
        </strong>
        <small style="color:#64748b;font-size:11px;display:flex;align-items:center;gap:5px;">
          <span class="status-dot ${isOnline ? 'online' : ''}" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${isOnline ? '#10b981' : '#cbd5e1'}"></span>
          ${escapeHtml(m.role || 'Thành viên')}
        </small>
      </div>
    `;
    grid.appendChild(item);
  });
}

function setPaintMode(mode) {
  state.paintMode = mode;
  document.querySelectorAll('.mode-pill[data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  const table = document.getElementById('unifiedScheduleTable');
  if (table) table.dataset.paintMode = mode;
}

function switchMobileTab(tab) {
  state.activeMobileTab = tab;
  document.body.dataset.mobileTab = tab;
  document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (tab === 'chat') {
    state.unreadChatCount = 0;
    updateUnreadBadge();
    requestAnimationFrame(() => {
      const container = document.getElementById('chatMessagesList');
      if (container) container.scrollTop = container.scrollHeight;
    });
  }
}

function updateUnreadBadge() {
  const badge = document.getElementById('mobileChatUnreadBadge');
  if (!badge) return;
  if (state.unreadChatCount > 0) {
    badge.textContent = state.unreadChatCount > 9 ? '9+' : String(state.unreadChatCount);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function copyTextSafe(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {
      // Fall back to execCommand('copy') for WebViews / unfocused frames
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) {
    throw new Error('Copy command rejected');
  }
}

function getCurrentInviteUrl() {
  return `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(state.roomCode)}`;
}

function buildFriendlyInviteMessage() {
  const roomName = state.room ? state.room.name : 'Nhóm chung';
  const code = state.roomCode;
  const url = getCurrentInviteUrl();
  return `👋 Mình mời bạn vào nhóm "${roomName}" trên FreeTime để xem lịch rảnh & nhắn tin chung nhé!\n👉 Bấm vào link này để vào thẳng nhóm: ${url}\n🔑 Hoặc nhập mã nhóm: ${code}`;
}

function openInviteCelebrationModal({ isNewlyCreated = false } = {}) {
  if (!state.roomCode) return;
  const tagEl = document.getElementById('inviteModalTag');
  const headingEl = document.getElementById('inviteModalHeading');
  const subtextEl = document.getElementById('inviteModalSubtext');
  const nameEl = document.getElementById('createdGroupNameDisplay');
  const codeEl = document.getElementById('createdGroupCodeBig');
  const shareBtn = document.getElementById('btnShareInviteMessage');

  if (tagEl) {
    tagEl.textContent = isNewlyCreated ? 'MÃ NHÓM CỦA BẠN' : 'MỜI BẠN BÈ';
  }
  if (headingEl) {
    headingEl.textContent = isNewlyCreated
      ? '🎉 Tạo nhóm thành công!'
      : '👋 Mời bạn vào nhóm';
  }
  if (subtextEl) {
    subtextEl.textContent = 'Gửi mã hoặc link bên dưới cho bạn bè để cùng vào nhóm:';
  }
  if (nameEl) {
    nameEl.textContent = state.room ? state.room.name : `Nhóm #${state.roomCode}`;
  }
  if (codeEl) {
    codeEl.textContent = state.roomCode;
  }
  if (shareBtn) {
    shareBtn.classList.remove('copied-ok');
    shareBtn.textContent = '💬 Gửi lời mời qua Zalo / Messenger';
  }

  openModal('groupCreatedModal');
}

async function pasteCodeIntoInput(inputEl, onAfterPaste) {
  if (!inputEl) return;
  if (navigator.clipboard && navigator.clipboard.readText) {
    try {
      const rawClip = await navigator.clipboard.readText();
      if (rawClip && rawClip.trim()) {
        const extracted = extractInviteCode(rawClip);
        inputEl.value = extracted || rawClip.trim();
        if (onAfterPaste) onAfterPaste(inputEl.value);
        showToast(
          extracted
            ? `📋 Đã dán mã nhóm: #${extracted}`
            : '📋 Đã dán nội dung từ bộ nhớ tạm.'
        );
        return;
      }
    } catch (_) {
      // Browser denied clipboard read permission -> guide user gently
    }
  }
  inputEl.focus();
  showToast('👆 Hãy nhấn giữ vào ô nhập mã rồi chọn "Dán" (hoặc bấm Ctrl + V) nhé!');
}

async function openRoomSwitcherModal() {
  const codeDisplay = document.getElementById('currentInviteCodeDisplay');
  if (codeDisplay && state.roomCode) {
    codeDisplay.textContent = `#${state.roomCode}`;
  }

  openModal('roomModal');

  try {
    const rooms = await fetchMyGroups();
    state.myRooms = rooms;
    const listEl = document.getElementById('existingRoomsList');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (rooms.length === 0) {
      listEl.innerHTML = `<div style="font-size:12px;color:#64748b;padding:8px 4px;">Bạn chưa tham gia nhóm nào.</div>`;
      return;
    }

    rooms.forEach(r => {
      const isCurrent = r.code === state.roomCode;
      const item = document.createElement('div');
      item.className = `room-item-btn ${isCurrent ? 'active-room' : ''}`;
      item.innerHTML = `
        <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <strong style="color:#4f46e5">[#${escapeHtml(r.code)}]</strong>
          <span style="font-weight:600;margin-left:6px;">${escapeHtml(r.name)}</span>
        </div>
        <span style="font-size:11px;color:#64748b;flex-shrink:0;margin-left:8px;">
          ${r.memberCount} thành viên${r.onlineCount ? ` • ${r.onlineCount} online` : ''}
        </span>
      `;
      item.addEventListener('click', () => {
        closeModal('roomModal');
        if (r.code !== state.roomCode) {
          openGroupWorkspace(r.code);
        }
      });
      listEl.appendChild(item);
    });
  } catch (err) {
    showToast('⚠️ ' + err.message);
  }
}

// ==================== AUTH EVENTS ====================

function showAuthError(msg) {
  const box = document.getElementById('authErrorBox');
  if (!box) return;
  if (!msg) {
    box.textContent = '';
    box.classList.add('hidden');
  } else {
    box.textContent = msg;
    box.classList.remove('hidden');
  }
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tabAuthLogin').classList.toggle('active', isLogin);
  document.getElementById('tabAuthRegister').classList.toggle('active', !isLogin);
  document.getElementById('loginForm').classList.toggle('hidden', !isLogin);
  document.getElementById('registerForm').classList.toggle('hidden', isLogin);
  showAuthError('');
}

function normalizeFriendlyUsernameInput(rawValue) {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) return '';
  if (/^[a-z0-9._@-]+$/i.test(trimmed)) return trimmed;
  return slugifyUsernameSuggestion(trimmed) || trimmed;
}

function bindAuthEvents() {
  document.getElementById('tabAuthLogin').addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tabAuthRegister').addEventListener('click', () => switchAuthTab('register'));

  const btnSwitchReg = document.getElementById('btnSwitchToRegister');
  if (btnSwitchReg) btnSwitchReg.addEventListener('click', () => switchAuthTab('register'));
  const btnSwitchLogin = document.getElementById('btnSwitchToLogin');
  if (btnSwitchLogin) btnSwitchLogin.addEventListener('click', () => switchAuthTab('login'));

  const regNameInput = document.getElementById('regName');
  const regUserInput = document.getElementById('regUsername');
  const regHelperEl = document.getElementById('regUsernameHelper');

  const renderUsernameHelper = () => {
    if (!regHelperEl || !regNameInput || !regUserInput) return;
    const rawUser = regUserInput.value.trim();
    const rawName = regNameInput.value.trim();

    if (rawUser && !/^[a-z0-9._@-]+$/i.test(rawUser)) {
      const fixed = slugifyUsernameSuggestion(rawUser) || slugifyUsernameSuggestion(rawName);
      if (fixed.length >= 3) {
        regHelperEl.innerHTML = `<button type="button" class="btn-username-suggest warn-fix" data-apply-username="${escapeHtml(fixed)}">👆 Tên đăng nhập viết liền không dấu — Bấm vào đây để đổi thành: <strong>${escapeHtml(fixed)}</strong></button>`;
        regHelperEl.classList.remove('hidden');
        return;
      }
    }

    if (!rawUser) {
      const suggested = slugifyUsernameSuggestion(rawName);
      if (suggested.length >= 3) {
        regHelperEl.innerHTML = `<button type="button" class="btn-username-suggest" data-apply-username="${escapeHtml(suggested)}">💡 Gợi ý dễ nhớ: <strong>${escapeHtml(suggested)}</strong> — Bấm vào đây để dùng luôn</button>`;
        regHelperEl.classList.remove('hidden');
        return;
      }
    }

    regHelperEl.innerHTML = '';
    regHelperEl.classList.add('hidden');
  };

  if (regNameInput) regNameInput.addEventListener('input', renderUsernameHelper);
  if (regUserInput) regUserInput.addEventListener('input', renderUsernameHelper);
  if (regHelperEl) {
    regHelperEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-apply-username]');
      if (!btn || !regUserInput) return;
      regUserInput.value = btn.dataset.applyUsername;
      renderUsernameHelper();
      const pwInput = document.getElementById('regPassword');
      if (pwInput) pwInput.focus();
    });
  }

  document.querySelectorAll('[data-toggle-pw]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePw);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Ẩn' : 'Hiện';
    });
  });

  document.querySelectorAll('#regColorPicker .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#regColorPicker .color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      state.selectedColor = sw.dataset.color;
    });
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showAuthError('');
    const username = normalizeFriendlyUsernameInput(document.getElementById('loginUsername').value);
    const password = document.getElementById('loginPassword').value;
    const submitBtn = document.getElementById('btnLoginSubmit');

    submitBtn.disabled = true;
    const prevText = submitBtn.textContent;
    submitBtn.textContent = 'Đang đăng nhập...';

    try {
      const data = await loginAccount({ username, password });
      saveToken(data.token);
      authenticateSocket(data.token);
      document.getElementById('loginPassword').value = '';
      await handlePostAuth(data.user, data.rooms);
      showToast(`👋 Chào mừng trở lại, ${data.user.name}!`);
    } catch (err) {
      showAuthError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prevText;
    }
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showAuthError('');
    const name = document.getElementById('regName').value.trim();
    const username = normalizeFriendlyUsernameInput(document.getElementById('regUsername').value);
    const role = document.getElementById('regRole').value.trim() || 'Thành viên';
    const password = document.getElementById('regPassword').value;
    const submitBtn = document.getElementById('btnRegisterSubmit');

    submitBtn.disabled = true;
    const prevText = submitBtn.textContent;
    submitBtn.textContent = 'Đang tạo tài khoản...';

    try {
      const data = await registerAccount({
        name,
        username,
        password,
        role,
        color: state.selectedColor
      });
      saveToken(data.token);
      authenticateSocket(data.token);
      document.getElementById('registerForm').reset();
      if (regHelperEl) {
        regHelperEl.innerHTML = '';
        regHelperEl.classList.add('hidden');
      }
      await handlePostAuth(data.user, data.rooms);
      showToast(`🎉 Đăng ký thành công! Xin chào ${data.user.name}.`);
    } catch (err) {
      showAuthError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prevText;
    }
  });
}

// ==================== ONBOARDING EVENTS ====================

function setOnboardingMode(mode) {
  const isCreate = mode !== 'join';
  const btnCreate = document.getElementById('btnChooseCreateGroup');
  const btnJoin = document.getElementById('btnChooseJoinGroup');
  const panelCreate = document.getElementById('onboardingCreatePanel');
  const panelJoin = document.getElementById('onboardingJoinPanel');

  if (btnCreate) {
    btnCreate.classList.toggle('active', isCreate);
    btnCreate.setAttribute('aria-selected', String(isCreate));
  }
  if (btnJoin) {
    btnJoin.classList.toggle('active', !isCreate);
    btnJoin.setAttribute('aria-selected', String(!isCreate));
  }
  if (panelCreate) panelCreate.classList.toggle('hidden', !isCreate);
  if (panelJoin) panelJoin.classList.toggle('hidden', isCreate);

  const activePanel = isCreate ? panelCreate : panelJoin;
  if (window.innerWidth > 768) {
    const focusTarget = document.getElementById(isCreate ? 'onboardGroupName' : 'onboardJoinCode');
    if (focusTarget) focusTarget.focus();
  } else if (activePanel && typeof activePanel.scrollIntoView === 'function') {
    requestAnimationFrame(() => {
      activePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}

function bindOnboardingEvents() {
  document.getElementById('btnOnboardingLogout').addEventListener('click', performLogout);

  const btnDismissCloud = document.getElementById('btnDismissOnboardCloud');
  if (btnDismissCloud) {
    btnDismissCloud.addEventListener('click', () => {
      dismissOnboardingCloudTip(state.currentUser ? state.currentUser.id : '');
    });
  }

  const btnCreateChoice = document.getElementById('btnChooseCreateGroup');
  const btnJoinChoice = document.getElementById('btnChooseJoinGroup');
  if (btnCreateChoice) {
    btnCreateChoice.addEventListener('click', () => {
      dismissOnboardingCloudTip(state.currentUser ? state.currentUser.id : '');
      setOnboardingMode('create');
    });
  }
  if (btnJoinChoice) {
    btnJoinChoice.addEventListener('click', () => {
      dismissOnboardingCloudTip(state.currentUser ? state.currentUser.id : '');
      setOnboardingMode('join');
    });
  }

  document.querySelectorAll('[data-quick-group-name]').forEach(chip => {
    chip.addEventListener('click', () => {
      const nameInput = document.getElementById('onboardGroupName');
      if (!nameInput) return;
      nameInput.value = chip.dataset.quickGroupName;
      document.querySelectorAll('[data-quick-group-name]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      nameInput.focus();
    });
  });

  const joinInput = document.getElementById('onboardJoinCode');
  const previewEl = document.getElementById('onboardJoinPreview');
  let previewTimer = null;
  let previewReqSeq = 0;

  const updateJoinGroupPreview = (rawValue) => {
    if (!previewEl) return;
    clearTimeout(previewTimer);
    const cleanCode = extractInviteCode(rawValue);
    if (!cleanCode || cleanCode.length < 3) {
      previewEl.classList.add('hidden');
      previewEl.innerHTML = '';
      return;
    }

    const mySeq = ++previewReqSeq;
    previewTimer = setTimeout(async () => {
      try {
        const info = await previewGroupByCode(cleanCode);
        if (mySeq !== previewReqSeq) return;
        if (info.found) {
          previewEl.className = 'join-group-preview found';
          previewEl.innerHTML = `✅ Nhóm: <strong>${escapeHtml(info.name)}</strong> (#${escapeHtml(info.code)} • ${info.memberCount} thành viên)`;
        } else if (info.valid) {
          previewEl.className = 'join-group-preview not-found';
          previewEl.innerHTML = `🔎 Chưa tìm thấy nhóm <strong>#${escapeHtml(info.code)}</strong>. Kiểm tra lại mã nhé!`;
        } else {
          previewEl.classList.add('hidden');
        }
      } catch (_) {
        if (mySeq === previewReqSeq) previewEl.classList.add('hidden');
      }
    }, 180);
  };

  if (joinInput) {
    joinInput.addEventListener('input', () => updateJoinGroupPreview(joinInput.value));
    joinInput.addEventListener('paste', (e) => {
      const pasted = e.clipboardData ? e.clipboardData.getData('text') : '';
      if (!pasted) return;
      const extracted = extractInviteCode(pasted);
      if (extracted && extracted !== pasted.trim()) {
        e.preventDefault();
        joinInput.value = extracted;
        updateJoinGroupPreview(extracted);
      }
    });
  }

  const btnPasteJoin = document.getElementById('btnPasteJoinCode');
  if (btnPasteJoin && joinInput) {
    btnPasteJoin.addEventListener('click', () => {
      pasteCodeIntoInput(joinInput, updateJoinGroupPreview);
    });
  }

  document.getElementById('onboardingCreateGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('onboardGroupName').value.trim();
    const code = document.getElementById('onboardGroupCode').value.trim();
    const description = document.getElementById('onboardGroupDesc').value.trim();
    if (!name) return;

    const submitBtn = document.getElementById('btnOnboardCreateSubmit');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const data = await createNewGroup({ name, code, description });
      document.getElementById('onboardingCreateGroupForm').reset();
      document.querySelectorAll('[data-quick-group-name]').forEach(c => c.classList.remove('active'));
      enterLoadedGroup(data.room, data.member, data.onlineMemberIds, { deferAutoTour: true });
      openInviteCelebrationModal({ isNewlyCreated: true });
      showToast(`✨ Đã tạo nhóm "${data.room.name}" (#${data.room.code})!`);
    } catch (err) {
      showToast('⚠️ ' + err.message);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  document.getElementById('onboardingJoinGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawCode = document.getElementById('onboardJoinCode').value.trim();
    const code = extractInviteCode(rawCode) || rawCode;
    if (!code) return;

    const submitBtn = document.getElementById('btnOnboardJoinSubmit');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const data = await joinGroupByCode(code);
      document.getElementById('onboardingJoinGroupForm').reset();
      if (previewEl) previewEl.classList.add('hidden');
      enterLoadedGroup(data.room, data.member, data.onlineMemberIds);
      showToast(`🎉 Đã tham gia nhóm "${data.room.name}" (#${data.room.code})!`);
    } catch (err) {
      showToast('⚠️ ' + err.message);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  document.getElementById('btnTryDemoGroup').addEventListener('click', async () => {
    try {
      const data = await joinGroupByCode('TEAM01');
      enterLoadedGroup(data.room, data.member, data.onlineMemberIds);
      showToast('🎉 Đã vào nhóm trải nghiệm #TEAM01!');
    } catch (err) {
      showToast('⚠️ ' + err.message);
    }
  });
}

// ==================== WORKSPACE EVENTS ====================

function bindWorkspaceEvents() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.add('hidden');
        if (backdrop.id === 'groupCreatedModal') {
          scheduleAutoCloudTour();
        }
      }
    });
  });

  document.getElementById('btnPrevWeek').addEventListener('click', () => {
    state.currentWeekMonday = addDays(state.currentWeekMonday, -7);
    renderAll();
  });
  document.getElementById('btnNextWeek').addEventListener('click', () => {
    state.currentWeekMonday = addDays(state.currentWeekMonday, 7);
    renderAll();
  });
  document.getElementById('btnTodayWeek').addEventListener('click', () => {
    state.currentWeekMonday = getMondayOfDate(new Date());
    renderAll();
  });

  document.getElementById('btnSelectAllMembers').addEventListener('click', () => {
    if (!state.room) return;
    state.selectedFilterMemberIds = new Set(state.room.members.map(m => m.id));
    renderMemberFilterChips();
    renderUnifiedScheduleSection();
  });

  document.querySelectorAll('.mode-pill[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => setPaintMode(btn.dataset.mode));
  });

  const btnMobileTools = document.getElementById('btnToggleMobileTools');
  if (btnMobileTools) {
    btnMobileTools.addEventListener('click', () => {
      state.mobileToolsOpen = !state.mobileToolsOpen;
      const card = document.getElementById('scheduleSectionCard');
      if (card) card.classList.toggle('mobile-tools-open', state.mobileToolsOpen);
      btnMobileTools.classList.toggle('active', state.mobileToolsOpen);
      btnMobileTools.setAttribute('aria-expanded', String(state.mobileToolsOpen));
    });
  }

  document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchMobileTab(btn.dataset.tab));
  });

  document.querySelectorAll('.btn-preset[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const me = getActiveMember();
      if (!me) return;
      const preset = btn.dataset.preset;
      const weekKey = getWeekKey();
      if (!state.room.schedules[weekKey]) state.room.schedules[weekKey] = {};
      if (!state.room.schedules[weekKey][me.id]) state.room.schedules[weekKey][me.id] = {};

      const mySched = state.room.schedules[weekKey][me.id];
      const note = document.getElementById('busyNoteInput').value.trim() || 'Ca làm việc';

      if (preset === 'clear') {
        const editableDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !isDayIndexPast(d));
        if (editableDays.length === 0) {
          showToast('🔒 Tuần này đã qua, không thể xóa hoặc chỉnh sửa lịch.');
          return;
        }
        for (const d of editableDays) {
          for (let h = START_HOUR; h < END_HOUR; h++) {
            delete mySched[`${d}-${h}`];
          }
        }
        showToast(
          editableDays.length === 7
            ? 'Đã xóa lịch làm việc tuần này của bạn.'
            : 'Đã xóa lịch các ngày từ hôm nay đến cuối tuần (giữ nguyên các ngày đã qua).'
        );
      } else {
        const editableWeekdays = [0, 1, 2, 3, 4].filter(d => !isDayIndexPast(d));
        if (editableWeekdays.length === 0) {
          showToast('🔒 Các ngày Thứ 2 – Thứ 6 của tuần này đã qua. Hãy chuyển sang tuần sau để đăng ký!');
          return;
        }
        const dayRangeNote = editableWeekdays.length === 5
          ? 'T2 - T6'
          : editableWeekdays.map(d => DAY_NAMES[d]).join(', ');

        if (preset === 'office') {
          for (const d of editableWeekdays) {
            for (let h = 8; h < 12; h++) mySched[`${d}-${h}`] = { status: 'busy', note: 'Ca sáng hành chính' };
            for (let h = 13; h < 17; h++) mySched[`${d}-${h}`] = { status: 'busy', note: 'Ca chiều hành chính' };
          }
          showToast(`Đã đăng ký lịch Hành chính cho ${dayRangeNote} (8h-12h & 13h-17h).`);
        } else if (preset === 'morning') {
          for (const d of editableWeekdays) {
            for (let h = 8; h < 12; h++) mySched[`${d}-${h}`] = { status: 'busy', note };
          }
          showToast(`Đã đăng ký Ca sáng cho ${dayRangeNote} (8h-12h).`);
        } else if (preset === 'afternoon') {
          for (const d of editableWeekdays) {
            for (let h = 13; h < 17; h++) mySched[`${d}-${h}`] = { status: 'busy', note };
          }
          showToast(`Đã đăng ký Ca chiều cho ${dayRangeNote} (13h-17h).`);
        } else if (preset === 'evening') {
          for (const d of editableWeekdays) {
            for (let h = 18; h < 21; h++) mySched[`${d}-${h}`] = { status: 'busy', note };
          }
          showToast(`Đã đăng ký Ca tối cho ${dayRangeNote} (18h-21h).`);
        }
      }

      renderUnifiedScheduleSection();
      syncMyScheduleToServer();
    });
  });

  const btnReplayCloudTour = document.getElementById('btnReplayCloudTour');
  if (btnReplayCloudTour) {
    btnReplayCloudTour.addEventListener('click', () => {
      startCloudTour({
        userId: state.currentUser ? state.currentUser.id : '',
        force: true,
        onBeforeStart: () => {
          if (window.innerWidth <= 960) switchMobileTab('schedule');
        }
      });
    });
  }

  document.getElementById('btnOpenMemberModal').addEventListener('click', () => {
    renderMemberModalList();
    openModal('memberModal');
  });
  document.getElementById('btnOpenRoomModal').addEventListener('click', openRoomSwitcherModal);

  document.getElementById('btnCopyRoomLink').addEventListener('click', () => {
    openInviteCelebrationModal({ isNewlyCreated: false });
  });

  document.getElementById('btnCopyModalCode').addEventListener('click', () => {
    copyTextSafe(state.roomCode)
      .then(() => showToast(`📋 Đã sao chép mã nhóm: ${state.roomCode}`))
      .catch(() => showToast('⚠️ Không thể sao chép tự động.'));
  });

  document.getElementById('btnCopyModalLink').addEventListener('click', () => {
    copyTextSafe(getCurrentInviteUrl())
      .then(() => showToast(`🔗 Đã sao chép link mời nhóm #${state.roomCode}!`))
      .catch(() => showToast('⚠️ Không thể sao chép tự động.'));
  });

  const btnCopyModalFullInvite = document.getElementById('btnCopyModalFullInvite');
  if (btnCopyModalFullInvite) {
    btnCopyModalFullInvite.addEventListener('click', () => {
      copyTextSafe(buildFriendlyInviteMessage())
        .then(() => showToast('✅ Đã chép lời mời! Hãy mở Zalo / Messenger và Dán gửi bạn bè nhé.'))
        .catch(() => showToast('⚠️ Không thể sao chép tự động.'));
    });
  }

  const btnShareInviteMessage = document.getElementById('btnShareInviteMessage');
  if (btnShareInviteMessage) {
    btnShareInviteMessage.addEventListener('click', async () => {
      const inviteMsg = buildFriendlyInviteMessage();
      const canUseNativeShare =
        typeof navigator.share === 'function' &&
        window.matchMedia &&
        window.matchMedia('(pointer: coarse)').matches;

      if (canUseNativeShare) {
        try {
          await navigator.share({
            title: state.room ? `Mời vào nhóm ${state.room.name}` : 'Mời vào nhóm FreeTime',
            text: inviteMsg
          });
          showToast('📲 Đã mở bảng chia sẻ lời mời!');
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }

      try {
        await copyTextSafe(inviteMsg);
        btnShareInviteMessage.classList.add('copied-ok');
        btnShareInviteMessage.textContent = '✓ Đã chép lời mời! Mở Zalo / Messenger và Dán gửi nhé';
        showToast('✅ Đã chép sẵn lời mời! Hãy mở Zalo / Messenger và Dán (Paste) gửi bạn bè nhé.');
      } catch (_) {
        showToast('⚠️ Không thể sao chép tự động.');
      }
    });
  }

  const btnCopyCreatedCode = document.getElementById('btnCopyCreatedCode');
  if (btnCopyCreatedCode) {
    btnCopyCreatedCode.addEventListener('click', () => {
      copyTextSafe(state.roomCode)
        .then(() => showToast(`📋 Đã sao chép mã nhóm: ${state.roomCode}`))
        .catch(() => showToast('⚠️ Không thể sao chép tự động.'));
    });
  }

  const btnCopyCreatedLink = document.getElementById('btnCopyCreatedLink');
  if (btnCopyCreatedLink) {
    btnCopyCreatedLink.addEventListener('click', () => {
      copyTextSafe(getCurrentInviteUrl())
        .then(() => showToast(`🔗 Đã sao chép link mời nhóm #${state.roomCode}!`))
        .catch(() => showToast('⚠️ Không thể sao chép tự động.'));
    });
  }

  const modalJoinInput = document.getElementById('joinRoomCodeInput');
  const btnPasteModalJoinCode = document.getElementById('btnPasteModalJoinCode');
  if (btnPasteModalJoinCode && modalJoinInput) {
    btnPasteModalJoinCode.addEventListener('click', () => {
      pasteCodeIntoInput(modalJoinInput);
    });
  }
  if (modalJoinInput) {
    modalJoinInput.addEventListener('paste', (e) => {
      const pasted = e.clipboardData ? e.clipboardData.getData('text') : '';
      const extracted = extractInviteCode(pasted);
      if (extracted && extracted !== pasted.trim()) {
        e.preventDefault();
        modalJoinInput.value = extracted;
      }
    });
  }

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.close;
      closeModal(modalId);
      if (modalId === 'groupCreatedModal') {
        scheduleAutoCloudTour();
      }
    });
  });

  document.querySelectorAll('#memberColorPicker .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#memberColorPicker .color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      state.profileColor = sw.dataset.color;
    });
  });

  document.getElementById('btnLogout').addEventListener('click', performLogout);

  document.getElementById('profileUpdateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('profileNameInput').value.trim();
    const role = document.getElementById('profileRoleInput').value.trim() || 'Thành viên';
    if (!name) return;

    try {
      const data = await updateMyProfile({
        name,
        role,
        color: state.profileColor
      });
      state.currentUser = data.user;
      state.myRooms = data.rooms || state.myRooms;
      if (state.roomCode) {
        await openGroupWorkspace(state.roomCode);
      }
      closeModal('memberModal');
      showToast('✅ Đã cập nhật hồ sơ cá nhân!');
    } catch (err) {
      showToast('⚠️ ' + err.message);
    }
  });

  document.getElementById('joinRoomByCodeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawCode = document.getElementById('joinRoomCodeInput').value.trim();
    const code = extractInviteCode(rawCode) || rawCode;
    if (!code) return;

    try {
      const data = await joinGroupByCode(code);
      document.getElementById('joinRoomCodeInput').value = '';
      closeModal('roomModal');
      enterLoadedGroup(data.room, data.member, data.onlineMemberIds);
      showToast(`🎉 Đã vào nhóm "${data.room.name}" (#${data.room.code})!`);
    } catch (err) {
      showToast('⚠️ ' + err.message);
    }
  });

  document.getElementById('createRoomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('newRoomCode').value.trim();
    const name = document.getElementById('newRoomName').value.trim();
    if (!name) return;

    try {
      const data = await createNewGroup({ name, code });
      document.getElementById('newRoomCode').value = '';
      document.getElementById('newRoomName').value = '';
      closeModal('roomModal');
      enterLoadedGroup(data.room, data.member, data.onlineMemberIds, { deferAutoTour: true });
      openInviteCelebrationModal({ isNewlyCreated: true });
      showToast(`✨ Đã tạo nhóm mới "${data.room.name}" (#${data.room.code})!`);
    } catch (err) {
      showToast('⚠️ ' + err.message);
    }
  });

  document.getElementById('btnToggleMySlotInModal').addEventListener('click', () => {
    if (!state.inspectedSlot) return;
    const me = getActiveMember();
    if (!me) return;

    const { dayIndex, hour } = state.inspectedSlot;
    if (isDayIndexPast(dayIndex)) {
      showToast('🔒 Không thể đăng ký hoặc chỉnh sửa lịch của ngày đã qua.');
      return;
    }
    const weekKey = getWeekKey();
    if (!state.room.schedules[weekKey]) state.room.schedules[weekKey] = {};
    if (!state.room.schedules[weekKey][me.id]) state.room.schedules[weekKey][me.id] = {};

    const mySched = state.room.schedules[weekKey][me.id];
    const key = `${dayIndex}-${hour}`;
    if (mySched[key] && mySched[key].status === 'busy') {
      delete mySched[key];
      showToast(`Đã hủy lịch làm việc của bạn vào ${DAY_NAMES[dayIndex]} (${formatHourRange(hour)}).`);
    } else {
      mySched[key] = { status: 'busy', note: 'Ca làm việc' };
      showToast(`Đã đăng ký làm việc vào ${DAY_NAMES[dayIndex]} (${formatHourRange(hour)}).`);
    }

    renderUnifiedScheduleSection();
    syncMyScheduleToServer();
    openSlotInspector(dayIndex, hour);
  });

  document.getElementById('btnSendSlotProposal').addEventListener('click', () => {
    if (!state.inspectedSlot) return;
    const me = getActiveMember();
    if (!me) return;

    const title = document.getElementById('slotProposeTitle').value.trim() || 'Họp / Trao đổi nhóm';
    const startHour = parseInt(document.getElementById('slotProposeStart').value, 10);
    const endHour = Math.max(startHour + 1, parseInt(document.getElementById('slotProposeEnd').value, 10));
    const { dayIndex } = state.inspectedSlot;
    if (isDayIndexPast(dayIndex)) {
      showToast('🔒 Không thể gửi đề xuất giờ hẹn cho ngày đã qua.');
      return;
    }

    emitSendMessage({
      roomCode: state.roomCode,
      memberId: me.id,
      type: 'proposal',
      text: `Đề xuất lịch hẹn vào ${DAY_NAMES[dayIndex]} (${formatHourRange(startHour, endHour)})`,
      proposal: {
        title,
        dayIndex,
        dayName: DAY_NAMES[dayIndex],
        startHour,
        endHour,
        weekKey: getWeekKey(),
        votes: { [me.id]: 'yes' }
      }
    });

    closeModal('slotDetailModal');
    if (window.innerWidth <= 960) {
      switchMobileTab('chat');
    }
    showToast('🚀 Đã gửi đề xuất lịch hẹn vào cuộc trò chuyện nhóm!');
  });

  document.getElementById('btnOpenProposalModal').addEventListener('click', () => {
    if ([0, 1, 2, 3, 4, 5, 6].every(d => isDayIndexPast(d))) {
      state.currentWeekMonday = getMondayOfDate(new Date());
      renderAll();
    }
    const blocks = computeBestFreeBlocks(getFilteredMembers());
    if (blocks.length > 0) {
      openSlotInspector(blocks[0].dayIndex, blocks[0].startHour, blocks[0].endHour);
    } else {
      const firstValidDay = [0, 1, 2, 3, 4, 5, 6].find(d => !isDayIndexPast(d)) ?? 0;
      openSlotInspector(firstValidDay, 14, 16);
    }
  });

  document.getElementById('btnShareMySummary').addEventListener('click', () => {
    const me = getActiveMember();
    if (!me) return;

    const mySched = getMemberSchedule(me.id);
    const busyHours = Object.values(mySched).filter(x => x && x.status === 'busy').length;
    const totalSlots = 7 * (END_HOUR - START_HOUR);
    const freeHours = totalSlots - busyHours;

    emitSendMessage({
      roomCode: state.roomCode,
      memberId: me.id,
      type: 'text',
      text: `📋 Mình đã đăng ký lịch làm việc tuần này (${busyHours}h làm việc, còn trống ${freeHours}h). Mọi người xem khung giờ trống chung nhé!`
    });
  });

  const chatInput = document.getElementById('chatInput');
  chatInput.addEventListener('input', () => {
    if (!state.activeMemberId || !state.roomCode) return;
    emitTyping(state.roomCode, state.activeMemberId, chatInput.value.trim().length > 0);
  });

  document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !state.activeMemberId || !state.roomCode) return;

    emitSendMessage({
      roomCode: state.roomCode,
      memberId: state.activeMemberId,
      type: 'text',
      text
    });

    chatInput.value = '';
    emitTyping(state.roomCode, state.activeMemberId, false);
  });
}

// ==================== SOCKET EVENTS ====================

function initSocketListeners() {
  bindSocketEvents({
    onOnlineUsers(memberIds) {
      state.onlineMemberIds = memberIds || [];
      renderChatHeader();
      renderMemberModalList();
    },
    onRoomUpdated({ room, onlineMemberIds }) {
      if (!room || room.code !== state.roomCode) return;
      state.room = room;
      state.onlineMemberIds = onlineMemberIds || state.onlineMemberIds;
      if (state.currentUser) {
        const myMember = room.members.find(m => m.userId === state.currentUser.id);
        if (myMember) state.activeMemberId = myMember.id;
      }
      room.members.forEach(m => state.selectedFilterMemberIds.add(m.id));
      renderAll();
    },
    onScheduleUpdated({ memberId, memberName, weekKey, schedule }) {
      if (!state.room) return;
      if (!state.room.schedules[weekKey]) state.room.schedules[weekKey] = {};
      state.room.schedules[weekKey][memberId] = schedule;

      renderUnifiedScheduleSection();

      if (memberId !== state.activeMemberId) {
        showToast(`🔄 ${memberName} vừa đăng ký/cập nhật lịch làm việc!`);
      }
    },
    onNewMessage(msg) {
      if (!state.room) return;
      const exists = state.room.messages.some(m => m.id === msg.id);
      if (!exists) {
        state.room.messages.push(msg);
        const container = document.getElementById('chatMessagesList');
        container.appendChild(createMessageElement(msg));
        container.scrollTop = container.scrollHeight;

        if (window.innerWidth <= 960 && state.activeMobileTab !== 'chat' && msg.memberId !== state.activeMemberId) {
          state.unreadChatCount += 1;
          updateUnreadBadge();
        }
      }
    },
    onMessageUpdated(updatedMsg) {
      if (!state.room) return;
      const idx = state.room.messages.findIndex(m => m.id === updatedMsg.id);
      if (idx !== -1) {
        state.room.messages[idx] = updatedMsg;
        const existingEl = document.getElementById(`chat-msg-${updatedMsg.id}`);
        if (existingEl) {
          existingEl.replaceWith(createMessageElement(updatedMsg));
        }
      }
    },
    onUserTyping({ memberId, memberName, isTyping }) {
      if (memberId === state.activeMemberId) return;
      const el = document.getElementById('chatTypingIndicator');
      const txt = document.getElementById('chatTypingText');
      if (isTyping) {
        txt.textContent = `${memberName} đang nhập tin nhắn...`;
        el.classList.remove('hidden');
        clearTimeout(state.typingTimeout);
        state.typingTimeout = setTimeout(() => el.classList.add('hidden'), 3000);
      } else {
        el.classList.add('hidden');
      }
    },
    onReconnect() {
      const token = getSavedToken();
      if (token) authenticateSocket(token);
      if (state.roomCode && state.activeMemberId) {
        emitJoinRoom(state.roomCode, state.activeMemberId);
      }
    }
  });
}
