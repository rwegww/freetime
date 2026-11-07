const fs = require('fs');
const path = require('path');
const config = require('../config');
const {
  normalizeRoomCode,
  makeAvatar,
  getCurrentMondayKey,
  generateRoomCode
} = require('../utils/roomCode');

const DB_FILE = config.dbPath;
const DATA_DIR = path.dirname(DB_FILE);
const SUPABASE_BUCKET = 'freetime-data';
const SUPABASE_OBJECT = 'db.json';

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (_) {}

function hasSupabaseConfig() {
  return Boolean(config.supabase && config.supabase.url && config.supabase.secretKey);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: config.supabase.secretKey,
    Authorization: `Bearer ${config.supabase.secretKey}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function createInitialSeedData() {
  const weekKey = getCurrentMondayKey();
  const m1Schedule = {};
  const m2Schedule = {};
  const m3Schedule = {};

  for (let d = 0; d <= 4; d++) {
    for (let h = 8; h < 12; h++) {
      m1Schedule[`${d}-${h}`] = { status: 'busy', note: 'Ca sáng tại văn phòng' };
    }
  }
  [0, 2].forEach(d => {
    for (let h = 13; h < 17; h++) {
      m1Schedule[`${d}-${h}`] = { status: 'busy', note: 'Trực dự án khách hàng' };
    }
  });

  [0, 1, 3].forEach(d => {
    for (let h = 13; h < 18; h++) {
      m2Schedule[`${d}-${h}`] = { status: 'busy', note: 'Ca chiều kỹ thuật' };
    }
  });
  [2, 4].forEach(d => {
    for (let h = 8; h < 12; h++) {
      m2Schedule[`${d}-${h}`] = { status: 'busy', note: 'Họp & làm việc ca sáng' };
    }
  });

  [0, 2].forEach(d => {
    for (let h = 8; h < 12; h++) m3Schedule[`${d}-${h}`] = { status: 'busy', note: 'Ca sáng' };
    for (let h = 13; h < 17; h++) m3Schedule[`${d}-${h}`] = { status: 'busy', note: 'Ca chiều' };
  });
  for (let h = 8; h < 12; h++) m3Schedule[`1-${h}`] = { status: 'busy', note: 'Ca sáng' };
  for (let h = 18; h < 21; h++) m3Schedule[`4-${h}`] = { status: 'busy', note: 'Trực ca tối' };

  return {
    users: {},
    rooms: {
      TEAM01: {
        code: 'TEAM01',
        name: 'Nhóm Dự Án & Vận Hành (Demo)',
        description: 'Báo lịch làm việc hàng tuần để tự động tìm khung giờ trống họp nhóm & trao đổi nhanh.',
        createdBy: null,
        createdAt: new Date().toISOString(),
        workHours: { start: 7, end: 22 },
        members: [
          {
            id: 'mem_1',
            userId: null,
            name: 'Minh Anh',
            role: 'Team Lead',
            color: '#6366f1',
            avatar: 'MA',
            updatedAt: new Date().toISOString()
          },
          {
            id: 'mem_2',
            userId: null,
            name: 'Hoàng Nam',
            role: 'Developer',
            color: '#10b981',
            avatar: 'HN',
            updatedAt: new Date().toISOString()
          },
          {
            id: 'mem_3',
            userId: null,
            name: 'Thu Hà',
            role: 'Designer',
            color: '#f59e0b',
            avatar: 'TH',
            updatedAt: new Date().toISOString()
          }
        ],
        schedules: {
          [weekKey]: {
            mem_1: m1Schedule,
            mem_2: m2Schedule,
            mem_3: m3Schedule
          }
        },
        messages: [
          {
            id: 'msg_1',
            memberId: 'mem_1',
            memberName: 'Minh Anh',
            memberColor: '#6366f1',
            memberAvatar: 'MA',
            type: 'text',
            text: 'Chào mọi người! Mọi người cập nhật lịch làm việc tuần này vào bảng bên trái để hệ thống tự tính giờ trống chung nhé.',
            createdAt: new Date(Date.now() - 3600000 * 2).toISOString()
          },
          {
            id: 'msg_2',
            memberId: 'mem_2',
            memberName: 'Hoàng Nam',
            memberColor: '#10b981',
            memberAvatar: 'HN',
            type: 'text',
            text: 'Mình vừa điền lịch ca làm của mình rồi nha. Nhìn qua thấy chiều Thứ 6 (13:00 - 18:00) cả 3 đứa đều đang rảnh hoàn toàn!',
            createdAt: new Date(Date.now() - 3600000).toISOString()
          },
          {
            id: 'msg_3',
            memberId: 'mem_1',
            memberName: 'Minh Anh',
            memberColor: '#6366f1',
            memberAvatar: 'MA',
            type: 'proposal',
            text: 'Đề xuất lịch họp / gặp mặt nhóm vào khung giờ trống chung:',
            proposal: {
              title: 'Họp tổng kết Sprint & Phân công việc',
              dayIndex: 4,
              dayName: 'Thứ 6',
              startHour: 14,
              endHour: 16,
              weekKey,
              votes: {
                mem_1: 'yes',
                mem_2: 'yes'
              }
            },
            createdAt: new Date(Date.now() - 1800000).toISOString()
          }
        ]
      }
    }
  };
}

let db = { users: {}, rooms: {} };
let writeQueue = Promise.resolve();
let supabaseSqlTablesReady = null;
let supabaseUsersTableReady = null;
let storageBucketChecked = false;
let cloudInitialized = false;
let cloudInitPromise = null;
let lastCloudSyncAt = 0;

function ensureDbShape(obj) {
  if (!obj || typeof obj !== 'object') return { users: {}, rooms: {} };
  if (!obj.users || typeof obj.users !== 'object') obj.users = {};
  if (!obj.rooms || typeof obj.rooms !== 'object') obj.rooms = {};
  return obj;
}

function loadLocalDBSync() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.rooms && Object.keys(parsed.rooms).length > 0) {
        db = ensureDbShape(parsed);
        return;
      }
    }
  } catch (_) {}
  db = createInitialSeedData();
}

loadLocalDBSync();

// Check if PostgreSQL tables exist in Supabase
async function checkSupabaseSqlTables(forceRecheck = false) {
  if (!hasSupabaseConfig()) return false;
  if (!forceRecheck && supabaseSqlTablesReady !== null) return supabaseSqlTablesReady;
  try {
    const [roomsRes, usersRes] = await Promise.all([
      fetch(`${config.supabase.url}/rest/v1/rooms?select=code&limit=1`, { headers: supabaseHeaders() }),
      fetch(`${config.supabase.url}/rest/v1/users?select=id&limit=1`, { headers: supabaseHeaders() })
    ]);
    supabaseSqlTablesReady = roomsRes.ok;
    supabaseUsersTableReady = usersRes.ok;
    return supabaseSqlTablesReady;
  } catch (_) {
    supabaseSqlTablesReady = false;
    supabaseUsersTableReady = false;
    return false;
  }
}

// Assemble full db object from Supabase PostgreSQL tables (users, rooms, members, schedules, messages)
async function loadFromSupabaseSql() {
  const baseUrl = `${config.supabase.url}/rest/v1`;
  const headers = supabaseHeaders();

  const [usersRes, roomsRes, membersRes, schedulesRes, messagesRes] = await Promise.all([
    fetch(`${baseUrl}/users?select=*`, { headers }),
    fetch(`${baseUrl}/rooms?select=*`, { headers }),
    fetch(`${baseUrl}/members?select=*`, { headers }),
    fetch(`${baseUrl}/schedules?select=*`, { headers }),
    fetch(`${baseUrl}/messages?select=*&order=created_at.asc`, { headers })
  ]);

  if (!roomsRes.ok) return null;
  const roomsRows = await roomsRes.json();
  if (!Array.isArray(roomsRows) || roomsRows.length === 0) return null;

  const usersRows = usersRes.ok ? await usersRes.json() : [];
  const membersRows = membersRes.ok ? await membersRes.json() : [];
  const schedulesRows = schedulesRes.ok ? await schedulesRes.json() : [];
  const messagesRows = messagesRes.ok ? await messagesRes.json() : [];

  const assembledUsers = {};
  if (Array.isArray(usersRows)) {
    for (const u of usersRows) {
      assembledUsers[u.id] = {
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role || 'Thành viên',
        color: u.color || '#6366f1',
        avatar: u.avatar || makeAvatar(u.name),
        passwordHash: u.password_hash,
        createdAt: u.created_at,
        updatedAt: u.updated_at
      };
    }
  }

  const assembledRooms = {};
  for (const r of roomsRows) {
    assembledRooms[r.code] = {
      code: r.code,
      name: r.name,
      description: r.description || '',
      createdBy: r.created_by || null,
      createdAt: r.created_at,
      workHours: r.work_hours || { start: 7, end: 22 },
      members: [],
      schedules: {},
      messages: []
    };
  }

  for (const m of membersRows) {
    const room = assembledRooms[m.room_code];
    if (room) {
      room.members.push({
        id: m.id,
        userId: m.user_id || null,
        name: m.name,
        role: m.role,
        color: m.color,
        avatar: m.avatar,
        updatedAt: m.updated_at
      });
    }
  }

  for (const s of schedulesRows) {
    const room = assembledRooms[s.room_code];
    if (room) {
      if (!room.schedules[s.week_key]) room.schedules[s.week_key] = {};
      room.schedules[s.week_key][s.member_id] = s.schedule || {};
    }
  }

  for (const msg of messagesRows) {
    const room = assembledRooms[msg.room_code];
    if (room) {
      room.messages.push({
        id: msg.id,
        memberId: msg.member_id,
        memberName: msg.member_name,
        memberColor: msg.member_color,
        memberAvatar: msg.member_avatar,
        type: msg.type,
        text: msg.text,
        proposal: msg.proposal || null,
        createdAt: msg.created_at
      });
    }
  }

  return { users: assembledUsers, rooms: assembledRooms };
}

// Push a user to Supabase PostgreSQL users table
async function syncUserToSupabaseSql(user) {
  if (!user || !(await checkSupabaseSqlTables()) || !supabaseUsersTableReady) return false;
  const baseUrl = `${config.supabase.url}/rest/v1`;
  const upsertHeaders = supabaseHeaders({ Prefer: 'resolution=merge-duplicates' });

  await fetch(`${baseUrl}/users`, {
    method: 'POST',
    headers: upsertHeaders,
    body: JSON.stringify({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role || 'Thành viên',
      color: user.color || '#6366f1',
      avatar: user.avatar || makeAvatar(user.name),
      password_hash: user.passwordHash,
      created_at: user.createdAt || new Date().toISOString(),
      updated_at: user.updatedAt || new Date().toISOString()
    })
  });
  return true;
}

// Push a room to Supabase PostgreSQL tables
async function syncRoomToSupabaseSql(room) {
  if (!room || !(await checkSupabaseSqlTables())) return false;
  const baseUrl = `${config.supabase.url}/rest/v1`;
  const upsertHeaders = supabaseHeaders({ Prefer: 'resolution=merge-duplicates' });

  const roomBody = {
    code: room.code,
    name: room.name,
    description: room.description || '',
    work_hours: room.workHours || { start: 7, end: 22 },
    created_at: room.createdAt || new Date().toISOString()
  };
  if (supabaseUsersTableReady) {
    roomBody.created_by = room.createdBy || null;
  }

  await fetch(`${baseUrl}/rooms`, {
    method: 'POST',
    headers: upsertHeaders,
    body: JSON.stringify(roomBody)
  });

  const parallelTasks = [];

  if (Array.isArray(room.members) && room.members.length > 0) {
    const memberRows = room.members.map(m => {
      const row = {
        id: m.id,
        room_code: room.code,
        name: m.name,
        role: m.role || 'Thành viên',
        color: m.color || '#6366f1',
        avatar: m.avatar || 'TV',
        updated_at: m.updatedAt || new Date().toISOString()
      };
      if (supabaseUsersTableReady) {
        row.user_id = m.userId || null;
      }
      return row;
    });

    parallelTasks.push(
      fetch(`${baseUrl}/members`, {
        method: 'POST',
        headers: upsertHeaders,
        body: JSON.stringify(memberRows)
      }).then(async () => {
        const scheduleRows = [];
        for (const [weekKey, memberMap] of Object.entries(room.schedules || {})) {
          for (const [memberId, schedData] of Object.entries(memberMap || {})) {
            if (room.members.some(m => m.id === memberId)) {
              scheduleRows.push({
                room_code: room.code,
                member_id: memberId,
                week_key: weekKey,
                schedule: schedData || {},
                updated_at: new Date().toISOString()
              });
            }
          }
        }
        if (scheduleRows.length > 0) {
          await fetch(`${baseUrl}/schedules`, {
            method: 'POST',
            headers: upsertHeaders,
            body: JSON.stringify(scheduleRows)
          });
        }
      })
    );
  }

  if (Array.isArray(room.messages) && room.messages.length > 0) {
    const msgRows = room.messages.slice(-100).map(msg => ({
      id: msg.id,
      room_code: room.code,
      member_id: msg.memberId,
      member_name: msg.memberName,
      member_color: msg.memberColor || '#64748b',
      member_avatar: msg.memberAvatar || 'TV',
      type: msg.type || 'text',
      text: msg.text || '',
      proposal: msg.proposal || null,
      created_at: msg.createdAt || new Date().toISOString()
    }));
    parallelTasks.push(
      fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: upsertHeaders,
        body: JSON.stringify(msgRows)
      })
    );
  }

  if (parallelTasks.length > 0) {
    await Promise.all(parallelTasks);
  }
  return true;
}

// Load DB from Supabase Cloud Storage bucket
async function loadFromSupabaseStorage() {
  if (!hasSupabaseConfig()) return null;
  try {
    const res = await fetch(
      `${config.supabase.url}/storage/v1/object/${SUPABASE_BUCKET}/${SUPABASE_OBJECT}`,
      { headers: supabaseHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.rooms) return ensureDbShape(data);
    return null;
  } catch (_) {
    return null;
  }
}

async function syncToSupabaseStorage(payloadStr) {
  if (!hasSupabaseConfig()) return false;
  try {
    if (!storageBucketChecked) {
      storageBucketChecked = true;
      await fetch(`${config.supabase.url}/storage/v1/bucket`, {
        method: 'POST',
        headers: supabaseHeaders(),
        body: JSON.stringify({ id: SUPABASE_BUCKET, name: SUPABASE_BUCKET, public: false })
      }).catch(() => {});
    }

    const res = await fetch(
      `${config.supabase.url}/storage/v1/object/${SUPABASE_BUCKET}/${SUPABASE_OBJECT}`,
      {
        method: 'POST',
        headers: supabaseHeaders({ 'x-upsert': 'true' }),
        body: payloadStr
      }
    );
    return res.ok;
  } catch (_) {
    return false;
  }
}

// Ensure data is loaded from Supabase on startup (and refreshed across stateless serverless calls)
async function ensureCloudLoaded() {
  if (!hasSupabaseConfig()) return;
  const isServerless = Boolean(process.env.VERCEL);
  if (cloudInitialized && (!isServerless || Date.now() - lastCloudSyncAt < 1500)) {
    return;
  }
  if (cloudInitPromise) return cloudInitPromise;

  cloudInitPromise = (async () => {
    try {
      const sqlReady = await checkSupabaseSqlTables();
      if (sqlReady) {
        const sqlData = await loadFromSupabaseSql();
        if (sqlData && Object.keys(sqlData.rooms).length > 0) {
          db = ensureDbShape(sqlData);
        } else if (!cloudInitialized) {
          for (const u of Object.values(db.users || {})) {
            await syncUserToSupabaseSql(u);
          }
          for (const room of Object.values(db.rooms)) {
            await syncRoomToSupabaseSql(room);
          }
        }
      } else {
        const cloudData = await loadFromSupabaseStorage();
        if (cloudData && Object.keys(cloudData.rooms).length > 0) {
          db = ensureDbShape(cloudData);
        } else if (!cloudInitialized) {
          await syncToSupabaseStorage(JSON.stringify(db, null, 2));
        }
      }
      lastCloudSyncAt = Date.now();
      await writeLocalMirror(JSON.stringify(db, null, 2));
    } catch (err) {
      console.error('Supabase initial sync warning:', err.message);
    } finally {
      cloudInitialized = true;
      cloudInitPromise = null;
    }
  })();

  return cloudInitPromise;
}

if (hasSupabaseConfig()) {
  ensureCloudLoaded().catch(() => {});
}

async function writeLocalMirror(payload) {
  const tmpFile = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(tmpFile, payload, 'utf-8');
    await fs.promises.rename(tmpFile, DB_FILE);
  } catch (_) {
    try {
      if (fs.existsSync(tmpFile)) await fs.promises.unlink(tmpFile);
    } catch (_) {}
  }
}

// Persist changes to Supabase Database + Local atomic mirror
function persistDB(changedRoomCode = null, changedUserId = null) {
  const payload = JSON.stringify(db, null, 2);

  writeQueue = writeQueue
    .then(async () => {
      await writeLocalMirror(payload);
      if (hasSupabaseConfig()) {
        const sqlReady = await checkSupabaseSqlTables();
        if (sqlReady) {
          if (changedUserId && db.users[changedUserId]) {
            await syncUserToSupabaseSql(db.users[changedUserId]);
          }
          if (Array.isArray(changedRoomCode)) {
            for (const c of changedRoomCode) {
              if (c && db.rooms[c]) await syncRoomToSupabaseSql(db.rooms[c]);
            }
          } else if (changedRoomCode && db.rooms[changedRoomCode]) {
            await syncRoomToSupabaseSql(db.rooms[changedRoomCode]);
          }
        } else {
          await syncToSupabaseStorage(payload);
        }
        lastCloudSyncAt = Date.now();
      }
    })
    .catch((err) => {
      console.error('Error persisting DB:', err);
    });

  return writeQueue;
}

// Force push all users & rooms in db to Supabase (used by npm run db:push)
async function pushAllToSupabase() {
  if (!hasSupabaseConfig()) {
    throw new Error('Chưa cấu hình SUPABASE_URL và SUPABASE_SECRET_KEY trong .env');
  }
  const sqlReady = await checkSupabaseSqlTables(true);
  let mode = 'storage';
  if (sqlReady) {
    for (const user of Object.values(db.users || {})) {
      await syncUserToSupabaseSql(user);
    }
    for (const room of Object.values(db.rooms)) {
      await syncRoomToSupabaseSql(room);
    }
    mode = 'postgres_tables';
  }
  const storageOk = await syncToSupabaseStorage(JSON.stringify(db, null, 2));
  return {
    mode,
    sqlTablesReady: sqlReady,
    storageSynced: storageOk,
    userCount: Object.keys(db.users || {}).length,
    roomCodes: Object.keys(db.rooms)
  };
}

// ==================== USER ACCOUNTS REPOSITORY ====================

async function getUserById(id) {
  if (!id) return null;
  await ensureCloudLoaded();
  return db.users[id] || null;
}

async function getUserByUsername(username) {
  if (!username) return null;
  await ensureCloudLoaded();
  const target = String(username).trim().toLowerCase();
  return Object.values(db.users).find(u => u.username.toLowerCase() === target) || null;
}

async function createUser({ username, name, role, color, passwordHash }) {
  await ensureCloudLoaded();
  const cleanUsername = String(username).trim().toLowerCase();
  const existing = Object.values(db.users).find(u => u.username.toLowerCase() === cleanUsername);
  if (existing) {
    const err = new Error('Tên đăng nhập / Email này đã được đăng ký.');
    err.status = 409;
    throw err;
  }

  const cleanName = String(name).trim();
  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444'];
  const chosenColor = color || palette[Object.keys(db.users).length % palette.length];
  const now = new Date().toISOString();

  const newUser = {
    id: 'usr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    username: cleanUsername,
    name: cleanName,
    role: String(role || 'Thành viên').trim() || 'Thành viên',
    color: chosenColor,
    avatar: makeAvatar(cleanName),
    passwordHash,
    createdAt: now,
    updatedAt: now
  };

  db.users[newUser.id] = newUser;
  await persistDB(null, newUser.id);
  return newUser;
}

async function updateUserProfile(userId, { name, role, color }) {
  await ensureCloudLoaded();
  const user = db.users[userId];
  if (!user) return null;

  if (name && String(name).trim().length >= 2) {
    user.name = String(name).trim();
    user.avatar = makeAvatar(user.name);
  }
  if (role !== undefined) {
    user.role = String(role || '').trim() || 'Thành viên';
  }
  if (color) {
    user.color = color;
  }
  user.updatedAt = new Date().toISOString();

  const affectedRoomCodes = [];
  for (const room of Object.values(db.rooms)) {
    let changed = false;
    for (const m of room.members) {
      if (m.userId === userId) {
        m.name = user.name;
        m.role = user.role;
        m.color = user.color;
        m.avatar = user.avatar;
        m.updatedAt = user.updatedAt;
        changed = true;
      }
    }
    if (changed) affectedRoomCodes.push(room.code);
  }

  await persistDB(affectedRoomCodes, user.id);
  return { user, affectedRoomCodes };
}

async function listUserRooms(userId) {
  await ensureCloudLoaded();
  if (!userId) return [];
  return Object.values(db.rooms).filter(room =>
    Array.isArray(room.members) && room.members.some(m => m.userId === userId)
  );
}

async function getUserMemberInRoom(code, userId) {
  if (!code || !userId) return null;
  const room = await getRoom(code);
  if (!room) return null;
  return room.members.find(m => m.userId === userId) || null;
}

async function createGroupForUser(user, { code, name, description }) {
  await ensureCloudLoaded();
  let cleanCode = code ? normalizeRoomCode(code) : '';
  if (cleanCode) {
    if (db.rooms[cleanCode]) {
      const err = new Error(`Mã nhóm #${cleanCode} đã tồn tại. Bạn có thể chọn mã khác hoặc sang mục Tham gia nhóm.`);
      err.status = 409;
      throw err;
    }
  } else {
    do {
      cleanCode = generateRoomCode();
    } while (db.rooms[cleanCode]);
  }

  const roomName = String(name || '').trim() || `Nhóm của ${user.name}`;
  const now = new Date().toISOString();
  const founderMember = {
    id: 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    userId: user.id,
    name: user.name,
    role: user.role || 'Trưởng nhóm',
    color: user.color || '#6366f1',
    avatar: user.avatar || makeAvatar(user.name),
    updatedAt: now
  };

  const newRoom = {
    code: cleanCode,
    name: roomName,
    description: String(description || 'Nhóm đăng ký lịch làm việc & trò chuyện chung').trim(),
    createdBy: user.id,
    createdAt: now,
    workHours: { start: 7, end: 22 },
    members: [founderMember],
    schedules: {},
    messages: [
      {
        id: 'msg_welcome_' + Date.now(),
        memberId: 'system',
        memberName: 'Hệ thống',
        memberColor: '#64748b',
        memberAvatar: 'HT',
        type: 'system',
        text: `🎉 Nhóm "${roomName}" (#${cleanCode}) đã được tạo bởi ${user.name}! Hãy gửi mã #${cleanCode} hoặc link mời để các thành viên cùng vào trò chuyện chung.`,
        createdAt: now
      }
    ]
  };

  db.rooms[cleanCode] = newRoom;
  await persistDB(cleanCode);
  return { room: newRoom, member: founderMember };
}

