import { formatHourRange, openModal, showToast, escapeHtml } from './utils.js';
import { state } from './state.js';
import { emitVoteProposal } from './socket.js';

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
      <div class="chat-member-pill ${isMe ? 'is-me-pill' : ''}" data-member-info="${m.id}" title="${escapeHtml(m.name)} — ${escapeHtml(m.role)} (${isOnline ? 'Đang online' : 'Offline'})" style="cursor:pointer">
        <span class="chip-avatar" style="background:${m.color}">${escapeHtml(m.avatar)}</span>
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
      <span class="avatar-circle" style="background:${msg.memberColor || '#4f46e5'}">${escapeHtml(msg.memberAvatar || 'TV')}</span>
      <div class="chat-msg-body">
        <div class="chat-msg-meta">
          <strong>${escapeHtml(msg.memberName)}</strong>
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
    <span class="avatar-circle" style="background:${msg.memberColor || '#4f46e5'}">${escapeHtml(msg.memberAvatar || 'TV')}</span>
    <div class="chat-msg-body">
      <div class="chat-msg-meta">
        <strong>${escapeHtml(msg.memberName)}</strong>
        <span>${timeStr}</span>
      </div>
      <div class="chat-bubble">${escapeHtml(msg.text)}</div>
    </div>
  `;
  return wrapper;
}
