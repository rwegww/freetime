import {
  formatHourRange,
  openModal,
  showToast,
  escapeHtml,
  renderAvatarHtml,
  applyAvatarElement
} from './utils.js';
import { state } from './state.js';
import { emitVoteProposal } from './socket.js';

let toastDismissTimer = null;

export function renderChatHeader() {
  if (!state.room) return;
  const onlineSet = new Set(state.onlineMemberIds || []);
  if (state.activeMemberId) onlineSet.add(state.activeMemberId);
  const onlineCount = onlineSet.size;
  document.getElementById('chatOnlineBadge').textContent = `${onlineCount}/${state.room.members.length} online`;

  const bar = document.getElementById('chatMembersAvatars');
  bar.innerHTML = state.room.members.map(m => {
    const isOnline = onlineSet.has(m.id);
    const isMe = m.id === state.activeMemberId;
    return `
      <div class="chat-member-pill ${isMe ? 'is-me-pill' : ''}" data-member-info="${m.id}" title="${escapeHtml(m.name)} (${isOnline ? 'Đang online' : 'Offline'})" style="cursor:pointer">
        ${renderAvatarHtml({ avatar: m.avatar, name: m.name, color: m.color, className: 'chip-avatar' })}
        <span>${escapeHtml(m.name)}${isMe ? ' (Bạn)' : ''}</span>
        <span class="status-dot ${isOnline ? 'online' : ''}"></span>
      </div>
    `;
  }).join('');

  bar.querySelectorAll('[data-member-info]').forEach(pill => {
    pill.addEventListener('click', () => {
      const m = state.room.members.find(x => x.id === pill.dataset.memberInfo);
      if (m) {
        const isOnline = onlineSet.has(m.id);
        showToast(`👤 ${m.name} • ${m.role} (${isOnline ? 'Đang online' : 'Ngoại tuyến'})`);
      }
    });
  });
}

export function renderChatMessages() {
  if (!state.room) return;
  const container = document.getElementById('chatMessagesList');
  container.innerHTML = '';

  const messages = state.room.messages || [];
  messages.forEach(msg => {
    container.appendChild(createMessageElement(msg));
  });

  container.scrollTop = container.scrollHeight;
}

export function createMessageElement(msg) {
  if (msg.type === 'system') {
    const div = document.createElement('div');
    div.className = 'chat-system-msg';
    div.id = `chat-msg-${msg.id}`;
    div.textContent = msg.text;
    return div;
  }

  const isMe = msg.memberId === state.activeMemberId;
  const liveMember =
    state.room && Array.isArray(state.room.members)
      ? state.room.members.find(x => x.id === msg.memberId)
      : null;
  const resolvedAvatar = (liveMember && liveMember.avatar) || msg.memberAvatar || 'TV';
  const resolvedColor = (liveMember && liveMember.color) || msg.memberColor || '#4f46e5';
  const resolvedName = (liveMember && liveMember.name) || msg.memberName || 'Thành viên';
  const msgAvatarHtml = renderAvatarHtml({
    avatar: resolvedAvatar,
    name: resolvedName,
    color: resolvedColor,
    className: 'avatar-circle'
  });

  const wrapper = document.createElement('div');
  wrapper.className = `chat-msg-item ${isMe ? 'is-me' : ''}`;
  wrapper.id = `chat-msg-${msg.id}`;

  const timeStr = new Date(msg.createdAt).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  if (msg.type === 'proposal' && msg.proposal) {
    const p = msg.proposal;
    const votes = p.votes || {};
    const yesNames = [];
    const noNames = [];

    Object.entries(votes).forEach(([mId, v]) => {
      const m = state.room.members.find(x => x.id === mId);
      const name = m ? m.name : 'Thành viên';
      if (v === 'yes') yesNames.push(name);
      else if (v === 'no') noNames.push(name);
    });

    const myVote = state.activeMemberId ? votes[state.activeMemberId] : null;

    wrapper.innerHTML = `
      ${msgAvatarHtml}
      <div class="chat-msg-body">
        <div class="chat-msg-meta">
          <strong>${escapeHtml(resolvedName)}</strong>
          <span>${timeStr}</span>
        </div>
        <div class="proposal-card">
          <span class="proposal-header-badge">📅 ĐỀ XUẤT GIỜ HẸN NHÓM</span>
          <div class="proposal-title">${escapeHtml(p.title || 'Họp / Trao đổi nhóm')}</div>
          <div class="proposal-time-box">
            🕒 ${escapeHtml(p.dayName)} • ${formatHourRange(p.startHour, p.endHour)}
          </div>
          <div class="proposal-votes-summary">
            <div>✅ <strong>Đồng ý (${yesNames.length}):</strong> ${yesNames.length ? escapeHtml(yesNames.join(', ')) : 'Chưa có'}</div>
            ${noNames.length ? `<div style="color:#dc2626">❌ <strong>Bận (${noNames.length}):</strong> ${escapeHtml(noNames.join(', '))}</div>` : ''}
          </div>
          <div class="proposal-actions">
            <button class="btn-vote vote-yes ${myVote === 'yes' ? 'active' : ''}" data-vote="yes">👍 Tham gia (${yesNames.length})</button>
            <button class="btn-vote vote-no ${myVote === 'no' ? 'active' : ''}" data-vote="no">❌ Kẹt lịch (${noNames.length})</button>
          </div>
        </div>
      </div>
    `;

    wrapper.querySelectorAll('.btn-vote').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!state.activeMemberId) {
          openModal('memberModal');
          return;
        }
        emitVoteProposal(state.roomCode, msg.id, state.activeMemberId, btn.dataset.vote);
      });
    });

    return wrapper;
  }

  wrapper.innerHTML = `
    ${msgAvatarHtml}
    <div class="chat-msg-body">
      <div class="chat-msg-meta">
        <strong>${escapeHtml(resolvedName)}</strong>
        <span>${timeStr}</span>
      </div>
      <div class="chat-bubble">${escapeHtml(msg.text)}</div>
    </div>
  `;
  return wrapper;
}