async function joinGroupForUser(code, user) {
  await ensureCloudLoaded();
  const cleanCode = normalizeRoomCode(code);
  const room = db.rooms[cleanCode];
  if (!room) return null;

  let existing = room.members.find(m => m.userId === user.id);
  if (existing) {
    return { room, member: existing, isNew: false };
  }

  const now = new Date().toISOString();
  const newMember = {
    id: 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    userId: user.id,
    name: user.name,
    role: user.role || 'Thành viên',
    color: user.color || '#6366f1',
    avatar: user.avatar || makeAvatar(user.name),
    updatedAt: now
  };

  room.members.push(newMember);
  await persistDB(cleanCode);
  return { room, member: newMember, isNew: true };
}

// ==================== LEGACY / PUBLIC ROOMS INTERFACE ====================

async function listRooms() {
  await ensureCloudLoaded();
  return Object.values(db.rooms);
}

async function getRoom(code) {
  await ensureCloudLoaded();
  const cleanCode = normalizeRoomCode(code);
  return db.rooms[cleanCode] || null;
}

async function createRoom({ code, name, description }) {
  await ensureCloudLoaded();
  const cleanCode = normalizeRoomCode(code);
  if (!db.rooms[cleanCode]) {
    const roomName = String(name || '').trim() || `Nhóm ${cleanCode}`;
    db.rooms[cleanCode] = {
      code: cleanCode,
      name: roomName,
      description: String(description || 'Phòng báo lịch làm việc & tìm giờ trống nhóm').trim(),
      createdBy: null,
      createdAt: new Date().toISOString(),
      workHours: { start: 7, end: 22 },
      members: [],
      schedules: {},
      messages: [
        {
          id: 'msg_welcome_' + Date.now(),
          memberId: 'system',
          memberName: 'Hệ thống',
          memberColor: '#64748b',
          memberAvatar: 'HT',
          type: 'system',
          text: `Phòng "${roomName}" (${cleanCode}) đã được tạo! Hãy chọn hoặc thêm tên của bạn và báo lịch làm việc nhé.`,
          createdAt: new Date().toISOString()
        }
      ]
    };
    await persistDB(cleanCode);
  }
  return db.rooms[cleanCode];
}

