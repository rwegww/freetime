# 📅 FreeTime Sync — Trang Web Đăng Ký Lịch Làm Việc, Suy Ra Giờ Trống & Nhắn Tin Nhóm

Ứng dụng web **Fullstack thời gian thực (Real-time)** được thiết kế theo kiến trúc phân lớp (Layered Architecture) giúp các thành viên trong nhóm đăng ký lịch làm việc hàng tuần, từ đó hệ thống **tự động suy ra các khung giờ trống chung** của cả nhóm và hỗ trợ **nhắn tin trao đổi, bình chọn chốt lịch hẹn** ngay trên cùng một màn hình.

---

## 🏗️ Kiến trúc & Cấu trúc thư mục

Dự án được tổ chức theo mô hình phân lớp rõ ràng (**Routes → Controllers → Services → Repositories** ở Backend và **ES Modules** ở Frontend), sẵn sàng chuyển đổi từ `data/db.json` sang SQLite hoặc PostgreSQL chỉ bằng cách thay thế tầng `repositories`:

```text
freetime/
├── package.json
├── .env.example            # Cấu hình mẫu (PORT, DB_PATH)
├── .gitignore              # Bỏ qua node_modules, .env, data/
├── README.md
├── data/db.json            # Dữ liệu JSON (ghi an toàn qua atomic temp file + write queue)
├── server/
│   ├── index.js            # Khởi động HTTP Server + Socket.IO
│   ├── app.js              # Tạo Express app, gắn middleware, routes, static
│   ├── config/index.js     # Đọc biến môi trường (PORT, DB_PATH) có giá trị mặc định
│   ├── routes/             # Khai báo đường dẫn API (index.js, rooms.routes.js, members.routes.js)
│   ├── controllers/        # Nhận request, gọi service/repository (rooms.controller.js, members.controller.js)
│   ├── services/           # Hàm thuần chứa logic nghiệp vụ (availability.service.js, proposal.service.js)
│   ├── repositories/       # Nơi duy nhất đọc/ghi db.json (db.repository.js)
│   ├── sockets/            # Xử lý sự kiện thời gian thực (index.js, schedule.handler.js, chat.handler.js)
│   ├── middlewares/        # Xử lý lỗi tập trung (errorHandler.js)
│   └── utils/roomCode.js   # Chuẩn hóa mã phòng, tạo avatar, tính ngày đầu tuần
├── public/
│   ├── index.html          # Giao diện 2 phần chính: (1) Đăng Ký Lịch & (2) Nhắn Tin Nhóm
│   ├── css/                # Tách biệt style (base.css, calendar.css, chat.css)
│   └── js/                 # Tách biệt ES Modules (main.js, state.js, api.js, socket.js, calendar.js, availability.js, chat.js, utils.js)
└── tests/                  # Bộ kiểm thử tự động (availability.test.js, api.test.js, socket.test.js)
```

---

## ✨ Tính năng chính

- **Đăng ký & Đăng nhập tài khoản cá nhân**: Bảo mật mật khẩu bằng `scrypt` + token ký số `HMAC-SHA256`.
- **Tạo nhóm & Tham gia nhóm qua mã mời / link mời**: Chỉ các thành viên chung nhóm mới xem được lịch và tham gia cuộc trò chuyện chung của nhóm đó.
- **Đăng ký lịch làm việc theo từng ô giờ**: Click trực tiếp để chọn/bỏ chọn giờ bận (tự động khóa các ngày đã qua), tự động suy ra các khung giờ cả nhóm cùng trống.
- **Trò chuyện nhóm & Bình chọn chốt giờ hẹn thời gian thực** qua `Socket.IO`, tối ưu đa thiết bị (Desktop, Tablet, Mobile).
- **Hỗ trợ Supabase PostgreSQL** (`supabase/schema.sql`, `npm run db:migrate`) hoặc chạy độc lập với JSON cục bộ (`data/db.json`).

---

## 🚀 Hướng dẫn chạy và kiểm thử

1. **Cài đặt thư viện**:
   ```bash
   npm install
   ```

2. **(Tùy chọn) Kết nối Supabase PostgreSQL**:
   Sao chép `.env.example` thành `.env`, điền thông tin kết nối rồi khởi tạo bảng:
   ```bash
   npm run db:migrate
   ```

3. **Chạy bộ kiểm thử tự động (Unit + REST API + Auth + Socket.IO)**:
   ```bash
   npm test
   ```

4. **Khởi động Server**:
   ```bash
   npm start
   ```
   Mở trình duyệt tại địa chỉ: `http://localhost:3000`
