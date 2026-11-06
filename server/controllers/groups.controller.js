const dbRepo = require('../repositories/db.repository');
const { buildSystemMessage } = require('../services/proposal.service');
const { normalizeRoomCode, isValidRoomCode } = require('../utils/roomCode');
const { getOnlineMemberIds, getIo } = require('../sockets');

function formatRoomSummary(room, userId) {
  const myMember = room.members.find(m => m.userId === userId);
  return {
    code: room.code,
    name: room.name,
    description: room.description,
    memberCount: room.members.length,
    onlineCount: getOnlineMemberIds(room.code).length,
    myMemberId: myMember ? myMember.id : null
  };
}

async function listMyGroups(req, res, next) {
  try {
    const rooms = await dbRepo.listUserRooms(req.user.id);
    res.json({
      rooms: rooms.map(r => formatRoomSummary(r, req.user.id))
    });
  } catch (err) {
    next(err);
  }
}

async function createGroup(req, res, next) {
  try {
    const { name, code, description } = req.body || {};
    const cleanName = String(name || '').trim();
    if (cleanName.length < 2) {
      return res.status(400).json({ error: 'Vui lòng nhập tên nhóm (ít nhất 2 ký tự).' });
    }

    const rawCode = String(code || '').trim();
    if (rawCode) {
      const normalized = normalizeRoomCode(rawCode);
      if (!isValidRoomCode(normalized)) {
        return res.status(400).json({ error: 'Mã nhóm tùy chọn cần từ 3–32 ký tự chữ hoặc số.' });
      }
    }

    const { room, member } = await dbRepo.createGroupForUser(req.user, {
      code: rawCode,
      name: cleanName,
      description
    });

    res.status(201).json({
      room,
      member,
      onlineMemberIds: getOnlineMemberIds(room.code)
    });
  } catch (err) {
    next(err);
  }
}

async function joinGroup(req, res, next) {
  try {
    const { code } = req.body || {};
    const cleanCode = normalizeRoomCode(code);
    if (!isValidRoomCode(cleanCode)) {
      return res.status(400).json({ error: 'Vui lòng nhập mã nhóm hợp lệ (ít nhất 3 ký tự).' });
    }

    const result = await dbRepo.joinGroupForUser(cleanCode, req.user);
    if (!result) {
      return res.status(404).json({
        error: `Không tìm thấy nhóm nào mang mã #${cleanCode}. Hãy kiểm tra lại mã mời!`
      });
    }

    const { room, member, isNew } = result;
    const io = getIo();

    if (isNew) {
      const sysMsg = buildSystemMessage(
        `👋 ${member.name} (${member.role}) đã tham gia nhóm! Cùng trao đổi và báo lịch tại đây nhé.`
      );
      await dbRepo.addMessage(cleanCode, sysMsg);
      if (io) {
        io.to(cleanCode).emit('new_message', sysMsg);
      }
    }

    if (io) {
      io.to(cleanCode).emit('room_updated', {
        room,
        onlineMemberIds: getOnlineMemberIds(cleanCode)
      });
    }

    res.json({
      room,
      member,
      isNew,
      onlineMemberIds: getOnlineMemberIds(cleanCode)
    });
  } catch (err) {
    next(err);
  }
}

async function getGroupByCode(req, res, next) {
  try {
    const cleanCode = normalizeRoomCode(req.params.code);
    const room = await dbRepo.getRoom(cleanCode);
    if (!room) {
      return res.status(404).json({ error: `Nhóm #${cleanCode} không tồn tại.` });
    }

    const myMember = room.members.find(m => m.userId === req.user.id);
    if (!myMember) {
      return res.status(403).json({
        error: `Bạn chưa tham gia nhóm "${room.name}" (#${cleanCode}).`,
        code: cleanCode,
        roomName: room.name,
        canJoin: true
      });
    }

    res.json({
      room,
      member: myMember,
      onlineMemberIds: getOnlineMemberIds(cleanCode)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMyGroups,
  createGroup,
  joinGroup,
  getGroupByCode
};