// ==================== THÔNG BÁO TIN NHẮN MỚI NỔI & CUỘN TRONG CHAT ====================

export function showChatIncomingToast(msg, onOpenChat) {
  const toastEl = document.getElementById('chatIncomingToast');
  const avatarEl = document.getElementById('chatToastAvatar');
  const senderEl = document.getElementById('chatToastSender');
  const snippetEl = document.getElementById('chatToastSnippet');
  if (!toastEl) return;

  clearTimeout(toastDismissTimer);

  const liveMember =
    state.room && Array.isArray(state.room.members)
      ? state.room.members.find(x => x.id === msg.memberId)
      : null;
  const senderName = (liveMember && liveMember.name) || msg.memberName || 'Thành viên';
  const avatar = (liveMember && liveMember.avatar) || msg.memberAvatar || 'TV';
  const color = (liveMember && liveMember.color) || msg.memberColor || '#6366f1';

  if (avatarEl) {
    applyAvatarElement(avatarEl, { avatar, name: senderName, color });
  }
  if (senderEl) {
    senderEl.textContent = senderName;
  }
  if (snippetEl) {
    if (msg.type === 'proposal' && msg.proposal) {
      snippetEl.textContent = `📅 Đề xuất hẹn: ${msg.proposal.title || 'Hẹn nhóm'} (${msg.proposal.dayName} ${msg.proposal.startHour}h-${msg.proposal.endHour}h)`;
    } else {
      snippetEl.textContent = msg.text || 'Đã gửi một tin nhắn';
    }
  }

  toastEl.classList.remove('hidden');

  toastDismissTimer = setTimeout(() => {
    dismissChatIncomingToast();
  }, 5000);
}

export function dismissChatIncomingToast() {
  clearTimeout(toastDismissTimer);
  const toastEl = document.getElementById('chatIncomingToast');
  if (toastEl) toastEl.classList.add('hidden');
}

export function highlightLatestMessage() {
  requestAnimationFrame(() => {
    const container = document.getElementById('chatMessagesList');
    if (!container) return;
    const lastMsg = container.querySelector('.chat-msg-item:last-child');
    if (lastMsg) {
      lastMsg.scrollIntoView({ behavior: 'smooth', block: 'end' });
      lastMsg.classList.remove('msg-highlight');
      void lastMsg.offsetWidth;
      lastMsg.classList.add('msg-highlight');
      setTimeout(() => lastMsg.classList.remove('msg-highlight'), 2200);
    }
  });
}

export function initChatNotifications({ onOpenChat } = {}) {
  const card = document.getElementById('chatToastCard');
  const closeBtn = document.getElementById('btnChatToastClose');
  const viewBtn = document.getElementById('btnChatToastView');
  const scrollPill = document.getElementById('chatNewMsgScrollPill');
  const container = document.getElementById('chatMessagesList');

  const handleOpen = (e) => {
    if (e && e.target && e.target.closest('#btnChatToastClose')) return;
    dismissChatIncomingToast();
    if (typeof onOpenChat === 'function') onOpenChat();
    highlightLatestMessage();
  };

  if (card) card.addEventListener('click', handleOpen);
  if (viewBtn) {
    viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleOpen(e);
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissChatIncomingToast();
    });
  }

  if (scrollPill && container) {
    scrollPill.addEventListener('click', () => {
      scrollPill.classList.add('hidden');
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    });

    container.addEventListener('scroll', () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distFromBottom < 70) {
        scrollPill.classList.add('hidden');
      }
    });
  }
}
