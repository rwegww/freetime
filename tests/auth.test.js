const fs = require('fs');
const path = require('path');

if (!('SUPABASE_URL' in process.env)) {
  process.env.SUPABASE_URL = '';
}
if (!('DB_PATH' in process.env)) {
  process.env.DB_PATH = './data/test-auth-db.json';
}

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Server } = require('socket.io');
const { createApp } = require('../server/app');
const { initSockets } = require('../server/sockets');

function connectSocketClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/socket.io/?EIO=4&transport=websocket`);
    const listeners = {};

    ws.onmessage = (event) => {
      const data = String(event.data);
      if (data.startsWith('0')) {
        ws.send('40');
        return;
      }
      if (data === '2') {
        ws.send('3');
        return;
      }
      if (data.startsWith('40')) {
        resolve({
          emit(eventName, payload) {
            ws.send(`42${JSON.stringify([eventName, payload])}`);
          },
          on(eventName, cb) {
            if (!listeners[eventName]) listeners[eventName] = [];
            listeners[eventName].push(cb);
          },
          waitFor(eventName, timeoutMs = 4000) {
            return new Promise((res, rej) => {
              const handler = (payload) => {
                clearTimeout(timer);
                listeners[eventName] = (listeners[eventName] || []).filter(fn => fn !== handler);
                res(payload);
              };
              const timer = setTimeout(() => {
                listeners[eventName] = (listeners[eventName] || []).filter(fn => fn !== handler);
                rej(new Error(`Timeout waiting for event: ${eventName}`));
              }, timeoutMs);
              this.on(eventName, handler);
            });
          },
          close() {
            ws.close();
          }
        });
        return;
      }
      if (data.startsWith('42')) {
        try {
          const [eventName, payload] = JSON.parse(data.slice(2));
          if (listeners[eventName]) {
            listeners[eventName].forEach(fn => fn(payload));
          }
        } catch (_) {}
      }
    };

    ws.onerror = (err) => reject(err);
  });
}

describe('Auth, Groups & Shared Group Chat Integration Tests', () => {
  let server;
  let io;
  let port;
  let baseUrl;

  let user1Token;
  let user1;
  let user2Token;
  let user2;
  let outsiderToken;
  let groupCode;
  let member1;
  let member2;

  before(async () => {
    const app = createApp();
    server = http.createServer(app);
    io = new Server(server, { cors: { origin: '*' } });
    initSockets(io);

    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    if (io) io.close();
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    const tmpFile = path.resolve(process.cwd(), './data/test-auth-db.json');
    if (fs.existsSync(tmpFile)) {
      try {
        fs.unlinkSync(tmpFile);
      } catch (_) {}
    }
  });

  it('Đăng ký tài khoản mới, chặn trùng username và đăng nhập thành công', async () => {
    const suffix = Date.now().toString(36);
    const u1Username = `tuankiet_${suffix}`;
    const u2Username = `baongoc_${suffix}@company.com`;
    const u3Username = `outsider_${suffix}`;

    const resReg1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Nguyễn Tuấn Kiệt',
        username: u1Username,
        password: 'Password123',
        role: 'Team Lead',
        color: '#6366f1'
      })
    });
    assert.equal(resReg1.status, 201);
    const data1 = await resReg1.json();
    assert.ok(data1.token);
    assert.equal(data1.user.name, 'Nguyễn Tuấn Kiệt');
    assert.equal(data1.user.avatar, 'NK');
    assert.equal(data1.user.passwordHash, undefined);
    user1Token = data1.token;
    user1 = data1.user;

    // Duplicate username should return 409
    const resDup = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Người Khác',
        username: u1Username.toUpperCase(),
        password: 'Password123'
      })
    });
    assert.equal(resDup.status, 409);

    // Wrong password login should return 401
    const resWrongPw = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u1Username, password: 'WrongPassword' })
    });
    assert.equal(resWrongPw.status, 401);

    // Correct login should return 200
    const resLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u1Username, password: 'Password123' })
    });
    assert.equal(resLogin.status, 200);
    const loginData = await resLogin.json();
    assert.equal(loginData.user.id, user1.id);

    // Register User 2 & Outsider User 3
    const resReg2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lê Bảo Ngọc',
        username: u2Username,
        password: 'Password456',
        role: 'Designer',
        color: '#10b981'
      })
    });
    assert.equal(resReg2.status, 201);
    const data2 = await resReg2.json();
    user2Token = data2.token;
    user2 = data2.user;

    const resReg3 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Người Ngoài Nhóm',
        username: u3Username,
        password: 'Password789'
      })
    });
    assert.equal(resReg3.status, 201);
    outsiderToken = (await resReg3.json()).token;
  });

  it('Tạo nhóm mới, chặn người chưa tham gia xem nhóm (403), và cho phép thành viên thứ 2 tham gia bằng mã mời', async () => {
    const resCreate = await fetch(`${baseUrl}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`
      },
      body: JSON.stringify({
        name: 'Nhóm Đồ Án Chung',
        description: 'Không gian làm việc chung'
      })
    });
    assert.equal(resCreate.status, 201);
    const created = await resCreate.json();
    assert.ok(created.room.code.startsWith('FT'));
    assert.equal(created.room.name, 'Nhóm Đồ Án Chung');
    assert.equal(created.member.userId, user1.id);
    groupCode = created.room.code;
    member1 = created.member;

    // User 2 has NOT joined yet -> GET /api/groups/:code returns 403
    const resForbidden = await fetch(`${baseUrl}/api/groups/${groupCode}`, {
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    assert.equal(resForbidden.status, 403);
    const forbiddenBody = await resForbidden.json();
    assert.equal(forbiddenBody.canJoin, true);

    // User 2 joins group by invite code
    const resJoin = await fetch(`${baseUrl}/api/groups/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user2Token}`
      },
      body: JSON.stringify({ code: groupCode })
    });
    assert.equal(resJoin.status, 200);
    const joined = await resJoin.json();
    assert.equal(joined.isNew, true);
    assert.equal(joined.room.members.length, 2);
    member2 = joined.member;
    assert.equal(member2.userId, user2.id);

    // Outsider still has 0 groups
    const resOutsiderGroups = await fetch(`${baseUrl}/api/groups`, {
      headers: { Authorization: `Bearer ${outsiderToken}` }
    });
    const outsiderGroups = await resOutsiderGroups.json();
    assert.equal(outsiderGroups.rooms.length, 0);
  });

  it('Những người chung nhóm vào cùng cuộc trò chuyện thời gian thực; người ngoài nhóm bị từ chối gửi tin nhắn', async () => {
    const client1 = await connectSocketClient(port);
    const client2 = await connectSocketClient(port);
    const clientOutsider = await connectSocketClient(port);

    try {
      const onlineReady = new Promise((resolve) => {
        client1.on('online_users', (ids) => {
          if (ids.includes(member1.id) && ids.includes(member2.id)) {
            resolve(ids);
          }
        });
      });

      client1.emit('join_room', { roomCode: groupCode, memberId: member1.id, token: user1Token });
      client2.emit('join_room', { roomCode: groupCode, memberId: member2.id, token: user2Token });
      const onlineIds = await onlineReady;
      assert.equal(onlineIds.length, 2);

      // User 1 sends message -> User 2 receives it in shared group chat
      const msgForUser2 = client2.waitFor('new_message');
      client1.emit('send_message', {
        roomCode: groupCode,
        memberId: member1.id,
        token: user1Token,
        type: 'text',
        text: 'Chào Bảo Ngọc, chào mừng vào nhóm chung nhé!'
      });
      const received = await msgForUser2;
      assert.equal(received.memberName, 'Nguyễn Tuấn Kiệt');
      assert.equal(received.text, 'Chào Bảo Ngọc, chào mừng vào nhóm chung nhé!');

      // Outsider attempts to join & send message into groupCode -> ignored by server
      clientOutsider.emit('join_room', {
        roomCode: groupCode,
        memberId: 'fake_member',
        token: outsiderToken
      });
      clientOutsider.emit('send_message', {
        roomCode: groupCode,
        memberId: member1.id,
        token: outsiderToken,
        type: 'text',
        text: 'Tin nhắn giả mạo từ người ngoài nhóm'
      });

      await new Promise((r) => setTimeout(r, 250));

      const resDetail = await fetch(`${baseUrl}/api/groups/${groupCode}`, {
        headers: { Authorization: `Bearer ${user1Token}` }
      });
      assert.equal(resDetail.status, 200);
      const detail = await resDetail.json();
      const hasIntruderMsg = detail.room.messages.some(m =>
        m.text.includes('Tin nhắn giả mạo')
      );
      assert.equal(hasIntruderMsg, false);
    } finally {
      client1.close();
      client2.close();
      clientOutsider.close();
    }
  });
});
