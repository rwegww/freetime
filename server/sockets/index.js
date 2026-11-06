const dbRepo = require('../repositories/db.repository');
const { verifyToken } = require('../services/auth.service');
const { normalizeRoomCode } = require('../utils/roomCode');
const { registerScheduleHandlers } = require('./schedule.handler');
const { registerChatHandlers } = require('./chat.handler');

const onlineRoomUsers = {};
let ioInstance = null;

function getOnlineMemberIds(roomCode) {
  const code = normalizeRoomCode(roomCode);
  const map = onlineRoomUsers[code] || {};
  return Array.from(new Set(Object.values(map).filter(Boolean)));
}

function getIo() {
  return ioInstance;
}

function resolveSocketUserId(socket, payloadToken) {
  const token = payloadToken || (socket.handshake && socket.handshake.auth && socket.handshake.auth.token);
  if (token) {
    const decoded = verifyToken(token);
    if (decoded && decoded.sub) {
      socket.data.userId = decoded.sub;
      return decoded.sub;
    }
  }
  return socket.data && socket.data.userId ? socket.data.userId : null;
}

function initSockets(io) {
  ioInstance = io;

  io.on('connection', (socket) => {
    let currentRoom = null;
    let currentMemberId = null;

    resolveSocketUserId(socket);

    socket.on('authenticate', ({ token } = {}) => {
      if (!token) {
        socket.data.userId = null;
        if (currentRoom && onlineRoomUsers[currentRoom]) {
          delete onlineRoomUsers[currentRoom][socket.id];
          io.to(currentRoom).emit('online_users', getOnlineMemberIds(currentRoom));
          socket.leave(currentRoom);
        }
        currentRoom = null;
        currentMemberId = null;
        return;
      }
      resolveSocketUserId(socket, token);
    });

    socket.on('join_room', async ({ roomCode, memberId, token } = {}) => {
      try {
        const code = normalizeRoomCode(roomCode);
        const room = await dbRepo.getRoom(code);
        if (!room) return;

        const userId = resolveSocketUserId(socket, token);
        let resolvedMemberId = memberId || null;

        if (userId) {
          const myMember = room.members.find(m => m.userId === userId);
          if (!myMember) {
            // Authenticated user is not a member of this group -> do not join group chat
            return;
          }
          resolvedMemberId = myMember.id;
        }

        if (currentRoom && onlineRoomUsers[currentRoom]) {
          delete onlineRoomUsers[currentRoom][socket.id];
          io.to(currentRoom).emit('online_users', getOnlineMemberIds(currentRoom));
          socket.leave(currentRoom);
        }

        currentRoom = code;
        currentMemberId = resolvedMemberId;
        socket.join(code);

        if (!onlineRoomUsers[code]) onlineRoomUsers[code] = {};
        onlineRoomUsers[code][socket.id] = currentMemberId;

        io.to(code).emit('online_users', getOnlineMemberIds(code));
      } catch (err) {
        console.error('Error in join_room socket handler:', err);
      }
    });

    registerScheduleHandlers(io, socket, resolveSocketUserId);
    registerChatHandlers(io, socket, resolveSocketUserId);

    socket.on('disconnect', () => {
      if (currentRoom && onlineRoomUsers[currentRoom]) {
        delete onlineRoomUsers[currentRoom][socket.id];
        io.to(currentRoom).emit('online_users', getOnlineMemberIds(currentRoom));
      }
    });
  });
}

module.exports = {
  initSockets,
  getOnlineMemberIds,
  getIo
};
