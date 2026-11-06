/**
 * Pure function: Cập nhật/đảo trạng thái bình chọn trên thẻ đề xuất giờ hẹn
 */
function toggleProposalVote(currentVotes = {}, memberId, vote) {
  const nextVotes = { ...currentVotes };
  if (!memberId || !vote) return nextVotes;

  if (nextVotes[memberId] === vote) {
    delete nextVotes[memberId];
  } else {
    nextVotes[memberId] = vote;
  }
  return nextVotes;
}

/**
 * Pure function: Tạo đối tượng tin nhắn của thành viên (text hoặc proposal)
 */
function buildMemberMessage({ member, text, type = 'text', proposal = null, now = new Date() }) {
  if (!member) return null;
  const cleanText = String(text || '').trim();
  if (!cleanText && type !== 'proposal') return null;

  return {
    id: 'msg_' + now.getTime() + '_' + Math.random().toString(36).slice(2, 6),
    memberId: member.id,
    memberName: member.name,
    memberColor: member.color,
    memberAvatar: member.avatar,
    type: type || 'text',
    text: cleanText,
    proposal: proposal || null,
    createdAt: now.toISOString()
  };
}

/**
 * Pure function: Tạo đối tượng tin nhắn hệ thống
 */
function buildSystemMessage(text, now = new Date()) {
  return {
    id: 'msg_' + now.getTime() + '_' + Math.random().toString(36).slice(2, 5),
    memberId: 'system',
    memberName: 'Hệ thống',
    memberColor: '#64748b',
    memberAvatar: 'HT',
    type: 'system',
    text: String(text || '').trim(),
    createdAt: now.toISOString()
  };
}

module.exports = {
  toggleProposalVote,
  buildMemberMessage,
  buildSystemMessage
};

