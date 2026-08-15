# UMBO MILK – AI Recruitment & Training System

Hệ thống tuyển dụng & đào tạo nhân sự UMBO MILK: **Web là giao diện vận hành chính**, Node.js backend chứa toàn bộ nghiệp vụ (Auth, AI Scoring, Sync Engine, Training, Attendance, Zalo), và **Google Sheets là bản sao dữ liệu 1:1** theo thời gian thực.

---

## Kiến trúc tổng quan

```
Nhân sự ──► Web (React) ──► Node.js Backend (Express + Socket.IO)
                                      │
                              Business Logic
           ┌──────────────┬──────────┼──────────┬─────────────┐
           │  Auth/JWT    │ AI Score │ Training │ Attendance  │
           └──────────────┴──────────┴──────────┴─────────────┘
                                      │
                               Sync Engine (Worker)
                    ┌────────────────┼─────────────────┐
                    │ Persistent Queue (DB)            │
                    │ Idempotency · Retry · Verify     │
                    └────────────────┼─────────────────┘
                                      ▼
                        Google Sheets (mirror 1:1)
```

- **Web ↔ Sheet = 1:1** — không miss, không duplicate; mỗi thay đổi trên Web tạo 1 Sync Job → Sheet; Sheet sửa qua Apps Script → Webhook → Conflict detection.
- Node.js chịu **mọi** logic: không phụ thuộc Google Apps Script.
- Realtime: Socket.IO push `candidate:updated`, `sync:update`, `attendance:checked`, `zalo:status` lên Web ngay khi có thay đổi.

## Công nghệ

| Layer | Công nghệ |
|---|---|
| Backend | Node.js 20+, Express 4, TypeScript, Prisma ORM, Socket.IO |
| Database | SQLite (dev) — chuyển PostgreSQL bằng cách đổi `DATABASE_URL` + `prisma db push` |
| Frontend | React 18, Vite 6, TailwindCSS 3, Recharts |
| AI | Provider abstraction: `mock` / `openai` / `gemini` / `openai-compatible` |
| Auth | Session cookie `httpOnly` (DB-backed), rate limit, RBAC (ADMIN / HR / VIEWER) |

## Cài đặt & chạy

```bash
npm install                # cài cả server + client (npm workspaces)
npm run db:push            # tạo database theo Prisma schema
npm run db:seed            # seed tài khoản mặc định
npm run dev                # chạy đồng thời server (:3000) + client (:5173)
```

Sản phẩm:

```bash
npm run build              # build server + client
npm start                  # chạy server production (serves client/dist nếu có)
```

Test tự động (E2E, 38 case):

```bash
npm test                   # = test ở workspace server
```

## Tài khoản mặc định

| Username | Password | Vai trò |
|---|---|---|
| `admin` | `admin123` | ADMIN |
| `hr_umbomilk` | `hr123456` | HR |
| `viewer` | `view1234` | VIEWER (chỉ xem) |

## Cấu hình (.env)

Copy `server/.env.example` → `server/.env`:

```env
# Server
PORT=3000
DATABASE_URL=file:./dev.db          # hoặc postgresql://...
WEBHOOK_SECRET=dev-webhook-secret   # bảo vệ /api/webhooks/*

# Google Sheets (bỏ trống = DEMO MODE: dữ liệu đầy đủ trong DB, job đánh SYNCED)
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=

# AI Scoring (mock = chấm điểm theo quy tắc cục bộ, không cần API key)
AI_PROVIDER=mock
AI_API_KEY=
AI_MODEL=

# Zalo (bỏ trống = không gửi tin)
ZALO_OA_ACCESS_TOKEN=
```

### Google Sheets (khi bật thật)

1. Tạo Google Sheet với 3 tab: `LOC_HO_SO_PV`, `DIEM_UV`, `HO_SO_NV` (cột header tự động map theo tên cột, phải có `CANDIDATE_ID`).
2. Tạo Service Account, share sheet cho email service account, điền 3 biến `GOOGLE_*` ở trên.
3. Bật **Google Apps Script** trên Sheet, dùng Webhook URL sau cho `onEdit`/trigger:
   ```
   POST {SERVER}/api/webhooks/sheet
   Headers: x-webhook-secret: {WEBHOOK_SECRET}
   Body: { candidateId, sheet, row, version, hash }
   ```
   Backend đọc lại row thật từ sheet, so hash với DB → nếu lệch tạo Conflict cho ADMIN xử lý (giữ WEB hoặc giữ SHEET).

## Luồng nghiệp vụ chính

