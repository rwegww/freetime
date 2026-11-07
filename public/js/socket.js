import { getSavedToken } from './api.js';

const hasRealtimeSocket =
  typeof window.io === 'function' && !window.__FREETIME_SERVERLESS__;

const socket = hasRealtimeSocket
  ? window.io({
      auth: (cb) => cb({ token: getSavedToken() })
    })
  : null;

// ==================== SERVERLESS REST SYNC FALLBACK ====================
const handlers = {};
let activeRoomCode = '';
let activeMemberId = '';
let pollTimer = null;
let isPolling = false;
let initializedRoomSnapshot = false;
let lastMembersSig = '';
const knownMsgVotes = new Map(); // msgId -> votesJson
const knownSchedules = new Map(); // `${weekKey}:${memberId}` -> schedJson

function authJsonHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = getSavedToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function snapshotRoomState(room, myMemberId) {
  lastMembersSig = JSON.stringify((room.members || []).map(m => `${m.id}:${m.name}:${m.role}:${m.color}`));
  knownMsgVotes.clear();
  for (const msg of room.messages || []) {
    knownMsgVotes.set(msg.id, JSON.stringify(msg.proposal ? msg.proposal.votes : null));
  }
  knownSchedules.clear();
  for (const [wk, memberMap] of Object.entries(room.schedules || {})) {
    for (const [mId, sched] of Object.entries(memberMap || {})) {
      if (mId !== myMemberId) {
        knownSchedules.set(`${wk}:${mId}`, JSON.stringify(sched || {}));
      }
    }
  }
  initializedRoomSnapshot = true;
}

async function pollServerlessRoom() {
  if (!activeRoomCode || !getSavedToken() || isPolling) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  isPolling = true;
  const targetRoom = activeRoomCode;
  try {
    const res = await fetch(`/api/groups/${encodeURIComponent(targetRoom)}`, {
      headers: authJsonHeaders()
    });
    if (!res.ok || targetRoom !== activeRoomCode) return;
    const data = await res.json();
    const room = data.room;
    if (!room) return;

    if (handlers.onOnlineUsers) {
      handlers.onOnlineUsers(data.onlineMemberIds || []);
    }

    if (!initializedRoomSnapshot) {
      snapshotRoomState(room, activeMemberId);
      return;
    }

    // 1. Check member list / profile changes
    const nextMembersSig = JSON.stringify(
      (room.members || []).map(m => `${m.id}:${m.name}:${m.role}:${m.color}`)
    );
    if (nextMembersSig !== lastMembersSig) {
      lastMembersSig = nextMembersSig;
      if (handlers.onRoomUpdated) {
        handlers.onRoomUpdated({ room, onlineMemberIds: data.onlineMemberIds || [] });
      }
    }

    // 2. Check schedule changes from teammates
    for (const [wk, memberMap] of Object.entries(room.schedules || {})) {
      for (const [mId, sched] of Object.entries(memberMap || {})) {
        if (mId === activeMemberId) continue;
        const key = `${wk}:${mId}`;
        const sig = JSON.stringify(sched || {});
        if (knownSchedules.get(key) !== sig) {
          knownSchedules.set(key, sig);
          const memberObj = (room.members || []).find(m => m.id === mId);
          if (handlers.onScheduleUpdated) {
            handlers.onScheduleUpdated({
              memberId: mId,
              memberName: memberObj ? memberObj.name : 'Thành viên',
              weekKey: wk,
              schedule: sched || {}
            });
          }
        }
      }
    }

    // 3. Check new messages & proposal vote updates
    for (const msg of room.messages || []) {
      const voteSig = JSON.stringify(msg.proposal ? msg.proposal.votes : null);
      if (!knownMsgVotes.has(msg.id)) {
        knownMsgVotes.set(msg.id, voteSig);
        if (handlers.onNewMessage) handlers.onNewMessage(msg);
      } else if (knownMsgVotes.get(msg.id) !== voteSig) {
        knownMsgVotes.set(msg.id, voteSig);
        if (handlers.onMessageUpdated) handlers.onMessageUpdated(msg);
      }
    }
  } catch (_) {
    // Ignore transient network errors during background poll
  } finally {
    isPolling = false;
  }
}

function stopServerlessPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  activeRoomCode = '';
  activeMemberId = '';
  initializedRoomSnapshot = false;
}

// ==================== PUBLIC TRANSPORT API ====================

export function authenticateSocket(token) {
  if (socket) {
    socket.emit('authenticate', { token: token || '' });
    return;
  }
  if (!token) {
    stopServerlessPolling();
  }
}

