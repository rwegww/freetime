import { getSavedToken } from './api.js';

const socket = window.io({
  auth: (cb) => cb({ token: getSavedToken() })
});

export function authenticateSocket(token) {
  socket.emit('authenticate', { token: token || '' });
}

export function emitJoinRoom(roomCode, memberId) {
  socket.emit('join_room', { roomCode, memberId, token: getSavedToken() });
}

export function emitUpdateSchedule(roomCode, memberId, weekKey, schedule) {
  socket.emit('update_schedule', {
    roomCode,
    memberId,
    weekKey,
    schedule,
    token: getSavedToken()
  });
}

export function emitSendMessage(payload) {
  socket.emit('send_message', {
    ...payload,
    token: getSavedToken()
  });
}

export function emitVoteProposal(roomCode, messageId, memberId, vote) {
  socket.emit('vote_proposal', {
    roomCode,
    messageId,
    memberId,
    vote,
    token: getSavedToken()
  });
}

export function emitTyping(roomCode, memberId, isTyping) {
  socket.emit('typing', {
    roomCode,
    memberId,
    isTyping,
    token: getSavedToken()
  });
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
  if (onOnlineUsers) socket.on('online_users', onOnlineUsers);
  if (onRoomUpdated) socket.on('room_updated', onRoomUpdated);
  if (onScheduleUpdated) socket.on('schedule_updated', onScheduleUpdated);
  if (onNewMessage) socket.on('new_message', onNewMessage);
  if (onMessageUpdated) socket.on('message_updated', onMessageUpdated);
  if (onUserTyping) socket.on('user_typing', onUserTyping);
  if (onReconnect) socket.io.on('reconnect', onReconnect);
}
