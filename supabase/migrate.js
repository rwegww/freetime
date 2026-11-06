// Tạo các bảng PostgreSQL trên Supabase từ supabase/schema.sql
// Cần biến DATABASE_URL trong .env (Dashboard → Connect → Connection string)
const fs = require('fs');
const path = require('path');
require('../server/config'); // nạp .env vào process.env
const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Chưa cấu hình DATABASE_URL trong .env');
  }

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

  await client.connect();
  try {
    console.log('Đang tạo bảng trên Supabase PostgreSQL...');
    await client.query(sql);
    // Yêu cầu PostgREST nạp lại schema cache để REST API thấy bảng mới ngay
    await client.query("NOTIFY pgrst, 'reload schema'");

    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('users','rooms','members','schedules','messages')
       ORDER BY table_name`
    );
    console.log('Đã tạo xong các bảng:', rows.map(r => r.table_name).join(', '));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Lỗi migrate:', err.message);
  process.exit(1);
});
