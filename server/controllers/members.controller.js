const dbRepo = require('../repositories/db.repository');
const { buildSystemMessage } = require('../services/proposal.service');
const { normalizeRoomCode } = require('../utils/roomCode');
const { getOnlineMemberIds, getIo } = require('../sockets');

async function listMembers(req, res, next) {
  try {
    const code = normalizeRoomCode(req.params.code);
    const room = await dbRepo.getRoom(code);
    if (!room) {
      return res.status(404).json({ error: 'Phòng không tồn tại.' });
    }
    const members = await dbRepo.listMembers(code);
    res.json({ members });
  } catch (err) {
    next(err);
  }
}

async function upsertMember(req, res, next) {
  try {
    const code = normalizeRoomCode(req.params.code);
    const { name, role, color } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      return res.status(400).json({ error: 'Vui lòng nhập tên thành viên.' });
    }

    const result = await dbRepo.upsertMember(code, { name: cleanName, role, color });
    if (!result) {
      return res.status(404).json({ error: 'Phòng không tồn tại.' });
    }

    const { member, isNew, room } = result;
    const io = getIo();

    if (isNew) {
      const sysMsg = buildSystemMessage(`${member.name} (${member.role}) đã tham gia nhóm.`);
      await dbRepo.addMessage(code, sysMsg);
      if (io) {
        io.to(code).emit('new_message', sysMsg);
      }
    }

    if (io) {
      io.to(code).emit('room_updated', {
        room,
        onlineMemberIds: getOnlineMemberIds(code)
      });
    }

    res.json({ member, room });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMembers,
  upsertMember
};

