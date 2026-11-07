const dbRepo = require('../repositories/db.repository');
const { sanitizeScheduleData, enforceNoPastScheduleChanges } = require('../services/availability.service');
const { normalizeRoomCode } = require('../utils/roomCode');

function registerScheduleHandlers(io, socket, resolveSocketUserId) {
  socket.on('update_schedule', async ({ roomCode, memberId, weekKey, schedule, weeks, token } = {}) => {
    try {
      const code = normalizeRoomCode(roomCode);
      const hasBatchWeeks = weeks && typeof weeks === 'object' && !Array.isArray(weeks);
      if (!code || (!weekKey && !hasBatchWeeks)) return;

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

      if (hasBatchWeeks) {
        const weekEntries = Object.entries(weeks)
          .filter(([wk]) => /^\d{4}-\d{2}-\d{2}$/.test(String(wk)))
          .slice(0, 16);
        if (weekEntries.length === 0) return;

        const cleanedWeeks = {};
        for (const [wk, rawSched] of weekEntries) {
          let cleaned = sanitizeScheduleData(rawSched);
          if (userId) {
            const existing = await dbRepo.getSchedule(code, targetMember.id, wk);
            cleaned = enforceNoPastScheduleChanges(existing, cleaned, wk);
          }
          cleanedWeeks[wk] = cleaned;
        }

        const result = await dbRepo.saveSchedulesBatch(code, targetMember.id, cleanedWeeks);
        if (!result || !result.weeks) return;

        const updatedAt = new Date().toISOString();
        const memberName = result.member ? result.member.name : targetMember.name;
        for (const [wk, savedSched] of Object.entries(result.weeks)) {
          io.to(code).emit('schedule_updated', {
            memberId: targetMember.id,
            memberName,
            weekKey: wk,
            schedule: savedSched,
            updatedAt
          });
        }
        return;
      }

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
