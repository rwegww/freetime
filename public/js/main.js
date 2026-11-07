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
  slugifyUsernameSuggestion,
  renderAvatarHtml,
  applyAvatarElement
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
  isRememberMePreferred,
  saveRememberedAccount,
  getRememberedAccount,
  clearRememberedAccount,
  fetchAuthConfig,
  fetchPublicInvitePreview,
  registerAccount,
  loginAccount,
  loginWithGoogle,
  fetchCurrentUser,
  updateMyProfile,
  fetchMyGroups,
  createNewGroup,
  previewGroupByCode,
  joinGroupByCode,
  leaveGroupByCode,
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

let authConfigCache = null;
let googleScriptPromise = null;
let pendingSwitchInvite = null;

document.addEventListener('DOMContentLoaded', () => {
  bootstrapApp();
});

async function preloadAuthConfig() {
  try {
    authConfigCache = await fetchAuthConfig();
    if (authConfigCache && authConfigCache.googleClientId) {
      loadGoogleGisScript().catch(() => {});
    }
  } catch (_) {}
  return authConfigCache;
}

function loadGoogleGisScript() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    return Promise.resolve();
  }
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleScriptPromise = null;
      reject(new Error('Không thể tải thư viện đăng nhập Google.'));
    };
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

async function completeAuthSuccess(data, rememberMe = true, welcomeToast = '') {
  saveToken(data.token, { rememberMe });
  if (rememberMe !== false) {
    saveRememberedAccount(data.user);
  } else {
    clearRememberedAccount();
  }
  authenticateSocket(data.token);
  await handlePostAuth(data.user, data.rooms);
  if (welcomeToast) showToast(welcomeToast);
}

async function bootstrapApp() {
  const params = new URLSearchParams(window.location.search);
  const pathJoinMatch = window.location.pathname.match(/^\/join\/([A-Za-z0-9_-]{3,32})\/?$/i);
  const detectedInviteRaw =
    (pathJoinMatch && pathJoinMatch[1]) ||
    params.get('room') ||
    localStorage.getItem('freetime_pending_oauth_room') ||
    '';
  localStorage.removeItem('freetime_pending_oauth_room');
  if (detectedInviteRaw && detectedInviteRaw.trim()) {
    state.pendingInviteCode = extractInviteCode(detectedInviteRaw);
  }

  bindAuthEvents();
  bindOnboardingEvents();
  bindWorkspaceEvents();
  initCloudTourEvents();
  initSocketListeners();

  // Handle Supabase Google OAuth redirect callback (#access_token=... or #error=...)
  if (window.location.hash && (window.location.hash.includes('access_token=') || window.location.hash.includes('error='))) {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const supaAccessToken = hashParams.get('access_token');
    const oauthErrDesc = hashParams.get('error_description') || hashParams.get('error');
    window.history.replaceState({}, '', window.location.pathname + window.location.search);
    if (supaAccessToken) {
      const rememberOAuth = localStorage.getItem('freetime_oauth_remember') !== '0';
      try {
        const data = await loginWithGoogle({
          supabaseAccessToken: supaAccessToken,
          rememberMe: rememberOAuth
        });
        await completeAuthSuccess(
          data,
          rememberOAuth,
          `👋 Xin chào ${data.user.name}!`
        );
        return;
      } catch (err) {
        setAppStage('auth');
        showAuthError(err.message);
        return;
      }
    }
    if (oauthErrDesc) {
      setAppStage('auth');
      showAuthError('Đăng nhập Google chưa hoàn tất: ' + oauthErrDesc.replace(/\+/g, ' '));
      return;
    }
  }

  const savedToken = getSavedToken();
  if (!savedToken) {
    setAppStage('auth');
    preloadAuthConfig();
    return;
  }

  authenticateSocket(savedToken);
  try {
    const data = await fetchCurrentUser();
    if (isRememberMePreferred() && data.token) {
      saveToken(data.token, { rememberMe: true });
      saveRememberedAccount(data.user);
    }
    await handlePostAuth(data.user, data.rooms);
  } catch (err) {
    saveToken('');
    authenticateSocket('');
    setAppStage('auth');
    preloadAuthConfig();
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
    renderSavedAccountCard();
  } else if (stage === 'onboarding') {
    renderOnboardingHeader();
  }
}

