const dbRepo = require('../repositories/db.repository');
const { buildSystemMessage, buildMemberMessage, toggleProposalVote } = require('../services/proposal.service');
const { sanitizeScheduleData, enforceNoPastScheduleChanges } = require('../services/availability.service');
const { normalizeRoomCode, isValidRoomCode } = require('../utils/roomCode');
const { getOnlineMemberIds, getIo } = require('../sockets');

const restHeartbeats = {}; // { [roomCode]: { [memberId]: timestampMs } }
const HEARTBEAT_TTL_MS = 30000;

function touchMemberHeartbeat(roomCode, memberId) {
  if (!roomCode || !memberId) return;
  const code = normalizeRoomCode(roomCode);
  if (!restHeartbeats[code]) restHeartbeats[code] = {};
  restHeartbeats[code][memberId] = Date.now();
}

function getCombinedOnlineMemberIds(roomCode) {
  const code = normalizeRoomCode(roomCode);
  const set = new Set(getOnlineMemberIds(code));
  const map = restHeartbeats[code];
  if (map) {
    const now = Date.now();
    for (const [mId, ts] of Object.entries(map)) {
      if (now - ts <= HEARTBEAT_TTL_MS) {
        set.add(mId);
      } else {
        delete map[mId];
      }
    }
  }
  return Array.from(set);
}

function formatRoomSummary(room, userId) {
  const myMember = room.members.find(m => m.userId === userId);
  return {
    code: room.code,
    name: room.name,
    description: room.description,
    memberCount: room.members.length,
    onlineCount: getCombinedOnlineMemberIds(room.code).length,
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

    touchMemberHeartbeat(cleanCode, myMember.id);

    res.json({
      room,
      member: myMember,
      onlineMemberIds: getCombinedOnlineMemberIds(cleanCode)
    });
  } catch (err) {
    next(err);
  }
}

async function updateMyGroupSchedule(req, res, next) {
  try {
    const cleanCode = normalizeRoomCode(req.params.code);
    const { weekKey, schedule } = req.body || {};
    if (!weekKey) {
      return res.status(400).json({ error: 'Thiếu thông tin tuần (weekKey).' });
    }

    const room = await dbRepo.getRoom(cleanCode);
    if (!room) {
      return res.status(404).json({ error: `Nhóm #${cleanCode} không tồn tại.` });
    }

    const myMember = room.members.find(m => m.userId === req.user.id);
    if (!myMember) {
      return res.status(403).json({ error: 'Bạn chưa tham gia nhóm này.' });
    }

    touchMemberHeartbeat(cleanCode, myMember.id);
    const existingSchedule = await dbRepo.getSchedule(cleanCode, myMember.id, weekKey);
    const cleaned = enforceNoPastScheduleChanges(
      existingSchedule,
      sanitizeScheduleData(schedule),
      weekKey
    );

    const result = await dbRepo.saveSchedule(cleanCode, myMember.id, weekKey, cleaned);
    const io = getIo();
    if (io) {
      io.to(cleanCode).emit('schedule_updated', {
        memberId: myMember.id,
        memberName: myMember.name,
        weekKey,
        schedule: result.schedule,
        updatedAt: new Date().toISOString()
      });
    }

    res.json({
      memberId: myMember.id,
      memberName: myMember.name,
      weekKey,
      schedule: result.schedule
    });
  } catch (err) {
    next(err);
  }
}

async function postGroupMessage(req, res, next) {
  try {
    const cleanCode = normalizeRoomCode(req.params.code);
    const { text, type, proposal } = req.body || {};

    const room = await dbRepo.getRoom(cleanCode);
    if (!room) {
      return res.status(404).json({ error: `Nhóm #${cleanCode} không tồn tại.` });
    }

    const myMember = room.members.find(m => m.userId === req.user.id);
    if (!myMember) {
      return res.status(403).json({ error: 'Bạn chưa tham gia nhóm này.' });
    }

    touchMemberHeartbeat(cleanCode, myMember.id);
    const message = buildMemberMessage({ member: myMember, text, type, proposal });
    if (!message) {
      return res.status(400).json({ error: 'Nội dung tin nhắn không hợp lệ.' });
    }

    await dbRepo.addMessage(cleanCode, message);
    const io = getIo();
    if (io) {
      io.to(cleanCode).emit('new_message', message);
    }

    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
}

async function voteGroupProposal(req, res, next) {
  try {
    const cleanCode = normalizeRoomCode(req.params.code);
    const { messageId } = req.params;
    const { vote } = req.body || {};

    const room = await dbRepo.getRoom(cleanCode);
    if (!room) {
      return res.status(404).json({ error: `Nhóm #${cleanCode} không tồn tại.` });
    }

    const myMember = room.members.find(m => m.userId === req.user.id);
    if (!myMember) {
      return res.status(403).json({ error: 'Bạn chưa tham gia nhóm này.' });
    }

    touchMemberHeartbeat(cleanCode, myMember.id);
    const updatedMsg = await dbRepo.updateProposalVote(cleanCode, messageId, myMember.id, (currentVotes) =>
      toggleProposalVote(currentVotes, myMember.id, vote)
    );
    if (!updatedMsg) {
      return res.status(404).json({ error: 'Không tìm thấy đề xuất lịch hẹn.' });
    }

    const io = getIo();
    if (io) {
      io.to(cleanCode).emit('message_updated', updatedMsg);
    }

    res.json({ message: updatedMsg });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMyGroups,
  createGroup,
  joinGroup,
  getGroupByCode,
  updateMyGroupSchedule,
  postGroupMessage,
  voteGroupProposal
};
