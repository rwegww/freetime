const dbRepo = require('../server/repositories/db.repository');

async function main() {
  console.log('🚀 Đang đẩy dữ liệu lên Supabase...');
  const result = await dbRepo.pushAllToSupabase();
  console.log('✅ Đã đẩy dữ liệu lên Supabase thành công:', result);

  const rooms = await dbRepo.listRooms();
  console.log(`📦 Đang sử dụng dữ liệu từ Supabase (${rooms.length} phòng):`, rooms.map(r => r.code));
}

main().catch((err) => {
  console.error('❌ Lỗi khi đẩy dữ liệu lên Supabase:', err.message);
  process.exit(1);
});