function renderSavedAccountCard() {
  const card = document.getElementById('savedAccountCard');
  const avatarEl = document.getElementById('savedAccountAvatar');
  const nameEl = document.getElementById('savedAccountName');
  const userEl = document.getElementById('savedAccountUsername');
  const loginUserEl = document.getElementById('loginUsername');
  const loginRemEl = document.getElementById('loginRememberMe');
  const regRemEl = document.getElementById('regRememberMe');

  const preferRemember = isRememberMePreferred();
  if (loginRemEl) loginRemEl.checked = preferRemember;
  if (regRemEl) regRemEl.checked = preferRemember;

  if (!card) return;
  const saved = getRememberedAccount();
  if (!saved) {
    card.classList.add('hidden');
    return;
  }

  if (avatarEl) {
    applyAvatarElement(avatarEl, {
      avatar: saved.avatar,
      name: saved.name || saved.username,
      color: saved.color || '#6366f1'
    });
  }
  if (nameEl) nameEl.textContent = saved.name || saved.username;
  if (userEl) {
    userEl.textContent =
      saved.authProvider === 'google'
        ? `Google • ${saved.username}`
        : `@${saved.username}`;
  }
  if (loginUserEl && !loginUserEl.value && saved.authProvider !== 'google') {
    loginUserEl.value = saved.username;
  }
  card.classList.remove('hidden');
}

function renderAuthInviteBanner() {
  const banner = document.getElementById('authInviteBanner');
  if (!banner) return;
  const code = state.pendingInviteCode;
  if (!code) {
    banner.classList.add('hidden');
    return;
  }

  banner.innerHTML = `🔗 Bạn đang mở link mời của nhóm <strong>#${escapeHtml(code)}</strong>. Hãy đăng nhập hoặc tạo tài khoản để tham gia ngay!`;
  banner.classList.remove('hidden');

  fetchPublicInvitePreview(code)
    .then((info) => {
      if (state.pendingInviteCode !== code) return;
      if (info && info.found) {
        banner.innerHTML = `🔗 Bạn được mời vào nhóm <strong>${escapeHtml(info.name)}</strong> (#${escapeHtml(info.code)} • ${info.memberCount} thành viên). Hãy đăng nhập hoặc tạo tài khoản để tham gia ngay!`;
      } else if (info && info.valid && !info.found) {
        banner.innerHTML = `⚠️ Link mời <strong>#${escapeHtml(code)}</strong> không tồn tại hoặc đã đổi mã. Bạn vẫn có thể đăng nhập bình thường.`;
      }
    })
    .catch(() => {});
}

function renderOnboardingHeader() {
  const user = state.currentUser;
  if (!user) return;
  const avatarEl = document.getElementById('onboardingUserAvatar');
  const nameEl = document.getElementById('onboardingUserName');
  const userEl = document.getElementById('onboardingUserUsername');

  if (avatarEl) {
    applyAvatarElement(avatarEl, {
      avatar: user.avatar,
      name: user.name,
      color: user.color || '#6366f1'
    });
  }
  if (nameEl) {
    nameEl.textContent = `Xin chào, ${user.name}! 👋`;
  }
  if (userEl) {
    userEl.textContent = `@${user.username}`;
  }
  syncOnboardingCloudTip(user.id);
}

async function openSingleGroupConflictPrompt(currentRoom, targetCode) {
  pendingSwitchInvite = {
    currentCode: currentRoom.code,
    currentName: currentRoom.name,
    targetCode
  };

  const currentLabelEl = document.getElementById('conflictCurrentGroupLabel');
  const targetLabelEl = document.getElementById('conflictTargetGroupLabel');
  if (currentLabelEl) {
    currentLabelEl.textContent = `${currentRoom.name} (#${currentRoom.code})`;
  }
  if (targetLabelEl) {
    targetLabelEl.textContent = `#${targetCode}`;
  }

  fetchPublicInvitePreview(targetCode)
    .then((info) => {
      if (info && info.found && targetLabelEl) {
        targetLabelEl.textContent = `${info.name} (#${info.code})`;
      }
    })
    .catch(() => {});

  openModal('singleGroupConflictModal');
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
      if (
        err.status === 409 &&
        err.data &&
        err.data.code === 'ALREADY_IN_GROUP' &&
        err.data.currentRoom
      ) {
        await openGroupWorkspace(err.data.currentRoom.code, { deferAutoTour: true });
        await openSingleGroupConflictPrompt(err.data.currentRoom, inviteCode);
        return;
      }
      showToast('⚠️ ' + err.message);
      window.history.replaceState({}, '', '/');
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

  window.history.replaceState({}, '', '/');
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

  const newUrl = `/?room=${encodeURIComponent(room.code)}`;
  window.history.replaceState({}, '', newUrl);

  state.selectedFilterMemberIds = new Set(room.members.map(m => m.id));
  setAppStage('workspace');
  emitJoinRoom(state.roomCode, state.activeMemberId);
  renderAll();

  if (!deferAutoTour) {
    scheduleAutoCloudTour();
  }
}

