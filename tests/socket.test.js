const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Server } = require('socket.io');
const { createApp } = require('../server/app');
const { initSockets } = require('../server/sockets');
const { computeSlotAvailability } = require('../server/services/availability.service');

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

describe('Real-time Socket.IO Handlers Tests', () => {
  let server;
  let io;
  let port;
  let baseUrl;
  let roomCode;
  let memberA;
  let memberB;

  before(async () => {
    const app = createApp();
    server = http.createServer(app);
    io = new Server(server, { cors: { origin: '*' } });
    initSockets(io);

    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    roomCode = 'SOCK_' + Math.floor(1000 + Math.random() * 9000);
    await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCode, name: 'Phòng Test Socket' })
    });

    const resA = await fetch(`${baseUrl}/api/rooms/${roomCode}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nguyễn Văn A', role: 'Dev' })
    });
    memberA = (await resA.json()).member;

    const resB = await fetch(`${baseUrl}/api/rooms/${roomCode}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Trần Thị B', role: 'Tester' })
    });
    memberB = (await resB.json()).member;
  });

  after(async () => {
    if (io) io.close();
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('Đồng bộ đăng ký lịch làm việc thời gian thực (update_schedule -> schedule_updated) & suy ra giờ trống', async () => {
    const clientA = await connectSocketClient(port);
    const clientB = await connectSocketClient(port);

    try {
      const joinReady = clientB.waitFor('online_users');
      clientA.emit('join_room', { roomCode, memberId: memberA.id });
      clientB.emit('join_room', { roomCode, memberId: memberB.id });
      await joinReady;

      const weekKey = '2026-11-02';
      const schedPromise = clientB.waitFor('schedule_updated');
      clientA.emit('update_schedule', {
        roomCode,
        memberId: memberA.id,
        weekKey,
        schedule: {
          '0-8': { status: 'busy', note: 'Ca sáng A' }
        }
      });

      const updated = await schedPromise;
      assert.equal(updated.memberId, memberA.id);
      assert.equal(updated.schedule['0-8'].note, 'Ca sáng A');

      const resRoom = await fetch(`${baseUrl}/api/rooms/${roomCode}`);
      const { room } = await resRoom.json();
      const slot8 = computeSlotAvailability(room.schedules[weekKey], room.members, 0, 8);
      assert.equal(slot8.freeCount, 1);
      assert.equal(slot8.busyCount, 1);
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  it('Nhắn tin trao đổi nhóm & bình chọn chốt giờ hẹn thời gian thực (send_message & vote_proposal)', async () => {
    const clientA = await connectSocketClient(port);
    const clientB = await connectSocketClient(port);

    try {
      const joinReady = clientB.waitFor('online_users');
      clientA.emit('join_room', { roomCode, memberId: memberA.id });
      clientB.emit('join_room', { roomCode, memberId: memberB.id });
      await joinReady;

      const msgPromise = clientB.waitFor('new_message');
      clientA.emit('send_message', {
        roomCode,
        memberId: memberA.id,
        type: 'text',
        text: 'Họp lúc 10h sáng thứ 2 nhé!'
      });

      const msg = await msgPromise;
      assert.equal(msg.memberName, 'Nguyễn Văn A');
      assert.ok(msg.text.includes('10h'));

      const propPromise = clientB.waitFor('new_message');
      clientA.emit('send_message', {
        roomCode,
        memberId: memberA.id,
        type: 'proposal',
        text: 'Đề xuất họp 10h',
        proposal: {
          title: 'Họp Sprint',
          dayIndex: 0,
          dayName: 'Thứ 2',
          startHour: 10,
          endHour: 11,
          weekKey: '2026-11-02',
          votes: { [memberA.id]: 'yes' }
        }
      });

      const propMsg = await propPromise;
      assert.equal(propMsg.type, 'proposal');

      const votePromise = clientA.waitFor('message_updated');
      clientB.emit('vote_proposal', {
        roomCode,
        messageId: propMsg.id,
        memberId: memberB.id,
        vote: 'yes'
      });

      const votedMsg = await votePromise;
      assert.equal(votedMsg.proposal.votes[memberA.id], 'yes');
      assert.equal(votedMsg.proposal.votes[memberB.id], 'yes');
    } finally {
      clientA.close();
      clientB.close();
    }
  });
});

