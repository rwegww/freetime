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

    // User 2 previews group before joining (supports full Zalo invite URL/text)
    const pastedZaloInvite = `👋 Vào nhóm lịch nhé: https://freetime-olive.vercel.app/?room=${groupCode.toLowerCase()}`;
    const resPreviewFound = await fetch(
      `${baseUrl}/api/groups/preview?code=${encodeURIComponent(pastedZaloInvite)}`,
      { headers: { Authorization: `Bearer ${user2Token}` } }
    );
    assert.equal(resPreviewFound.status, 200);
    const previewFound = await resPreviewFound.json();
    assert.equal(previewFound.found, true);
    assert.equal(previewFound.code, groupCode);
    assert.equal(previewFound.name, 'Nhóm Đồ Án Chung');
    assert.equal(previewFound.memberCount, 1);
    assert.equal(previewFound.alreadyMember, false);

    const resPreviewMissing = await fetch(`${baseUrl}/api/groups/preview?code=KHONGTONTAI`, {
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    assert.equal(resPreviewMissing.status, 200);
    const previewMissing = await resPreviewMissing.json();
    assert.equal(previewMissing.found, false);

    // User 2 joins group even when pasting the full Zalo invite message!
    const resJoin = await fetch(`${baseUrl}/api/groups/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user2Token}`
      },
      body: JSON.stringify({ code: pastedZaloInvite })
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

  it('Hỗ trợ chế độ Serverless (Vercel): REST lưu lịch, nhắn tin & bình chọn không cần WebSocket', async () => {
    const serverlessApp = require('../api/index');
    const slServer = http.createServer(serverlessApp);
    await new Promise(r => slServer.listen(0, r));
    const slUrl = `http://localhost:${slServer.address().port}`;

    try {
      const resShim = await fetch(`${slUrl}/socket.io/socket.io.js`);
      assert.equal(resShim.status, 200);
      const shimJs = await resShim.text();
      assert.ok(shimJs.includes('__FREETIME_SERVERLESS__'));

      // REST schedule update on future week
      const resSched = await fetch(`${slUrl}/api/groups/${groupCode}/schedule`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user1Token}`
        },
        body: JSON.stringify({
          weekKey: '2099-01-05',
          schedule: { '0-9': { status: 'busy', note: 'Ca sáng Serverless' } }
        })
      });
      assert.equal(resSched.status, 200);
      const schedBody = await resSched.json();
      assert.equal(schedBody.schedule['0-9'].note, 'Ca sáng Serverless');

      // REST send proposal message
      const resMsg = await fetch(`${slUrl}/api/groups/${groupCode}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user1Token}`
        },
        body: JSON.stringify({
          type: 'proposal',
          text: 'Đề xuất họp Vercel',
          proposal: {
            title: 'Review Deploy',
            dayIndex: 0,
            dayName: 'Thứ 2',
            startHour: 9,
            endHour: 10,
            weekKey: '2099-01-05',
            votes: { [member1.id]: 'yes' }
          }
        })
      });
      assert.equal(resMsg.status, 201);
      const { message } = await resMsg.json();

      // REST vote proposal by User 2
      const resVote = await fetch(
        `${slUrl}/api/groups/${groupCode}/messages/${message.id}/vote`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user2Token}`
          },
          body: JSON.stringify({ vote: 'yes' })
        }
      );
      assert.equal(resVote.status, 200);
      const voted = await resVote.json();
      assert.equal(voted.message.proposal.votes[member2.id], 'yes');
    } finally {
      await new Promise(r => slServer.close(r));
    }
  });

  it('Hỗ trợ Google OAuth, tự gán màu đại diện mặc định và ghi nhớ phiên đăng nhập 365 ngày', async () => {
    const authService = require('../server/services/auth.service');
    const dbRepo = require('../server/repositories/db.repository');

    // 1. GET /api/auth/config returns public OAuth flags
    const resCfg = await fetch(`${baseUrl}/api/auth/config`);
    assert.equal(resCfg.status, 200);
    const cfgBody = await resCfg.json();
    assert.equal(typeof cfgBody.googleClientId, 'string');
    assert.equal(typeof cfgBody.supabaseGoogleEnabled, 'boolean');

    // 2. Remember-Me token TTL: 365 days vs 24 hours
    const tokRemember = authService.signToken(user1, { rememberMe: true });
    const tokSession = authService.signToken(user1, { rememberMe: false });
    const decodedRem = authService.verifyToken(tokRemember);
    const decodedSes = authService.verifyToken(tokSession);
    assert.equal(decodedRem.rem, true);
    assert.equal(decodedSes.rem, false);
    assert.ok(decodedRem.exp - Date.now() > 300 * 24 * 60 * 60 * 1000);
    assert.ok(decodedSes.exp - Date.now() <= 25 * 60 * 60 * 1000);

    // 3. Verify Google OAuth payload with mock Google verification endpoint + Google Avatar reuse
    const prevClientId = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = 'mock-client-id.apps.googleusercontent.com';
    try {
      const googlePhotoUrl = 'https://lh3.googleusercontent.com/a/colan-google-photo=s96-c';
      const mockFetch = async (url) => {
        if (String(url).includes('id_token=valid_google_jwt')) {
          return {
            ok: true,
            json: async () => ({
              aud: 'mock-client-id.apps.googleusercontent.com',
              sub: 'google_sub_999888',
              email: 'colan.google@gmail.com',
              email_verified: 'true',
              name: 'Cô Lan Google',
              picture: googlePhotoUrl
            })
          };
        }
        return { ok: false, json: async () => ({}) };
      };

      const verifiedProfile = await authService.verifyGoogleAuthPayload(
        { idToken: 'valid_google_jwt' },
        { fetchImpl: mockFetch }
      );
      assert.equal(verifiedProfile.email, 'colan.google@gmail.com');
      assert.equal(verifiedProfile.name, 'Cô Lan Google');
      assert.equal(verifiedProfile.picture, googlePhotoUrl);

      const firstLogin = await dbRepo.findOrCreateGoogleUser(verifiedProfile);
      assert.equal(firstLogin.isNewUser, true);
      assert.equal(firstLogin.user.avatar, googlePhotoUrl);
      assert.ok(firstLogin.user.color.startsWith('#'));

      // Updating display name keeps Google profile picture URL intact
      const renamed = await dbRepo.updateUserProfile(firstLogin.user.id, {
        name: 'Cô Lan Đã Đổi Tên'
      });
      assert.equal(renamed.user.name, 'Cô Lan Đã Đổi Tên');
      assert.equal(renamed.user.avatar, googlePhotoUrl);

      // Updating Google avatar URL on subsequent login syncs automatically
      const updatedPhotoUrl = 'https://lh3.googleusercontent.com/a/colan-google-photo-v2=s96-c';
      const secondLogin = await dbRepo.findOrCreateGoogleUser({
        ...verifiedProfile,
        picture: updatedPhotoUrl
      });
      assert.equal(secondLogin.isNewUser, false);
      assert.equal(secondLogin.user.id, firstLogin.user.id);
      assert.equal(secondLogin.user.avatar, updatedPhotoUrl);

      // Trying password login on Google-only account gives friendly guidance
      const resPwOnGoogle = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'colan.google@gmail.com',
          password: 'SomePassword123'
        })
      });
      assert.equal(resPwOnGoogle.status, 401);
      const pwErr = await resPwOnGoogle.json();
      assert.ok(pwErr.error.includes('Google'));
    } finally {
      if (prevClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = prevClientId;
    }
  });

  it('Hỗ trợ Share Link (/join/:code), chặn tham gia > 1 nhóm (409) và cho phép rời nhóm để đổi nhóm', async () => {
    // 1. Direct share link HTML route (/join/:code) & public invite preview
    const resJoinHtml = await fetch(`${baseUrl}/join/${groupCode}`);
    assert.equal(resJoinHtml.status, 200);
    const joinHtml = await resJoinHtml.text();
    assert.ok(joinHtml.includes('FreeTime Sync'));

    const resPublicInvite = await fetch(`${baseUrl}/api/auth/invite/${groupCode}`);
    assert.equal(resPublicInvite.status, 200);
    const pubInvite = await resPublicInvite.json();
    assert.equal(pubInvite.found, true);
    assert.equal(pubInvite.code, groupCode);
    assert.equal(pubInvite.name, 'Nhóm Đồ Án Chung');
    assert.equal(pubInvite.memberCount, 2);

    // 2. User 1 already belongs to groupCode -> creating a 2nd group is blocked (409)
    const resSecondCreate = await fetch(`${baseUrl}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`
      },
      body: JSON.stringify({ name: 'Nhóm Thứ Hai Bị Chặn' })
    });
    assert.equal(resSecondCreate.status, 409);
    const secondCreateErr = await resSecondCreate.json();
    assert.equal(secondCreateErr.code, 'ALREADY_IN_GROUP');
    assert.equal(secondCreateErr.currentRoom.code, groupCode);

    // 3. Outsider (0 groups) creates their own group -> 201
    const resOutsiderCreate = await fetch(`${baseUrl}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${outsiderToken}`
      },
      body: JSON.stringify({ name: 'Nhóm Riêng Của Outsider' })
    });
    assert.equal(resOutsiderCreate.status, 201);
    const outsiderGroup = (await resOutsiderCreate.json()).room;

    // 4. User 2 already belongs to groupCode -> joining outsiderGroup via share link is blocked (409)
    const shareLink = `https://freetime-olive.vercel.app/join/${outsiderGroup.code}`;
    const resSecondJoin = await fetch(`${baseUrl}/api/groups/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user2Token}`
      },
      body: JSON.stringify({ code: shareLink })
    });
    assert.equal(resSecondJoin.status, 409);
    const secondJoinErr = await resSecondJoin.json();
    assert.equal(secondJoinErr.code, 'ALREADY_IN_GROUP');
    assert.equal(secondJoinErr.currentRoom.code, groupCode);

    // 5. Re-joining own current group via share link is idempotent (200)
    const resSameJoin = await fetch(`${baseUrl}/api/groups/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user2Token}`
      },
      body: JSON.stringify({ code: `https://freetime-olive.vercel.app/join/${groupCode}` })
    });
    assert.equal(resSameJoin.status, 200);
    const sameJoined = await resSameJoin.json();
    assert.equal(sameJoined.isNew, false);

    // 6. Outsider leaves outsiderGroup -> now has 0 groups -> CAN join groupCode via /join/:code link!
    const resLeave = await fetch(`${baseUrl}/api/groups/${outsiderGroup.code}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${outsiderToken}` }
    });
    assert.equal(resLeave.status, 200);
    const leaveBody = await resLeave.json();
    assert.equal(leaveBody.ok, true);
    assert.equal(leaveBody.rooms.length, 0);

    const resJoinAfterLeave = await fetch(`${baseUrl}/api/groups/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${outsiderToken}`
      },
      body: JSON.stringify({ code: `https://freetime-olive.vercel.app/join/${groupCode}` })
    });
    assert.equal(resJoinAfterLeave.status, 200);
    const joinedAfterLeave = await resJoinAfterLeave.json();
    assert.equal(joinedAfterLeave.isNew, true);
    assert.equal(joinedAfterLeave.room.code, groupCode);
    assert.equal(joinedAfterLeave.room.members.length, 3);
  });
});