async function openGroupWorkspace(code, { deferAutoTour = false } = {}) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) {
    setAppStage('onboarding');
    return;
  }

  try {
    const data = await fetchGroupDetail(cleanCode);
    enterLoadedGroup(data.room, data.member, data.onlineMemberIds, { deferAutoTour });
  } catch (err) {
    if (err.status === 403 && err.data && err.data.canJoin) {
      try {
        const joined = await joinGroupByCode(cleanCode);
        enterLoadedGroup(joined.room, joined.member, joined.onlineMemberIds, { deferAutoTour });
        showToast(`🎉 Đã tham gia nhóm "${joined.room.name}" (#${joined.room.code})!`);
        return;
      } catch (joinErr) {
        showToast('⚠️ ' + joinErr.message);
      }
    } else if (err.status === 403 && err.data && err.data.currentRoom) {
      await openGroupWorkspace(err.data.currentRoom.code, { deferAutoTour: true });
      await openSingleGroupConflictPrompt(err.data.currentRoom, cleanCode);
      return;
    } else {
      showToast('⚠️ ' + err.message);
    }

    if (!state.room) {
      window.history.replaceState({}, '', '/');
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
  pendingSwitchInvite = null;
  updateUnreadBadge();

  window.history.replaceState({}, '', '/');
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
  const nowYear = new Date().getFullYear();
  const suffixYear = sun.getFullYear() !== nowYear ? `/${sun.getFullYear()}` : '';
  document.getElementById('currentWeekRange').textContent = `${formatShortDM(mon)} - ${formatShortDM(sun)}${suffixYear}`;

  const me = getActiveMember() || state.currentUser;
  const avatarEl = document.getElementById('activeUserAvatar');
  const nameEl = document.getElementById('activeUserName');
  const roleEl = document.getElementById('activeUserRole');
  const toolbarMemberEl = document.getElementById('toolbarMemberName');

  if (me) {
    applyAvatarElement(avatarEl, {
      avatar: me.avatar,
      name: me.name,
      color: me.color || '#6366f1'
    });
    nameEl.textContent = me.name;
    roleEl.textContent = state.currentUser ? `@${state.currentUser.username}` : 'Tài khoản';
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

    if (profileAvatar) {
      applyAvatarElement(profileAvatar, {
        avatar: user.avatar,
        name: user.name,
        color: user.color || '#6366f1'
      });
    }
    if (profileName) profileName.textContent = user.name;
    if (profileUsername) profileUsername.textContent = `@${user.username}`;
    if (nameInput && document.activeElement !== nameInput) nameInput.value = user.name || '';
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
      ${renderAvatarHtml({ avatar: m.avatar, name: m.name, color: m.color, className: 'avatar-circle' })}
      <div style="overflow:hidden;flex:1;min-width:0;">
        <strong style="display:block;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(m.name)}${isMe ? ' (Bạn)' : ''}
        </strong>
        <small style="color:#64748b;font-size:11px;display:flex;align-items:center;gap:5px;">
          <span class="status-dot ${isOnline ? 'online' : ''}" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${isOnline ? '#10b981' : '#cbd5e1'}"></span>
          ${isOnline ? 'Đang online' : 'Thành viên nhóm'}
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
  return `${window.location.origin}/join/${encodeURIComponent(state.roomCode)}`;
}

function buildFriendlyInviteMessage() {
  const roomName = state.room ? state.room.name : 'Nhóm chung';
  const code = state.roomCode;
  const url = getCurrentInviteUrl();
  return `👋 Mình mời bạn vào nhóm "${roomName}" trên FreeTime để xem lịch rảnh & nhắn tin chung nhé!\n👉 Bấm vào link này để vào thẳng nhóm: ${url}\n🔑 Hoặc nhập mã nhóm: ${code}`;
}

async function triggerShareOrCopyInvite(btnEl, defaultLabel) {
  const inviteMsg = buildFriendlyInviteMessage();
  const shareUrl = getCurrentInviteUrl();
  const canUseNativeShare =
    typeof navigator.share === 'function' &&
    window.matchMedia &&
    window.matchMedia('(pointer: coarse)').matches;

  if (canUseNativeShare) {
    try {
      await navigator.share({
        title: state.room ? `Mời vào nhóm ${state.room.name}` : 'Mời vào nhóm FreeTime',
        text: inviteMsg,
        url: shareUrl
      });
      showToast('📲 Đã mở bảng chia sẻ link nhóm!');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  try {
    await copyTextSafe(inviteMsg);
    if (btnEl) {
      btnEl.classList.add('copied-ok');
      btnEl.textContent = '✓ Đã chép lời mời & link! Mở Zalo / Messenger để Dán gửi';
      if (defaultLabel) {
        setTimeout(() => {
          btnEl.classList.remove('copied-ok');
          btnEl.textContent = defaultLabel;
        }, 3200);
      }
    }
    showToast('✅ Đã chép sẵn link mời! Hãy mở Zalo / Messenger và Dán gửi bạn bè nhé.');
  } catch (_) {
    showToast('⚠️ Không thể sao chép tự động.');
  }
}

function openInviteCelebrationModal({ isNewlyCreated = false } = {}) {
  if (!state.roomCode) return;
  const tagEl = document.getElementById('inviteModalTag');
  const headingEl = document.getElementById('inviteModalHeading');
  const subtextEl = document.getElementById('inviteModalSubtext');
  const nameEl = document.getElementById('createdGroupNameDisplay');
  const codeEl = document.getElementById('createdGroupCodeBig');
  const shareInputEl = document.getElementById('createdShareLinkInput');
  const copyLinkBtn = document.getElementById('btnCopyCreatedLink');
  const shareBtn = document.getElementById('btnShareInviteMessage');

  if (tagEl) {
    tagEl.textContent = isNewlyCreated ? 'TẠO NHÓM THÀNH CÔNG' : 'CHIA SẺ LINK NHÓM';
  }
  if (headingEl) {
    headingEl.textContent = isNewlyCreated
      ? '🎉 Tạo nhóm thành công!'
      : '🔗 Chia sẻ link mời nhóm';
  }
  if (subtextEl) {
    subtextEl.textContent =
      'Gửi link bên dưới cho bạn bè — ai bấm vào link sẽ vào thẳng nhóm của bạn:';
  }
  if (nameEl) {
    nameEl.textContent = state.room ? state.room.name : `Nhóm #${state.roomCode}`;
  }
  if (codeEl) {
    codeEl.textContent = state.roomCode;
  }
  if (shareInputEl) {
    shareInputEl.value = getCurrentInviteUrl();
  }
  if (copyLinkBtn) {
    copyLinkBtn.classList.remove('copied-ok');
    copyLinkBtn.textContent = 'Sao chép link';
  }
  if (shareBtn) {
    shareBtn.classList.remove('copied-ok');
    shareBtn.textContent = '📲 Chia sẻ qua Zalo / Messenger';
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
            ? `📋 Đã nhận mã nhóm từ link: #${extracted}`
            : '📋 Đã dán nội dung từ bộ nhớ tạm.'
        );
        return;
      }
    } catch (_) {
      // Browser denied clipboard read permission -> guide user gently
    }
  }
  inputEl.focus();
  showToast('👆 Hãy nhấn giữ vào ô nhập rồi chọn "Dán" (hoặc bấm Ctrl + V) nhé!');
}

function openRoomSwitcherModal() {
  if (!state.room || !state.roomCode) return;

  const groupNameEl = document.getElementById('modalCurrentGroupName');
  const groupMetaEl = document.getElementById('modalCurrentGroupMeta');
  const codeDisplay = document.getElementById('currentInviteCodeDisplay');
  const shareInputEl = document.getElementById('modalShareLinkInput');
  const copyLinkBtn = document.getElementById('btnCopyModalLink');
  const membersListEl = document.getElementById('roomModalMembersList');
  const leaveConfirmNameEl = document.getElementById('leaveConfirmGroupName');
  const btnShowLeave = document.getElementById('btnShowLeaveConfirm');
  const leaveConfirmBox = document.getElementById('leaveGroupConfirmBox');

  if (groupNameEl) groupNameEl.textContent = state.room.name;
  if (groupMetaEl) {
    groupMetaEl.textContent = `${state.room.members.length} thành viên • Đang tham gia`;
  }
  if (codeDisplay) codeDisplay.textContent = `#${state.roomCode}`;
  if (shareInputEl) shareInputEl.value = getCurrentInviteUrl();
  if (copyLinkBtn) {
    copyLinkBtn.classList.remove('copied-ok');
    copyLinkBtn.textContent = 'Sao chép';
  }
  if (leaveConfirmNameEl) {
    leaveConfirmNameEl.textContent = `"${state.room.name}" (#${state.roomCode})`;
  }
  if (btnShowLeave) btnShowLeave.classList.remove('hidden');
  if (leaveConfirmBox) leaveConfirmBox.classList.add('hidden');

  if (membersListEl) {
    membersListEl.innerHTML = '';
    state.room.members.forEach((m) => {
      const isMe = m.id === state.activeMemberId;
      const chip = document.createElement('span');
      chip.className = `room-member-mini-chip ${isMe ? 'is-me' : ''}`;
      chip.innerHTML = `
        ${renderAvatarHtml({ avatar: m.avatar, name: m.name, color: m.color, className: 'mini-av' })}
        <span>${escapeHtml(m.name)}${isMe ? ' (Bạn)' : ''}</span>
      `;
      membersListEl.appendChild(chip);
    });
  }

  openModal('roomModal');
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

function getActiveRememberMeChoice() {
  const isRegister = !document.getElementById('registerForm').classList.contains('hidden');
  const checkbox = document.getElementById(isRegister ? 'regRememberMe' : 'loginRememberMe');
  return checkbox ? Boolean(checkbox.checked) : true;
}

async function triggerGoogleSignIn(loginHint = '') {
  showAuthError('');
  const googleBtn = document.getElementById('btnGoogleAuth');
  const googleLabel = document.getElementById('btnGoogleAuthLabel');
  const rememberMe = getActiveRememberMeChoice();

  if (googleBtn) googleBtn.disabled = true;
  if (googleLabel) googleLabel.textContent = 'Đang kết nối Google...';

  try {
    const hasConfigured =
      authConfigCache && (authConfigCache.googleClientId || authConfigCache.supabaseGoogleEnabled);
    const cfg = hasConfigured ? authConfigCache : await fetchAuthConfig();
    authConfigCache = cfg;

    // Path 1: Google Identity Services OAuth2 Popup (GOOGLE_CLIENT_ID)
    if (cfg && cfg.googleClientId) {
      await loadGoogleGisScript();
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cfg.googleClientId,
        scope: 'openid email profile',
        prompt: 'select_account',
        hint: loginHint || undefined,
        callback: async (tokenResp) => {
          if (!tokenResp || tokenResp.error || !tokenResp.access_token) {
            if (googleBtn) googleBtn.disabled = false;
            if (googleLabel) googleLabel.textContent = 'Tiếp tục với Google';
            return;
          }
          try {
            const data = await loginWithGoogle({
              accessToken: tokenResp.access_token,
              rememberMe
            });
            await completeAuthSuccess(
              data,
              rememberMe,
              `👋 Xin chào ${data.user.name}!`
            );
          } catch (err) {
            showAuthError(err.message);
          } finally {
            if (googleBtn) googleBtn.disabled = false;
            if (googleLabel) googleLabel.textContent = 'Tiếp tục với Google';
          }
        },
        error_callback: () => {
          if (googleBtn) googleBtn.disabled = false;
          if (googleLabel) googleLabel.textContent = 'Tiếp tục với Google';
        }
      });

      tokenClient.requestAccessToken();
      return;
    }

    // Path 2: Supabase Google OAuth Redirect
    if (cfg && cfg.supabaseGoogleEnabled && cfg.supabaseUrl) {
      localStorage.setItem('freetime_oauth_remember', rememberMe ? '1' : '0');
      if (state.pendingInviteCode) {
        localStorage.setItem('freetime_pending_oauth_room', state.pendingInviteCode);
      }
      const redirectTo =
        window.location.pathname === '/'
          ? window.location.origin
          : `${window.location.origin}${window.location.pathname}`;
      window.location.href = `${cfg.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
      return;
    }

    // Path 3: Guide user to turn on Google OAuth in 1 minute
    const originEl = document.getElementById('googleOriginDisplay');
    if (originEl) originEl.textContent = window.location.origin;
    openModal('googleSetupModal');
  } catch (err) {
    showAuthError(err.message);
  } finally {
    if (googleBtn) googleBtn.disabled = false;
    if (googleLabel) googleLabel.textContent = 'Tiếp tục với Google';
  }
}

function bindAuthEvents() {
  document.getElementById('tabAuthLogin').addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tabAuthRegister').addEventListener('click', () => switchAuthTab('register'));

  const btnSwitchReg = document.getElementById('btnSwitchToRegister');
  if (btnSwitchReg) btnSwitchReg.addEventListener('click', () => switchAuthTab('register'));
  const btnSwitchLogin = document.getElementById('btnSwitchToLogin');
  if (btnSwitchLogin) btnSwitchLogin.addEventListener('click', () => switchAuthTab('login'));

  // Sync Remember-Me checkboxes between Login & Register tabs
  const loginRemEl = document.getElementById('loginRememberMe');
  const regRemEl = document.getElementById('regRememberMe');
  if (loginRemEl && regRemEl) {
    loginRemEl.addEventListener('change', () => {
      regRemEl.checked = loginRemEl.checked;
    });
    regRemEl.addEventListener('change', () => {
      loginRemEl.checked = regRemEl.checked;
    });
  }

  // Google Sign-In button + Setup Modal copy button
  const btnGoogleAuth = document.getElementById('btnGoogleAuth');
  if (btnGoogleAuth) {
    btnGoogleAuth.addEventListener('click', () => {
      const saved = getRememberedAccount();
      const hint = saved && saved.authProvider === 'google' ? saved.username : '';
      triggerGoogleSignIn(hint);
    });
  }

  const btnCopyGoogleOrigin = document.getElementById('btnCopyGoogleOrigin');
  if (btnCopyGoogleOrigin) {
    btnCopyGoogleOrigin.addEventListener('click', () => {
      copyTextSafe(window.location.origin)
        .then(() => showToast('📋 Đã sao chép URL trang web!'))
        .catch(() => showToast('⚠️ Không thể sao chép tự động.'));
    });
  }

  // Saved Account Quick Card actions
  const btnUseSaved = document.getElementById('btnUseSavedAccount');
  if (btnUseSaved) {
    btnUseSaved.addEventListener('click', () => {
      const saved = getRememberedAccount();
      if (!saved) return;
      switchAuthTab('login');
      if (saved.authProvider === 'google') {
        triggerGoogleSignIn(saved.username);
        return;
      }
      const loginUserEl = document.getElementById('loginUsername');
      const loginPwEl = document.getElementById('loginPassword');
      if (loginUserEl) loginUserEl.value = saved.username;
      if (loginPwEl) loginPwEl.focus();
    });
  }

  const btnForgetSaved = document.getElementById('btnForgetSavedAccount');
  if (btnForgetSaved) {
    btnForgetSaved.addEventListener('click', () => {
      clearRememberedAccount();
      const loginUserEl = document.getElementById('loginUsername');
      if (loginUserEl) loginUserEl.value = '';
      renderSavedAccountCard();
      showToast('Đã xóa tài khoản ghi nhớ.');
    });
  }

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
        regHelperEl.innerHTML = `<button type="button" class="btn-username-suggest warn-fix" data-apply-username="${escapeHtml(fixed)}">👆 Viết liền không dấu — Bấm để đổi thành: <strong>${escapeHtml(fixed)}</strong></button>`;
        regHelperEl.classList.remove('hidden');
        return;
      }
    }

    if (!rawUser) {
      const suggested = slugifyUsernameSuggestion(rawName);
      if (suggested.length >= 3) {
        regHelperEl.innerHTML = `<button type="button" class="btn-username-suggest" data-apply-username="${escapeHtml(suggested)}">💡 Gợi ý tên đăng nhập: <strong>${escapeHtml(suggested)}</strong> — Bấm để chọn</button>`;
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

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showAuthError('');
    const username = normalizeFriendlyUsernameInput(document.getElementById('loginUsername').value);
    const password = document.getElementById('loginPassword').value;
    const rememberMe = loginRemEl ? loginRemEl.checked : true;
    const submitBtn = document.getElementById('btnLoginSubmit');

    submitBtn.disabled = true;
    const prevText = submitBtn.textContent;
    submitBtn.textContent = 'Đang đăng nhập...';

    try {
      const data = await loginAccount({ username, password, rememberMe });
      document.getElementById('loginPassword').value = '';
      await completeAuthSuccess(
        data,
        rememberMe,
        `👋 Chào mừng trở lại, ${data.user.name}!`
      );
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
    const password = document.getElementById('regPassword').value;
    const rememberMe = regRemEl ? regRemEl.checked : true;
    const submitBtn = document.getElementById('btnRegisterSubmit');

    submitBtn.disabled = true;
    const prevText = submitBtn.textContent;
    submitBtn.textContent = 'Đang tạo tài khoản...';

    try {
      const data = await registerAccount({
        name,
        username,
        password,
        rememberMe
      });
      document.getElementById('registerForm').reset();
      if (regRemEl) regRemEl.checked = rememberMe;
      if (regHelperEl) {
        regHelperEl.innerHTML = '';
        regHelperEl.classList.add('hidden');
      }
      await completeAuthSuccess(
        data,
        rememberMe,
        `🎉 Đăng ký thành công! Xin chào ${data.user.name}.`
      );
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

  const setScheduleDrawer = (drawer) => {
    const nextInsights = drawer === 'insights' ? !state.insightsOpen : false;
    const nextTools = drawer === 'tools' ? !state.mobileToolsOpen : false;
    state.insightsOpen = nextInsights;
    state.mobileToolsOpen = nextTools;

    const card = document.getElementById('scheduleSectionCard');
    if (card) {
      card.classList.toggle('insights-open', nextInsights);
      card.classList.toggle('mobile-tools-open', nextTools);
    }

    const btnInsights = document.getElementById('btnToggleInsights');
    if (btnInsights) {
      btnInsights.classList.toggle('active', nextInsights);
      btnInsights.setAttribute('aria-expanded', String(nextInsights));
    }

    const btnTools = document.getElementById('btnToggleMobileTools');
    if (btnTools) {
      btnTools.classList.toggle('active', nextTools);
      btnTools.setAttribute('aria-expanded', String(nextTools));
    }
  };

  const btnInsights = document.getElementById('btnToggleInsights');
  if (btnInsights) {
    btnInsights.addEventListener('click', () => setScheduleDrawer('insights'));
  }

  const btnMobileTools = document.getElementById('btnToggleMobileTools');
  if (btnMobileTools) {
    btnMobileTools.addEventListener('click', () => setScheduleDrawer('tools'));
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

  ['createdShareLinkInput', 'modalShareLinkInput'].forEach(inputId => {
    const el = document.getElementById(inputId);
    if (el) {
      el.addEventListener('click', () => el.select());
    }
  });

  document.getElementById('btnCopyModalCode').addEventListener('click', () => {
    copyTextSafe(state.roomCode)
      .then(() => showToast(`📋 Đã sao chép mã nhóm: ${state.roomCode}`))
      .catch(() => showToast('⚠️ Không thể sao chép tự động.'));
  });

  const btnCopyModalLink = document.getElementById('btnCopyModalLink');
  if (btnCopyModalLink) {
    btnCopyModalLink.addEventListener('click', () => {
      copyTextSafe(getCurrentInviteUrl())
        .then(() => {
          btnCopyModalLink.classList.add('copied-ok');
          btnCopyModalLink.textContent = '✓ Đã chép';
          setTimeout(() => {
            btnCopyModalLink.classList.remove('copied-ok');
            btnCopyModalLink.textContent = 'Sao chép';
          }, 2400);
          showToast(`🔗 Đã sao chép link mời nhóm #${state.roomCode}!`);
        })
        .catch(() => showToast('⚠️ Không thể sao chép tự động.'));
    });
  }

  const btnCopyModalFullInvite = document.getElementById('btnCopyModalFullInvite');
  if (btnCopyModalFullInvite) {
    btnCopyModalFullInvite.addEventListener('click', () => {
      triggerShareOrCopyInvite(btnCopyModalFullInvite, '📲 Gửi lời mời Zalo / Messenger');
    });
  }

  const btnShareInviteMessage = document.getElementById('btnShareInviteMessage');
  if (btnShareInviteMessage) {
    btnShareInviteMessage.addEventListener('click', () => {
      triggerShareOrCopyInvite(btnShareInviteMessage, '📲 Chia sẻ qua Zalo / Messenger');
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
        .then(() => {
          btnCopyCreatedLink.classList.add('copied-ok');
          btnCopyCreatedLink.textContent = '✓ Đã chép!';
          setTimeout(() => {
            btnCopyCreatedLink.classList.remove('copied-ok');
            btnCopyCreatedLink.textContent = 'Sao chép link';
          }, 2400);
          showToast(`🔗 Đã sao chép link mời nhóm #${state.roomCode}!`);
        })
        .catch(() => showToast('⚠️ Không thể sao chép tự động.'));
    });
  }

  // Leave current group (enables user to leave their 1 group and create/join another)
  const btnShowLeaveConfirm = document.getElementById('btnShowLeaveConfirm');
  const leaveGroupConfirmBox = document.getElementById('leaveGroupConfirmBox');
  const btnCancelLeaveGroup = document.getElementById('btnCancelLeaveGroup');
  const btnConfirmLeaveGroup = document.getElementById('btnConfirmLeaveGroup');

  if (btnShowLeaveConfirm && leaveGroupConfirmBox) {
    btnShowLeaveConfirm.addEventListener('click', () => {
      btnShowLeaveConfirm.classList.add('hidden');
      leaveGroupConfirmBox.classList.remove('hidden');
    });
  }
  if (btnCancelLeaveGroup && btnShowLeaveConfirm && leaveGroupConfirmBox) {
    btnCancelLeaveGroup.addEventListener('click', () => {
      leaveGroupConfirmBox.classList.add('hidden');
      btnShowLeaveConfirm.classList.remove('hidden');
    });
  }
  if (btnConfirmLeaveGroup) {
    btnConfirmLeaveGroup.addEventListener('click', async () => {
      if (!state.roomCode) return;
      btnConfirmLeaveGroup.disabled = true;
      const prevLabel = btnConfirmLeaveGroup.textContent;
      btnConfirmLeaveGroup.textContent = 'Đang rời nhóm...';
      try {
        const res = await leaveGroupByCode(state.roomCode);
        if (state.currentUser) {
          localStorage.removeItem(`freetime_last_room_${state.currentUser.id}`);
        }
        state.myRooms = res.rooms || [];
        state.room = null;
        state.roomCode = '';
        state.activeMemberId = null;
        state.onlineMemberIds = [];
        closeModal('roomModal');

        if (state.myRooms.length > 0) {
          await openGroupWorkspace(state.myRooms[0].code);
        } else {
          window.history.replaceState({}, '', '/');
          setAppStage('onboarding');
        }
        showToast(`👋 Đã rời nhóm "${res.leftName || res.leftCode}". Bạn có thể tạo hoặc vào nhóm mới!`);
      } catch (err) {
        showToast('⚠️ ' + err.message);
      } finally {
        btnConfirmLeaveGroup.disabled = false;
        btnConfirmLeaveGroup.textContent = prevLabel;
      }
    });
  }

  // Switch group confirmation when clicking a share link while already in another group
  const btnConfirmSwitchGroup = document.getElementById('btnConfirmSwitchGroup');
  if (btnConfirmSwitchGroup) {
    btnConfirmSwitchGroup.addEventListener('click', async () => {
      if (!pendingSwitchInvite) return;
      const { currentCode, targetCode } = pendingSwitchInvite;
      btnConfirmSwitchGroup.disabled = true;
      const prevLabel = btnConfirmSwitchGroup.textContent;
      btnConfirmSwitchGroup.textContent = 'Đang chuyển nhóm...';
      try {
        await leaveGroupByCode(currentCode);
        const joined = await joinGroupByCode(targetCode);
        pendingSwitchInvite = null;
        closeModal('singleGroupConflictModal');
        enterLoadedGroup(joined.room, joined.member, joined.onlineMemberIds);
        showToast(`🎉 Đã chuyển sang nhóm "${joined.room.name}" (#${joined.room.code})!`);
      } catch (err) {
        showToast('⚠️ ' + err.message);
      } finally {
        btnConfirmSwitchGroup.disabled = false;
        btnConfirmSwitchGroup.textContent = prevLabel;
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

  document.getElementById('btnLogout').addEventListener('click', performLogout);

  document.getElementById('profileUpdateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('profileNameInput').value.trim();
    if (!name) return;

    try {
      const data = await updateMyProfile({ name });
      state.currentUser = data.user;
      if (isRememberMePreferred()) {
        saveRememberedAccount(data.user);
      }
      state.myRooms = data.rooms || state.myRooms;
      if (state.roomCode) {
        await openGroupWorkspace(state.roomCode);
      }
      closeModal('memberModal');
      showToast('✅ Đã cập nhật tên hiển thị!');
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
  chatInput.addEventListener('focus', () => {
    if (window.innerWidth <= 960) {
      setTimeout(() => {
        const container = document.getElementById('chatMessagesList');
        if (container) container.scrollTop = container.scrollHeight;
      }, 250);
    }
  });
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
