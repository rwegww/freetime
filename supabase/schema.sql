-- ============================================================================
-- FreeTime Sync — Supabase PostgreSQL Schema
-- ============================================================================

-- 0. Bảng Tài khoản người dùng (users)
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Thành viên',
  color TEXT NOT NULL DEFAULT '#6366f1',
  avatar TEXT NOT NULL DEFAULT 'TV',
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON public.users (LOWER(username));

-- 1. Bảng Phòng / Nhóm làm việc (rooms)
CREATE TABLE IF NOT EXISTS public.rooms (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_by TEXT,
  work_hours JSONB NOT NULL DEFAULT '{"start": 7, "end": 22}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS created_by TEXT;

-- 2. Bảng Thành viên trong phòng (members)
CREATE TABLE IF NOT EXISTS public.members (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES public.rooms(code) ON DELETE CASCADE,
  user_id TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Thành viên',
  color TEXT NOT NULL DEFAULT '#6366f1',
  avatar TEXT NOT NULL DEFAULT 'TV',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_members_room_code ON public.members(room_code);
CREATE INDEX IF NOT EXISTS idx_members_user_id ON public.members(user_id);

-- 3. Bảng Lịch làm việc theo tuần của từng thành viên (schedules)
CREATE TABLE IF NOT EXISTS public.schedules (
  room_code TEXT NOT NULL REFERENCES public.rooms(code) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_code, member_id, week_key)
);

CREATE INDEX IF NOT EXISTS idx_schedules_room_week ON public.schedules(room_code, week_key);

-- 4. Bảng Tin nhắn trao đổi & Thẻ đề xuất giờ hẹn (messages)
CREATE TABLE IF NOT EXISTS public.messages (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES public.rooms(code) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  member_color TEXT NOT NULL DEFAULT '#64748b',
  member_avatar TEXT NOT NULL DEFAULT 'TV',
  type TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL DEFAULT '',
  proposal JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created ON public.messages(room_code, created_at);

-- 5. Bật Row Level Security: chặn truy cập trực tiếp bằng publishable key.
-- Server dùng SUPABASE_SECRET_KEY nên vẫn đọc/ghi bình thường.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
