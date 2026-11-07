const dbRepo = require('../repositories/db.repository');
const {
  normalizeUsername,
  isValidUsername,
  hashPassword,
  verifyPassword,
  signToken,
  sanitizeUser
} = require('../services/auth.service');
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

async function register(req, res, next) {
  try {
    const { username, password, name, role, color } = req.body || {};
    const cleanName = String(name || '').trim();
    const cleanUsername = normalizeUsername(username);
    const rawPassword = String(password || '');

    if (cleanName.length < 2) {
      return res.status(400).json({ error: 'Vui lòng nhập họ và tên hiển thị (ít nhất 2 ký tự).' });
    }
    if (!isValidUsername(cleanUsername)) {
      return res.status(400).json({
        error: 'Tên đăng nhập nên viết liền không dấu, hoặc dùng Số điện thoại / Email (VD: 0912345678 hoặc tuankiet).'
      });
    }
    if (rawPassword.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu cần ít nhất 6 ký tự.' });
    }

    const passwordHash = hashPassword(rawPassword);
    const user = await dbRepo.createUser({
      username: cleanUsername,
      name: cleanName,
      role,
      color,
      passwordHash
    });

    const token = signToken(user);
    res.status(201).json({
      token,
      user: sanitizeUser(user),
      rooms: []
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};
    const cleanUsername = normalizeUsername(username);
    const rawPassword = String(password || '');

    if (!cleanUsername || !rawPassword) {
      return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu.' });
    }

    const user = await dbRepo.getUserByUsername(cleanUsername);
    if (!user || !verifyPassword(rawPassword, user.passwordHash)) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
    }

    const userRooms = await dbRepo.listUserRooms(user.id);
    const token = signToken(user);

    res.json({
      token,
      user: sanitizeUser(user),
      rooms: userRooms.map(r => formatRoomSummary(r, user.id))
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const userRooms = await dbRepo.listUserRooms(req.user.id);
    res.json({
      user: sanitizeUser(req.user),
      rooms: userRooms.map(r => formatRoomSummary(r, req.user.id))
    });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { name, role, color } = req.body || {};
    if (name !== undefined && String(name).trim().length < 2) {
      return res.status(400).json({ error: 'Họ và tên cần ít nhất 2 ký tự.' });
    }

    const updated = await dbRepo.updateUserProfile(req.user.id, { name, role, color });
    if (!updated) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    }

    const io = getIo();
    if (io && updated.affectedRoomCodes.length > 0) {
      for (const code of updated.affectedRoomCodes) {
        const room = await dbRepo.getRoom(code);
        if (room) {
          io.to(code).emit('room_updated', {
            room,
            onlineMemberIds: getOnlineMemberIds(code)
          });
        }
      }
    }

    const userRooms = await dbRepo.listUserRooms(updated.user.id);
    res.json({
      user: sanitizeUser(updated.user),
      rooms: userRooms.map(r => formatRoomSummary(r, updated.user.id))
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  me,
  updateProfile
};
