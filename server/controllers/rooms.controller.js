const dbRepo = require('../repositories/db.repository');
const { normalizeRoomCode, isValidRoomCode } = require('../utils/roomCode');
const { getOnlineMemberIds } = require('../sockets');

async function listRooms(req, res, next) {
  try {
    const rooms = await dbRepo.listRooms();
    const list = rooms.map(r => ({
      code: r.code,
      name: r.name,
      description: r.description,
      memberCount: r.members.length,
      onlineCount: getOnlineMemberIds(r.code).length
    }));
    res.json({ rooms: list });
  } catch (err) {
    next(err);
  }
}

async function getRoomByCode(req, res, next) {
  try {
    const code = normalizeRoomCode(req.params.code);
    const room = await dbRepo.getRoom(code);
    if (!room) {
      return res.status(404).json({ error: 'Không tìm thấy phòng với mã này.' });
    }
    res.json({
      room,
      onlineMemberIds: getOnlineMemberIds(code)
    });
  } catch (err) {
    next(err);
  }
}

async function createOrGetRoom(req, res, next) {
  try {
    const { code, name, description } = req.body || {};
    const cleanCode = normalizeRoomCode(code);
    if (!isValidRoomCode(cleanCode)) {
      return res.status(400).json({ error: 'Mã phòng cần ít nhất 3 ký tự (chữ hoặc số).' });
    }

    const room = await dbRepo.createRoom({ code: cleanCode, name, description });
    res.json({
      room,
      onlineMemberIds: getOnlineMemberIds(cleanCode)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listRooms,
  getRoomByCode,
  createOrGetRoom
};