1. **Tuyển dụng**: Google Form → `POST /api/webhooks/form` → tạo Candidate (`UV-YYYYMMDD-NNNNN`) → Web hiển thị realtime.
2. **AI Scoring**: HR bấm "Chấm hồ sơ" → AI cho điểm theo từng tiêu chí + `TONG_DIEM` + đề xuất (PASS/FAIL) → HR quyết định cuối cùng.
3. **Training**: HR chọn ngày bắt đầu → trạng thái `SAP_BAT_DAU → BAT_DAU → HOAN_THANH` (7 ngày đủ lịch) / `KHONG_DU_NGAY` (quá 14 ngày) / `LOAI`. 1 ngày lịch tính tối đa 1 ngày training. Có thể gửi thông báo Zalo.
4. **Attendance**: Nhân sự điểm danh đúng khung giờ (SÁNG 06:45–07:05, CHIỀU 11:45–12:05, TỐI 17:45–18:05, ±30/10 phút) — qua Zalo nhắn "ĐIỂM DANH" hoặc HR điểm danh thủ công; phải PASS + có lịch ca hôm đó + chưa điểm danh trùng.
5. **Sync Engine**: mọi thay đổi → Sync Job (DB) → worker xử lý → Sheet; retry exponential backoff `[2,5,15,30,60,120,300,600]s`, tối đa 8 lần; idempotency key chống duplicate; verify `DATA_HASH`; Reconciliation chạy 5 phút/lần.

## Cấu trúc thư mục

```
server/
  prisma/schema.prisma      # data model (không dùng enum vì SQLite)
  src/
    app.ts / index.ts       # express app + bootstrap workers
    config/env.ts           # biến môi trường (zod)
    lib/                    # prisma, date (Asia/Ho_Chi_Minh), id, errors, constants
    middleware/             # auth (session + RBAC), errors
    services/               # Auth, Settings, Audit, Candidate, Scoring, ai/, GoogleSheet,
                            # SyncQueue, SyncWorker, Idempotency, Conflict, Reconciliation,
                            # Training, Shift, Attendance, Zalo, Dashboard
    routes/                 # REST endpoints + webhooks
    sockets/                # Socket.IO realtime
    workers/                # SyncWorker
    tests/run.ts            # E2E test suite (38 assertions)
client/
  src/
    api/                    # fetch wrapper + socket client
    stores/                 # auth store, toast
    components/             # ui kit, CandidateDrawer (8 tabs)
    layouts/AppLayout.tsx   # sidebar + header (sync status, DEMO MODE)
    pages/                  # Dashboard, Candidates, Scoring, Training, Shifts,
                            # Attendance, Zalo, SyncCenter, AuditLog, Settings
```

## API chính

| Endpoint | Mô tả |
|---|---|
| `POST /api/auth/login` | Đăng nhập (rate limit 30/15ph) |
| `GET /api/dashboard` | Tổng quan: funnel, 7 ngày, theo chi nhánh |
| `GET/PATCH /api/candidates...` | Danh sách/filter, cập nhật (optimistic lock `version`) |
| `POST /api/candidates/:id/score` | Chạy AI Scoring |
| `PATCH /api/candidates/:id/decision` | HR quyết định PASS/FAIL/REVIEW |
| `POST /api/candidates/:id/training/start` | Bắt đầu Training |
| `PUT /api/shifts/:id/:date` | Lịch ca (SANG/CHIEU/TOI/OFF) |
| `POST /api/attendance/checkin` | Điểm danh (trả valid/reason) |
| `GET /api/sync` · `POST /api/sync/retry/:id` | Theo dõi & retry Sync Job |
| `POST /api/conflicts/:id/resolve` | Giải quyết xung đột WEB/SHEET |
| `POST /api/webhooks/form` · `/sheet` | Google Form / Apps Script |
| `POST /api/zalo/webhook` | Zalo (text "ĐIỂM DANH" = tự checkin) |

Lỗi nghiệp vụ trả về `{ success: false, code, message }`; sai version → `409 VERSION_CONFLICT`.
---

## Setup dữ liệu thật (Google Sheets + Google Form)

### 1. Tạo Service Account (Google Cloud Console)
1. Vào https://console.cloud.google.com → tạo project (hoặc chọn project sẵn có)
2. Menu: **IAM & Admin → Service Accounts → Create Service Account** (VD: `umbomilk-sync`)
3. Vào Service Account vừa tạo → tab **Keys → Add Key → Create New Key → JSON** → tải file về
4. Trong file JSON có 2 giá trị cần dùng:
   - `client_email` → dán vào ô **Service Account Email**
   - `private_key` (cả dòng `-----BEGIN PRIVATE KEY-----...-----END PRIVATE KEY-----`) → dán vào ô **Private Key**