async function listMembers(code) {
  const room = await getRoom(code);
  return room ? room.members : [];
}

async function upsertMember(code, { name, role, color, userId = null }) {
  await ensureCloudLoaded();
  const cleanCode = normalizeRoomCode(code);
  const room = await getRoom(cleanCode);
  if (!room) return null;

  const cleanName = String(name || '').trim();
  let existing = userId
    ? room.members.find(m => m.userId === userId)
    : room.members.find(m => !m.userId && m.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    if (cleanName) {
      existing.name = cleanName;
      existing.avatar = makeAvatar(cleanName);
    }
    if (role) existing.role = String(role).trim();
    if (color) existing.color = color;
    existing.updatedAt = new Date().toISOString();
    await persistDB(cleanCode);
    return { member: existing, isNew: false, room };
  }

  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'];
  const chosenColor = color || palette[room.members.length % palette.length];

  const newMember = {
    id: 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    userId: userId || null,
    name: cleanName,
    role: String(role || 'Thành viên').trim(),
    color: chosenColor,
    avatar: makeAvatar(cleanName),
    updatedAt: new Date().toISOString()
  };

  room.members.push(newMember);
  await persistDB(cleanCode);
  return { member: newMember, isNew: true, room };
}

async function getSchedule(code, memberId, weekKey) {
  const room = await getRoom(code);
  if (!room || !room.schedules || !room.schedules[weekKey]) return {};
  return room.schedules[weekKey][memberId] || {};
}

