const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../server/app');

describe('REST API & Static Assets Integration Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('Phục vụ giao diện tĩnh gồm 2 phần chính và các file CSS/JS đã tách module', async () => {
    const resHtml = await fetch(`${baseUrl}/`);
    assert.equal(resHtml.status, 200);
    const html = await resHtml.text();
    assert.ok(html.includes('PHẦN 1'), 'index.html phải có PHẦN 1: Đăng Ký Lịch');
    assert.ok(html.includes('PHẦN 2'), 'index.html phải có PHẦN 2: Nhắn Tin Nhóm');

    for (const asset of ['/css/base.css', '/css/calendar.css', '/css/chat.css', '/js/main.js']) {
      const resAsset = await fetch(`${baseUrl}${asset}`);
      assert.equal(resAsset.status, 200, `Asset ${asset} phải trả về 200`);
    }
  });

  it('GET /api/rooms và GET /api/rooms/TEAM01 trả về dữ liệu phòng mẫu', async () => {
    const resList = await fetch(`${baseUrl}/api/rooms`);
    assert.equal(resList.status, 200);
    const listData = await resList.json();
    assert.ok(Array.isArray(listData.rooms));
    assert.ok(listData.rooms.some(r => r.code === 'TEAM01'));

    const resTeam = await fetch(`${baseUrl}/api/rooms/TEAM01`);
    assert.equal(resTeam.status, 200);
    const teamData = await resTeam.json();
    assert.equal(teamData.room.code, 'TEAM01');
    assert.ok(teamData.room.members.length >= 3);
  });

  it('POST /api/rooms và POST /api/rooms/:code/members tạo phòng và thêm thành viên mới', async () => {
    const roomCode = 'API_' + Math.floor(1000 + Math.random() * 9000);

    const resCreate = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCode, name: 'Phòng Test API' })
    });
    assert.equal(resCreate.status, 200);
    const createdData = await resCreate.json();
    assert.equal(createdData.room.code, roomCode);
    assert.equal(createdData.room.name, 'Phòng Test API');

    const resMember = await fetch(`${baseUrl}/api/rooms/${roomCode}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lê Minh Tuấn', role: 'Fullstack', color: '#10b981' })
    });
    assert.equal(resMember.status, 200);
    const memberData = await resMember.json();
    assert.equal(memberData.member.name, 'Lê Minh Tuấn');
    assert.equal(memberData.member.avatar, 'LT');
  });
});