### 2. Tạo Google Sheet
1. Tạo spreadsheet mới trên Google Drive, đặt tên VD: `UMBO_MILK_SYNC`
2. Lấy **Spreadsheet ID**: phần chuỗi giữa `/d/` và `/edit` trong URL
3. Bấm **Share** → dán **Service Account Email** vào → cấp quyền **Editor** → Send

### 3. Liên kết vào hệ thống
1. Đăng nhập admin → **Cài đặt → Google Sheet**
2. Điền: Spreadsheet ID, Service Account Email, Private Key (tên 3 sheet để mặc định)
3. Bấm **Lưu cài đặt** → hệ thống **tự động tạo 3 sheet (LOC_HO_SO_PV, DIEM_UV, HO_SO_NHAN_VIEN_UNG_TUYEN) + các cột chuẩn** nếu chưa có, rồi **đồng bộ toàn bộ dữ liệu** xuống
4. Có thể bấm lại nút **"Tạo cấu trúc & đồng bộ"** bất kỳ lúc nào
5. Kiểm tra: Cài đặt → tab Google Sheet hiện "Đã cấu hình Google Sheet"; mở sheet thấy dữ liệu

*(Thay vì nhập trên Web có thể cấu hình `server/.env`: `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` — cài đặt trên Web ghi đè .env)*

### 4. Kết nối Google Form đăng ký (tuyển dụng)
1. Tạo Google Form với các câu hỏi theo thứ tự: Họ tên, Năm sinh, Trình độ, Quê quán, SĐT/Zalo, Ca mong muốn, Chi nhánh, Kinh nghiệm, Cách xử lý khi bận, Link Facebook
2. Form → dấu 3 chấm → **Trình chỉnh sửa tập lệnh** (Apps Script) → dán vào tab `Code.gs`:

```js
function onFormSubmit(e) {
  const r = e.range.getValues()[0];
  UrlFetchApp.fetch('http://<SERVER>:3000/api/webhooks/form', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-secret': '<WEBHOOK_SECRET>' },
    payload: JSON.stringify({
      tenUv: r[1], namSinh: r[2], trinhDo: r[3], queQuan: r[4],
      sdtZalo: String(r[5]), caLam: r[6], chiNhanh: r[7],
      kinhNghiem: r[8], xuLy: r[9], linkFb: r[10],
    }),
  });
}
```

3. Trigger: đồng hồ ⏰ → **Add Trigger** → hàm `onFormSubmit`, event: **On form submit** → Lưu
4. Nhân sự điền form → hồ sơ nhảy vào Web realtime → sync xuống Google Sheet
*Lưu ý: nếu Apps Script gửi kèm webhook cập nhật sheet: `POST /api/webhooks/sheet` với `{ candidateId, row, version, hash, ... }` + header `x-webhook-secret`*

### 5. Xóa dữ liệu ảo
Đã có sẵn script dọn (chạy 1 lần tại `server/`):
`npx tsx src/tests/cleanup.ts` — xóa candidates/sync/audit/attendance/shift..., giữ lại 3 tài khoản mặc định.

---

## Deploy online (Render)

Code đã sẵn sàng deploy: PostgreSQL + tự tạo tài khoản khi DB trống + `postinstall` tự generate Prisma Client.

### Render
1. https://render.com → **New → Web Service** → connect repo `Nhan-Su-UmBoMilk-Auto-AI`
2. **Build Command**: `npm install && npm run build` (build cả server + web UI)
3. **Start Command**: `npm run start -w server`
4. Tạo **PostgreSQL** (New → PostgreSQL) → copy **Internal Database URL** vào `DATABASE_URL`
5. Add env: `SESSION_SECRET`, `WEBHOOK_SECRET`, `DEMO_MODE=true`
6. Deploy xong mở URL `https://<tên>.onrender.com` — tự tạo bảng DB khi khởi động (không cần Shell), tự seed tài khoản khi DB trống

### Lưu ý sau khi deploy
- Server tự phục vụ web UI (thư mục `client/dist`) — mọi thứ dùng chung 1 URL.
- Webhook Google Form/Apps Script phải trỏ URL public của server (không phải localhost).
- `DEMO_MODE` tắt khi đã liên kết Google Sheet thật qua Cài đặt → Google Sheet.
- Chạy thử cục bộ với Postgres: `docker compose up -d` → sửa `server/.env` `DATABASE_URL` → `npm run db:push` → `npm run dev`.
