const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeSlotAvailability,
  computeBestFreeBlocks,
  sanitizeScheduleData,
  enforceNoPastScheduleChanges
} = require('../server/services/availability.service');
const {
  toggleProposalVote,
  buildMemberMessage,
  buildSystemMessage
} = require('../server/services/proposal.service');
const {
  normalizeRoomCode,
  isValidRoomCode,
  makeAvatar
} = require('../server/utils/roomCode');

describe('Pure Services & Utils Unit Tests', () => {
  const members = [
    { id: 'm1', name: 'Minh Anh', role: 'Lead', color: '#6366f1', avatar: 'MA' },
    { id: 'm2', name: 'Hoàng Nam', role: 'Dev', color: '#10b981', avatar: 'HN' },
    { id: 'm3', name: 'Thu Hà', role: 'Design', color: '#f59e0b', avatar: 'TH' }
  ];

  const weekSchedules = {
    m1: {
      '0-8': { status: 'busy', note: 'Ca sáng' },
      '0-9': { status: 'busy', note: 'Ca sáng' }
    },
    m2: {
      '0-9': { status: 'busy', note: 'Họp kỹ thuật' }
    },
    m3: {}
  };

  it('computeSlotAvailability suy ra đúng thành viên rảnh và bận tại từng khung giờ', () => {
    // Thứ 2 lúc 08:00 (0-8): m1 bận, m2 & m3 rảnh -> 2/3 rảnh
    const slot8 = computeSlotAvailability(weekSchedules, members, 0, 8);
    assert.equal(slot8.total, 3);
    assert.equal(slot8.freeCount, 2);
    assert.equal(slot8.busyCount, 1);
    assert.equal(slot8.busyMembers[0].member.id, 'm1');
    assert.equal(slot8.busyMembers[0].note, 'Ca sáng');

    // Thứ 2 lúc 09:00 (0-9): m1 & m2 bận, m3 rảnh -> 1/3 rảnh
    const slot9 = computeSlotAvailability(weekSchedules, members, 0, 9);
    assert.equal(slot9.freeCount, 1);
    assert.equal(slot9.busyCount, 2);

    // Thứ 2 lúc 10:00 (0-10): Cả 3 người đều rảnh -> 3/3 rảnh (100%)
    const slot10 = computeSlotAvailability(weekSchedules, members, 0, 10);
    assert.equal(slot10.freeCount, 3);
    assert.equal(slot10.busyCount, 0);
    assert.equal(slot10.ratio, 1);
  });

  it('computeBestFreeBlocks tìm đúng các khoảng thời gian rảnh liên tiếp của nhóm', () => {
    const blocks = computeBestFreeBlocks(weekSchedules, members, 8, 12);
    // Ngày 0 (Thứ 2): 8h và 9h có người bận, 10h-12h (2 tiếng) cả 3 đều rảnh
    const mondayBlock = blocks.find(b => b.dayIndex === 0);
    assert.ok(mondayBlock);
    assert.equal(mondayBlock.startHour, 10);
    assert.equal(mondayBlock.endHour, 12);
    assert.equal(mondayBlock.duration, 2);
  });

  it('sanitizeScheduleData lọc bỏ dữ liệu không hợp lệ và chuẩn hóa ghi chú', () => {
    const cleaned = sanitizeScheduleData({
      '0-8': { status: 'busy', note: '  Trực ca sáng  ' },
      '0-9': { status: 'free' },
      '0-10': null
    });
    assert.deepEqual(cleaned, {
      '0-8': { status: 'busy', note: 'Trực ca sáng' }
    });
  });

  it('toggleProposalVote thêm, đổi và hủy phiếu bình chọn đúng cách', () => {
    let votes = {};
    votes = toggleProposalVote(votes, 'm1', 'yes');
    assert.equal(votes.m1, 'yes');

    // Nhấn lại cùng lựa chọn sẽ hủy vote
    votes = toggleProposalVote(votes, 'm1', 'yes');
    assert.equal(votes.m1, undefined);

    // Đổi từ yes sang no
    votes = toggleProposalVote({ m1: 'yes' }, 'm1', 'no');
    assert.equal(votes.m1, 'no');
  });

  it('buildMemberMessage và buildSystemMessage tạo đúng cấu trúc tin nhắn', () => {
    const msg = buildMemberMessage({
      member: members[0],
      text: '  Xin chào nhóm!  ',
      type: 'text'
    });
    assert.ok(msg.id.startsWith('msg_'));
    assert.equal(msg.memberName, 'Minh Anh');
    assert.equal(msg.text, 'Xin chào nhóm!');

    const sys = buildSystemMessage('Phòng mới được tạo');
    assert.equal(sys.type, 'system');
    assert.equal(sys.memberId, 'system');
  });

  it('roomCode utils chuẩn hóa mã phòng và tạo avatar viết tắt chuẩn', () => {
    assert.equal(normalizeRoomCode('  team 01! '), 'TEAM01');
    assert.equal(isValidRoomCode('TEAM01'), true);
    assert.equal(isValidRoomCode('AB'), false);
    assert.equal(makeAvatar('Nguyễn Văn An'), 'NA');
    assert.equal(makeAvatar('Minh'), 'MI');
  });

  it('enforceNoPastScheduleChanges chặn đăng ký vào ngày đã qua và giữ nguyên từ hôm nay trở đi', () => {
    const fakeToday = new Date(2026, 10, 6, 10, 0, 0); // Thứ 6 ngày 06/11/2026 (dayIndex = 4)
    const existing = {
      '0-8': { status: 'busy', note: 'Ca cũ Thứ 2' }
    };
    const incoming = {
      '1-9': { status: 'busy', note: 'Cố tình đăng ký Thứ 3 đã qua' },
      '4-14': { status: 'busy', note: 'Ca chiều Thứ 6 hôm nay' },
      '5-9': { status: 'busy', note: 'Ca sáng Thứ 7 ngày mai' }
    };

    const result = enforceNoPastScheduleChanges(existing, incoming, '2026-11-02', fakeToday);
    assert.deepEqual(result, {
      '0-8': { status: 'busy', note: 'Ca cũ Thứ 2' },
      '4-14': { status: 'busy', note: 'Ca chiều Thứ 6 hôm nay' },
      '5-9': { status: 'busy', note: 'Ca sáng Thứ 7 ngày mai' }
    });
  });
});