async function saveSchedule(code, memberId, weekKey, data) {
  await ensureCloudLoaded();
  const cleanCode = normalizeRoomCode(code);
  const room = await getRoom(cleanCode);
  if (!room) return null;

  if (!room.schedules[weekKey]) {
    room.schedules[weekKey] = {};
  }
  room.schedules[weekKey][memberId] = data || {};

  const member = room.members.find(m => m.id === memberId);
  if (member) {
    member.updatedAt = new Date().toISOString();
  }

  await persistDB(cleanCode);
  return {
    schedule: room.schedules[weekKey][memberId],
    member
  };
}

async function addMessage(code, msg) {
  await ensureCloudLoaded();
  const cleanCode = normalizeRoomCode(code);
  const room = await getRoom(cleanCode);
  if (!room) return null;

  room.messages.push(msg);
  if (room.messages.length > 250) {
    room.messages = room.messages.slice(-250);
  }
  await persistDB(cleanCode);
  return msg;
}

async function getMessages(code) {
  const room = await getRoom(code);
  return room ? room.messages : [];
}

async function updateProposalVote(code, msgId, memberId, voteMapUpdater) {
  await ensureCloudLoaded();
  const cleanCode = normalizeRoomCode(code);
  const room = await getRoom(cleanCode);
  if (!room) return null;

  const msg = room.messages.find(m => m.id === msgId && m.type === 'proposal' && m.proposal);
  if (!msg) return null;

  if (typeof voteMapUpdater === 'function') {
    msg.proposal.votes = voteMapUpdater(msg.proposal.votes || {});
  } else {
    if (!msg.proposal.votes) msg.proposal.votes = {};
    if (msg.proposal.votes[memberId] === voteMapUpdater) {
      delete msg.proposal.votes[memberId];
    } else {
      msg.proposal.votes[memberId] = voteMapUpdater;
    }
  }

  await persistDB(cleanCode);
  return msg;
}

module.exports = {
  getUserById,
  getUserByUsername,
  createUser,
  updateUserProfile,
  listUserRooms,
  getUserMemberInRoom,
  createGroupForUser,
  joinGroupForUser,
  listRooms,
  getRoom,
  createRoom,
  listMembers,
  upsertMember,
  getSchedule,
  saveSchedule,
  addMessage,
  getMessages,
  updateProposalVote,
  hasSupabaseConfig,
  checkSupabaseSqlTables,
  pushAllToSupabase
};