export function emitJoinRoom(roomCode, memberId) {
  if (socket) {
    socket.emit('join_room', { roomCode, memberId, token: getSavedToken() });
    return;
  }

  const nextCode = String(roomCode || '').trim().toUpperCase();
  if (nextCode !== activeRoomCode) {
    initializedRoomSnapshot = false;
    knownMsgVotes.clear();
    knownSchedules.clear();
  }
  activeRoomCode = nextCode;
  activeMemberId = memberId || '';

  if (pollTimer) clearInterval(pollTimer);
  if (activeRoomCode) {
    pollServerlessRoom();
    pollTimer = setInterval(pollServerlessRoom, 2500);
  }
}

export function emitUpdateSchedule(roomCode, memberId, weekKey, schedule) {
  if (socket) {
    socket.emit('update_schedule', {
      roomCode,
      memberId,
      weekKey,
      schedule,
      token: getSavedToken()
    });
    return Promise.resolve();
  }

  return fetch(`/api/groups/${encodeURIComponent(roomCode)}/schedule`, {
    method: 'PUT',
    headers: authJsonHeaders(),
    body: JSON.stringify({ weekKey, schedule })
  }).catch(() => {});
}

export function emitUpdateSchedulesBatch(roomCode, memberId, weeksMap) {
  if (!weeksMap || typeof weeksMap !== 'object') return Promise.resolve();
  const keys = Object.keys(weeksMap);
  if (keys.length === 0) return Promise.resolve();
  if (keys.length === 1) {
    const wk = keys[0];
    return emitUpdateSchedule(roomCode, memberId, wk, weeksMap[wk]);
  }

  if (socket) {
    socket.emit('update_schedule', {
      roomCode,
      memberId,
      weeks: weeksMap,
      token: getSavedToken()
    });
    return Promise.resolve();
  }

  return fetch(`/api/groups/${encodeURIComponent(roomCode)}/schedule`, {
    method: 'PUT',
    headers: authJsonHeaders(),
    body: JSON.stringify({ weeks: weeksMap })
  }).catch(() => {});
}

export function emitSendMessage(payload) {
  if (socket) {
    socket.emit('send_message', {
      ...payload,
      token: getSavedToken()
    });
    return;
  }

  fetch(`/api/groups/${encodeURIComponent(payload.roomCode)}/messages`, {
    method: 'POST',
    headers: authJsonHeaders(),
    body: JSON.stringify({
      text: payload.text,
      type: payload.type,
      proposal: payload.proposal
    })
  })
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (data && data.message) {
        knownMsgVotes.set(
          data.message.id,
          JSON.stringify(data.message.proposal ? data.message.proposal.votes : null)
        );
        if (handlers.onNewMessage) handlers.onNewMessage(data.message);
      }
    })
    .catch(() => {});
}

export function emitVoteProposal(roomCode, messageId, memberId, vote) {
  if (socket) {
    socket.emit('vote_proposal', {
      roomCode,
      messageId,
      memberId,
      vote,
      token: getSavedToken()
    });
    return;
  }

  fetch(`/api/groups/${encodeURIComponent(roomCode)}/messages/${encodeURIComponent(messageId)}/vote`, {
    method: 'POST',
    headers: authJsonHeaders(),
    body: JSON.stringify({ vote })
  })
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (data && data.message) {
        knownMsgVotes.set(
          data.message.id,
          JSON.stringify(data.message.proposal ? data.message.proposal.votes : null)
        );
        if (handlers.onMessageUpdated) handlers.onMessageUpdated(data.message);
      }
    })
    .catch(() => {});
}

export function emitTyping(roomCode, memberId, isTyping) {
  if (socket) {
    socket.emit('typing', {
      roomCode,
      memberId,
      isTyping,
      token: getSavedToken()
    });
  }
}

export function bindSocketEvents({
  onOnlineUsers,
  onRoomUpdated,
  onScheduleUpdated,
  onNewMessage,
  onMessageUpdated,
  onUserTyping,
  onReconnect
}) {
  handlers.onOnlineUsers = onOnlineUsers;
  handlers.onRoomUpdated = onRoomUpdated;
  handlers.onScheduleUpdated = onScheduleUpdated;
  handlers.onNewMessage = onNewMessage;
  handlers.onMessageUpdated = onMessageUpdated;
  handlers.onUserTyping = onUserTyping;

  if (socket) {
    if (onOnlineUsers) socket.on('online_users', onOnlineUsers);
    if (onRoomUpdated) socket.on('room_updated', onRoomUpdated);
    if (onScheduleUpdated) socket.on('schedule_updated', onScheduleUpdated);
    if (onNewMessage) socket.on('new_message', onNewMessage);
    if (onMessageUpdated) socket.on('message_updated', onMessageUpdated);
    if (onUserTyping) socket.on('user_typing', onUserTyping);
    if (onReconnect) socket.io.on('reconnect', onReconnect);
  } else if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && activeRoomCode) {
        pollServerlessRoom();
      }
    });
  }
}
