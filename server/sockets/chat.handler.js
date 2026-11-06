const dbRepo = require('../repositories/db.repository');
const { buildMemberMessage, toggleProposalVote } = require('../services/proposal.service');
const { normalizeRoomCode } = require('../utils/roomCode');

function resolveAuthorizedMember(room, socket, resolveSocketUserId, fallbackMemberId, token) {
  const userId = resolveSocketUserId ? resolveSocketUserId(socket, token) : null;
  if (userId) {
    return room.members.find(m => m.userId === userId) || null;
  }
  if (!fallbackMemberId) return null;
  return room.members.find(m => m.id === fallbackMemberId) || null;
}

function registerChatHandlers(io, socket, resolveSocketUserId) {
  socket.on('send_message', async ({ roomCode, memberId, text, type, proposal, token } = {}) => {
    try {
      const code = normalizeRoomCode(roomCode);
      if (!code) return;

      const room = await dbRepo.getRoom(code);
      if (!room) return;

      const member = resolveAuthorizedMember(room, socket, resolveSocketUserId, memberId, token);
      if (!member) return;

      const message = buildMemberMessage({ member, text, type, proposal });
      if (!message) return;

      await dbRepo.addMessage(code, message);
      io.to(code).emit('new_message', message);
    } catch (err) {
      console.error('Error in send_message socket handler:', err);
    }
  });

  socket.on('vote_proposal', async ({ roomCode, messageId, memberId, vote, token } = {}) => {
    try {
      const code = normalizeRoomCode(roomCode);
      if (!code || !messageId) return;

      const room = await dbRepo.getRoom(code);
      if (!room) return;

      const member = resolveAuthorizedMember(room, socket, resolveSocketUserId, memberId, token);
      if (!member) return;

      const updatedMsg = await dbRepo.updateProposalVote(code, messageId, member.id, (currentVotes) =>
        toggleProposalVote(currentVotes, member.id, vote)
      );
      if (!updatedMsg) return;

      io.to(code).emit('message_updated', updatedMsg);
    } catch (err) {
      console.error('Error in vote_proposal socket handler:', err);
    }
  });

  socket.on('typing', async ({ roomCode, memberId, isTyping, token } = {}) => {
    try {
      const code = normalizeRoomCode(roomCode);
      if (!code) return;

      const room = await dbRepo.getRoom(code);
      if (!room) return;

      const member = resolveAuthorizedMember(room, socket, resolveSocketUserId, memberId, token);
      if (!member) return;

      socket.to(code).emit('user_typing', {
        memberId: member.id,
        memberName: member.name,
        isTyping: !!isTyping
      });
    } catch (err) {
      console.error('Error in typing socket handler:', err);
    }
  });
}

module.exports = { registerChatHandlers };
