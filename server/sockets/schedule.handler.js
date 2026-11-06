const dbRepo = require('../repositories/db.repository');
const { sanitizeScheduleData, enforceNoPastScheduleChanges } = require('../services/availability.service');
const { normalizeRoomCode } = require('../utils/roomCode');

function registerScheduleHandlers(io, socket, resolveSocketUserId) {
  socket.on('update_schedule', async ({ roomCode, memberId, weekKey, schedule, token } = {}) => {
    try {
      const code = normalizeRoomCode(roomCode);
      if (!code || !weekKey) return;

      const room = await dbRepo.getRoom(code);
      if (!room) return;

      const userId = resolveSocketUserId ? resolveSocketUserId(socket, token) : null;
      let targetMember = null;
      if (userId) {
        targetMember = room.members.find(m => m.userId === userId) || null;
      } else if (memberId) {
        targetMember = room.members.find(m => m.id === memberId) || null;
      }
      if (!targetMember) return;

      let cleanedSchedule = sanitizeScheduleData(schedule);
      if (userId) {
        const existingSchedule = await dbRepo.getSchedule(code, targetMember.id, weekKey);
        cleanedSchedule = enforceNoPastScheduleChanges(existingSchedule, cleanedSchedule, weekKey);
      }
      const result = await dbRepo.saveSchedule(code, targetMember.id, weekKey, cleanedSchedule);
      if (!result) return;

      io.to(code).emit('schedule_updated', {
        memberId: targetMember.id,
        memberName: result.member ? result.member.name : targetMember.name,
        weekKey,
        schedule: result.schedule,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error in update_schedule socket handler:', err);
    }
  });
}

module.exports = { registerScheduleHandlers };
