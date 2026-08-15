# SIÊU DỰ ÁN AI TUYỂN DỤNG & TRAINING – UMBO MILK

Bạn là **Senior Software Architect, Senior Node.js Developer, React Developer, AI Engineer, Database Engineer và UI/UX Designer**.

Hãy xây dựng một hệ thống Web hoàn chỉnh phục vụ tuyển dụng và training nhân sự cho **UMBO MILK**.

Tên hệ thống:

# UMBO MILK – AI RECRUITMENT & TRAINING SYSTEM

---

# 1. NGUYÊN TẮC KIẾN TRÚC QUAN TRỌNG NHẤT

Kiến trúc bắt buộc:

```text
NHÂN SỰ
   ↓
WEB UMBO MILK
   ↓
NODE.JS BACKEND
   ↓
BUSINESS LOGIC
   ↓
SYNC ENGINE
   ↓
GOOGLE SHEET
```

## WEB

Web là:

**PRIMARY OPERATION INTERFACE**

Tức là:

> Toàn bộ nhân sự thao tác trên Web.

Nhân sự KHÔNG cần mở Google Sheet để làm việc.

---

## GOOGLE SHEET

Google Sheet là:

**BUSINESS DATA STORAGE + DATA MIRROR**

Tức là:

> Google Sheet dùng để lưu trữ, backup nghiệp vụ, kiểm tra, đối soát và xuất dữ liệu.

Tất cả thay đổi từ Web phải được cập nhật chính xác xuống Google Sheet.

---

## NODE.JS

Node.js là:

**TRUNG TÂM BUSINESS LOGIC**

Node.js chịu trách nhiệm:

- Authentication
- Authorization
- xử lý Candidate
- AI scoring
- PASS/FAIL
- Training
- Shift
- Attendance
- Zalo
- Google Sheets
- Sync Queue
- Retry
- Version Control
- Conflict Detection
- Audit
- Realtime

---

# 2. NGUYÊN TẮC DỮ LIỆU

Yêu cầu bắt buộc:

# WEB ↔ GOOGLE SHEET = 1:1

Mỗi dữ liệu trên Web phải có dữ liệu tương ứng trên Google Sheet.

Không được:

- miss dữ liệu
- duplicate dữ liệu
- cập nhật nhầm ứng viên
- ghi đè dữ liệu cũ
- mất dữ liệu khi server restart
- mất dữ liệu khi Google API lỗi
- mất dữ liệu khi mất Internet
- ghi sai row do Sheet bị sort
- dùng row number làm khóa chính

---

# 3. TECH STACK

Backend:

- Node.js
- TypeScript
- Express.js hoặc Fastify

Frontend:

- ReactJS
- TypeScript
- Tailwind CSS
- Lucide Icons hoặc Phosphor Icons

Database:

- PostgreSQL cho production
- SQLite có thể dùng local development

ORM:

- Prisma ORM

Realtime:

- Socket.IO

Queue:

Ưu tiên:

- BullMQ + Redis

Nếu triển khai đơn giản:

- Database Persistent Job Queue

Nhưng queue bắt buộc phải **persistent**.

Google:

- Google Sheets API
- Google Apps Script nếu cần webhook từ Sheet
- Google Service Account

AI:

Thiết kế provider abstraction hỗ trợ:

- OpenAI
- Gemini
- OpenAI-compatible API

Zalo:

- Zalo OA API chính thức

Validation:

- Zod

Security:

- Helmet
- Rate Limit
- secure cookie
- bcrypt/argon2

Timezone:

```text
Asia/Ho_Chi_Minh
```

Date:

```text
dd/MM/yyyy
```

Datetime:

```text
dd/MM/yyyy – HH:mm:ss
```

---

# 4. LUỒNG HỆ THỐNG TỔNG

```text
GOOGLE FORM
     ↓
Ứng viên đăng ký
     ↓
Backend nhận hồ sơ
     ↓
Candidate xuất hiện trên WEB
     ↓
Sync Google Sheet
     ↓
AI chấm hồ sơ
     ↓
Web hiển thị điểm
     ↓
HR xem xét
     ↓
PASS / FAIL / CẦN XEM LẠI
     ↓
PASS
     ↓
Training
     ↓
Xếp ca
     ↓
Thông báo Zalo
     ↓
Điểm danh
     ↓
Theo dõi Training 7 ngày
     ↓
HOÀN THÀNH / KHÔNG ĐỦ NGÀY / LOẠI
```

---

# 5. GOOGLE FORM

Form ứng tuyển hiện tại:

```text
https://forms.gle/Uanp2yKcUjJMqNPy8
```

Ứng viên tự điền Form.

Form là một trong số rất ít nguồn dữ liệu ngoài Web được phép tạo dữ liệu mới.

Khi ứng viên submit:

```text
Google Form
↓
Backend
↓
Create Candidate
↓
Web realtime
↓
Google Sheet
↓
AI Scoring
```

Không bắt frontend liên tục polling Google Sheet.

---

# 6. CANDIDATE ID

Mỗi ứng viên phải có ID duy nhất.

Ví dụ:

```text
UV-20260814-00001
UV-20260814-00002
UV-20260814-00003
```

Field:

```text
CANDIDATE_ID
```

CANDIDATE_ID là khóa chính xuyên suốt hệ thống.

Không sử dụng:

```text
Google Sheet row 15
Google Sheet row 35
```

làm ID.

---

# 7. SHEET LỌC HỒ SƠ PV

Dữ liệu từ Form được lưu vào Sheet:

# LỌC HỒ SƠ PV

Các field:

```text
CANDIDATE_ID

THOI_GIAN

TEN_UV

NAM_SINH

TRINH_DO

QUE_QUAN

SDT_ZALO

CA_LAM

CHI_NHANH

KINH_NGHIEM

XU_LY

LINK_FB

KET_QUA_PV

DATA_VERSION

UPDATED_AT

UPDATED_BY

SYNC_STATUS

DATA_HASH
```

---

# 8. MAPPING GOOGLE FORM

### THOI_GIAN

Thời gian hệ thống nhận hồ sơ.

Format:

```text
dd/MM/yyyy – HH:mm:ss
```

---

### TEN_UV

Nguồn:

```text
Tên Bạn là?*
```

---

### NAM_SINH

Nguồn:

```text
Năm Sinh của bạn?*
```

---

### TRINH_DO

Nguồn:

```text
Trình độ học vấn*
```

---

### QUE_QUAN

Nguồn:

```text
Quê Quán theo CCCD?*
```

---

### SDT_ZALO

Nguồn:

```text
Số điện thoại của bạn (Số zalo để liên hệ)*
```

Normalize số điện thoại.

---

### CA_LAM

Nguồn:

```text
Em có thể làm ca nào?*
```

---

### CHI_NHANH

Nguồn:

```text
Chi nhánh em muốn ứng tuyển (CỐ ĐỊNH)?*
```

---

### KINH_NGHIEM

Nguồn:

```text
Kinh nghiệm làm việc?*
```

---

### XU_LY

Nguồn:

```text
Nếu như ngày mai em có việc đột xuất trùng với lịch ca trực của em,
thì hướng xử lý như nào?
```

---

### LINK_FB

Nguồn:

```text
Gửi link Facebook cá nhân của bạn vào đây nhé!*
```

---

# 9. WEB CANDIDATE MANAGEMENT

Trang:

```text
/candidates
```

Hiển thị table:

```text
Mã UV
Thời gian
Tên
Năm sinh
SĐT
Trình độ
Quê quán
Ca
Chi nhánh
Kinh nghiệm
AI Score
AI Recommendation
HR Decision
Training
Sync
Thao tác
```

---

# 10. TÌM KIẾM & FILTER

Search:

- tên
- số điện thoại
- Candidate ID

Filter:

- ngày đăng ký
- chi nhánh
- ca
- trạng thái
- PASS
- FAIL
- đang Training
- AI Score

Sort:

- mới nhất
- cũ nhất
- điểm cao nhất
- điểm thấp nhất

---

# 11. DRAWER CHI TIẾT CANDIDATE

Click Candidate mở Drawer.

Có các tab:

```text
Hồ sơ
AI Score
HR Decision
Training
Attendance
Zalo
Audit Log
Sync History
```

---

# 12. SHEET DIEM_UV

AI phân tích Candidate và đồng bộ vào:

# DIEM_UV

Các field:

```text
CANDIDATE_ID

D_HO_TEN
D_NAM_SINH
D_QUE_QUAN
D_SDT
D_TRINH_DO
D_KINH_NGHIEM
D_XU_LY
D_LINK_FB

P_HO_TEN
P_NAM_SINH
P_QUE_QUAN
P_SDT
P_TRINH_DO
P_KINH_NGHIEM
P_XU_LY
P_LINK_FB

TONG_DIEM

AI_RECOMMENDATION

AI_NOTE

AI_CONFIDENCE

DATA_VERSION

UPDATED_AT
```

---

# 13. AI SCORING ENGINE

Xây riêng:

```text
CandidateScoringService
```

Không hard-code tất cả rule rải rác trong source.

Admin có thể chỉnh rule tại:

```text
Settings
→ Recruitment Scoring
```

---

# 14. ĐIỂM HỌ TÊN

Có dữ liệu:

```text
+1
```

Không có:

```text
0
```

---

# 15. NĂM SINH

Có dữ liệu:

```text
+1
```

Không có:

```text
0
```

---

# 16. QUÊ QUÁN

Rule nghiệp vụ ban đầu:

```text
Miền Tây / TP.HCM = +1

Miền Trung → Bắc = 0
```

Tuy nhiên phải xây rule dưới dạng:

```text
ENABLE / DISABLE
```

để Admin có thể tắt.

Không hard-code tiêu chí này vào source.

---

# 17. SỐ ĐIỆN THOẠI

Có số hợp lệ:

```text
+1
```

Nếu Zalo API chính thức cho phép xác minh thì sử dụng API.

Nếu không có API hợp lệ:

```text
UNVERIFIED
```

Không được crawl/scrape hoặc giả dữ liệu.

---

# 18. TRÌNH ĐỘ

Rule hiện tại:

```text
Sinh viên Đại học/Cao đẳng = +1

Nghỉ học = +2
```

AI normalize câu trả lời về nhóm chuẩn.

---

# 19. KINH NGHIỆM

AI phân loại:

```text
NO_EXPERIENCE
OTHER_EXPERIENCE
FNB_EXPERIENCE
```

Điểm:

```text
Không kinh nghiệm = 0

Kinh nghiệm khác = +1

Kinh nghiệm F&B = +2
```

AI trả Structured JSON.

Ví dụ:

```json
{
  "classification": "FNB_EXPERIENCE",
  "score": 2,
  "reason": "Ứng viên đã từng làm tại cửa hàng trà sữa.",
  "confidence": 0.92
}
```

---

# 20. XỬ LÝ TÌNH HUỐNG

Có câu trả lời:

```text
+1
```

AI đồng thời phân tích:

- trách nhiệm
- báo quản lý
- chủ động đổi ca
- phương án thay thế

Lưu:

```text
AI_XU_LY_NOTE
```

---

# 21. FACEBOOK

AI/API chỉ phân tích dữ liệu được phép truy cập.

Các kết quả:

```text
CO_VE_CHINH_CHU

CAN_XAC_MINH

KHONG_TRUY_CAP

LINK_KHONG_HOP_LE
```

Không tự động loại ứng viên chỉ vì không kiểm tra được Facebook.

---

# 22. TÍNH TỔNG ĐIỂM

```text
TONG_DIEM =
P_HO_TEN
+ P_NAM_SINH
+ P_QUE_QUAN
+ P_SDT
+ P_TRINH_DO
+ P_KINH_NGHIEM
+ P_XU_LY
+ P_LINK_FB
```

Nếu:

```text
TONG_DIEM >= 7
```

AI Recommendation:

```text
PASS
```

Ngược lại:

```text
FAIL
```

Nhưng phải tách:

```text
AI_RECOMMENDATION
```

và:

```text
HR_DECISION
```

AI chỉ đề xuất.

HR là người quyết định.

---

# 23. HR DECISION

Web có 3 button:

```text
PASS

FAIL

CẦN XEM LẠI
```

Khi HR bấm:

phải lưu:

```text
HR_DECISION
HR_USER
HR_REASON
HR_DECISION_AT
```

và đồng bộ realtime Google Sheet.

---

# 24. PASS PIPELINE

Khi HR bấm:

# PASS

Backend thực hiện:

```text
Validate
↓
Update Candidate
↓
Version +1
↓
Audit
↓
Create Sync Job
↓
Update LỌC HỒ SƠ PV
↓
Create/Update HỒ SƠ NHÂN VIÊN ỨNG TUYỂN
↓
Socket.IO
↓
UI realtime
```

Không được duplicate Candidate.

---

# 25. SHEET HỒ SƠ NHÂN VIÊN ỨNG TUYỂN

Các field:

```text
CANDIDATE_ID

THOI_GIAN

TEN_UV

NAM_SINH

TRINH_DO

QUE_QUAN

SDT_ZALO

CA_LAM

CHI_NHANH

NGAY_BAT_DAU_TRAINING

TRAINING_DAY_1

TRAINING_DAY_2

TRAINING_DAY_3

TRAINING_DAY_4

TRAINING_DAY_5

TRAINING_DAY_6

TRAINING_DAY_7

SO_NGAY_DA_TRAINING

TRANG_THAI_TRAINING

UPDATED_AT

UPDATED_BY

DATA_VERSION

SYNC_STATUS
```

---

# 26. TRAINING

Trang:

```text
/training
```

HR thao tác trực tiếp trên Web.

Không yêu cầu HR nhập trực tiếp Google Sheet.

HR có thể:

- nhập ngày bắt đầu
- chọn chi nhánh
- chọn ca
- đổi ca
- OFF
- ghi chú
- thay trạng thái
- chỉnh attendance nếu có quyền

---

# 27. NGÀY BẮT ĐẦU TRAINING

Admin/HR nhập:

```text
NGAY_BAT_DAU_TRAINING
```

trên Web.

Ngay sau đó:

```text
Web
↓
Backend
↓
Save
↓
Create Sync Job
↓
Sheet cập nhật
↓
Create Training Schedule
↓
Socket.IO
```

---

# 28. SHIFT

Ca gồm:

### SÁNG

```text
06:45 → 07:05
```

Màu vàng.

### CHIỀU

```text
11:45 → 12:05
```

Màu xanh lá.

### TỐI

```text
17:45 → 18:05
```

Màu tím/indigo.

### OFF

Màu xám.

---

# 29. REALTIME SHIFT DASHBOARD

Trang:

```text
/shifts
```

Header có realtime clock.

Ví dụ:

```text
Thứ Sáu, 14/08/2026

16:32:25
```

Update từng giây.

---

# 30. DASHBOARD SHIFT

Các widget:

```text
Trạng thái chấm công

Tổng nhân sự Training

Đang Training

Hoàn thành

Cần xử lý

Khung giờ các ca
```

---

# 31. MATRIX CALENDAR

Table dạng:

```text
TEN_UV | 14/08 | 15/08 | 16/08 | ...
```

Cột TEN_UV sticky bên trái.

Ngày hiện tại highlight:

```text
HÔM NAY
```

Render lịch đến:

```text
31/12/2026
```

Có horizontal scroll.

---

# 32. ĐỔI CA TRỰC TIẾP

HR click vào ô.

Có:

```text
SÁNG
CHIỀU
TỐI
OFF
```

Có thể chọn:

```text
SÁNG + CHIỀU

SÁNG + TỐI

CHIỀU + TỐI
```

Ngay khi Save:

```text
Web update
↓
Backend update
↓
DATA_VERSION +1
↓
Sync Queue
↓
Google Sheet
↓
Socket.IO
```

---

# 33. ZALO

Khi Candidate được Training:

gửi thông báo Zalo qua API chính thức.

Ví dụ:

```text
🐮 UMBO MILK – THÔNG BÁO TRAINING

Chào [TEN_UV] ❤️

Ngày bắt đầu:
[NGAY_BAT_DAU_TRAINING]

Chi nhánh:
[CHI_NHANH]

Ca:
[CA_LAM]

Vui lòng có mặt đúng giờ và thực hiện điểm danh theo hướng dẫn.
```

Lưu message logs.

---

# 34. ĐIỂM DANH

Đến đúng ca:

hệ thống gửi:

```text
1 hình ảnh cửa hàng

+

"ĐIỂM DANH"
```

Nếu Zalo hỗ trợ interactive button:

```text
✅ ĐIỂM DANH
```

Nếu không:

ứng viên trả lời:

```text
ĐIỂM DANH
```

Webhook xử lý.

---

# 35. VALID ATTENDANCE

Một attendance hợp lệ khi:

```text
Candidate đang Training

Candidate có lịch hôm đó

Đúng ca

Đúng khung giờ

Đúng người

Chưa điểm danh trùng
```

Lưu raw event:

```text
candidateId

date

shift

checkinAt

method

valid

reason
```

---

# 36. TÍNH NGÀY TRAINING

Candidate có thể làm:

```text
1 ca
```

hoặc:

```text
2 ca
```

trong ngày.

Nhưng tối đa:

```text
1 ngày Training / ngày lịch
```

Ví dụ làm SÁNG + CHIỀU:

vẫn:

```text
TRAINING_DAY_3 = ✅
```

không được tính 2 ngày.

---

# 37. TRAINING STATUS

Có:

```text
CHƯA THAM GIA

SẮP BẮT ĐẦU

BẮT ĐẦU

HOÀN THÀNH

KHÔNG ĐỦ NGÀY

LOẠI
```

Đủ:

```text
7/7
```

→ HOÀN THÀNH.

---

# 38. ĐỒNG BỘ WEB → GOOGLE SHEET

Mọi thao tác thay đổi dữ liệu phải tạo:

# SYNC JOB

Ví dụ:

```json
{
  "jobId": "SYNC-000912",
  "entity": "candidate",
  "entityId": "UV-20260814-00001",
  "operation": "UPDATE",
  "field": "CA_LAM",
  "oldValue": "SÁNG",
  "newValue": "CHIỀU",
  "version": 18,
  "status": "PENDING"
}
```

---

# 39. SYNC STATUS

```text
PENDING

PROCESSING

SYNCED

RETRY

FAILED

CONFLICT
```

---

# 40. KHÔNG MISS DATA

Đây là yêu cầu bắt buộc.

Không được thiết kế đơn giản:

```text
Web
↓
Google API
↓
Nếu lỗi thì mất thao tác
```

Phải thiết kế:

```text
Web
↓
Backend
↓
Persistent Transaction
↓
Persistent Sync Queue
↓
Worker
↓
Google API
↓
Verify
↓
SYNCED
```

Nếu Google API lỗi:

dữ liệu Web vẫn không được mất.

---

# 41. RETRY

Nếu Google gặp:

```text
Timeout

429

500

Network Error

Temporary Authentication Error
```

thì:

```text
PROCESSING
↓
RETRY
```

Retry:

```text
2s

5s

15s

30s

60s

...
```

Sử dụng exponential backoff.

---

# 42. SERVER RESTART

Nếu Node.js bị restart:

Sync Job không được mất.

Ví dụ trước restart có:

```text
18 PENDING JOBS
```

Sau restart:

Worker phải tiếp tục xử lý 18 Jobs đó.

---

# 43. IDEMPOTENCY

Mỗi mutation có:

```text
idempotencyKey
```

Ví dụ:

```text
candidate:UV-001:shift:version18
```

Nếu request được gửi lại nhiều lần:

không được duplicate dữ liệu.

---

# 44. DATA VERSION

Mỗi Candidate có:

```text
DATA_VERSION
```

Ví dụ:

```text
15
16
17
18
```

Mỗi lần sửa:

```text
version + 1
```

Web:

```text
VERSION 18
```

Sheet:

```text
VERSION 18
```

→ đồng bộ.

---

# 45. OPTIMISTIC LOCKING

Nếu HR A mở Candidate version:

```text
18
```

HR B sửa trước và version thành:

```text
19
```

HR A submit version:

```text
18
```

Backend phải trả:

```text
409 CONFLICT
```

Không được ghi đè dữ liệu của HR B.

---

# 46. GOOGLE SHEET → WEB

Dù Web là nơi thao tác chính, nếu Admin sửa Sheet trực tiếp thì Web phải có khả năng phát hiện.

Có thể sử dụng:

```text
Google Apps Script
+
Installable onEdit Trigger
+
Webhook
```

Flow:

```text
Google Sheet edit
↓
Apps Script
↓
POST Backend Webhook
↓
Validate
↓
Find Candidate ID
↓
Version Check
↓
Conflict Check
↓
Update
↓
Socket.IO
↓
Web realtime
```

---

# 47. CONFLICT

Nếu cùng lúc:

Web:

```text
CA_LAM = CHIỀU
```

Sheet:

```text
CA_LAM = TỐI
```

Không được âm thầm chọn một bên.

Chuyển:

```text
CONFLICT
```

Admin thấy:

```text
WEB:
CHIỀU

GOOGLE SHEET:
TỐI
```

Có button:

```text
GIỮ DỮ LIỆU WEB

GIỮ DỮ LIỆU SHEET
```

---

# 48. RECONCILIATION

Tạo:

```text
ReconciliationService
```

Chạy định kỳ.

Ví dụ:

```text
5 phút/lần
```

So sánh:

```text
CANDIDATE_ID

DATA_VERSION

UPDATED_AT

DATA_HASH
```

Nếu lệch:

```text
SYNC_MISMATCH
```

Nếu có thể tự khôi phục:

tự repair.

Nếu conflict:

đưa Admin xử lý.

---

# 49. DATA HASH

Tạo SHA-256 hoặc hash tương đương cho các field nghiệp vụ.

Nếu:

```text
WEB_HASH == SHEET_HASH
```

→ 1:1.

Nếu khác:

→ dữ liệu lệch.

---

# 50. GOOGLE SHEET SERVICE

Tạo module riêng:

```text
GoogleSheetService
```

Không viết Google API trong Controller.

Các method:

```text
findByCandidateId()

readRows()

appendRow()

updateRow()

batchUpdate()

verifyRow()

syncCandidate()

syncScore()

syncTraining()

syncAttendance()
```

---

# 51. SYNC ENGINE

Tạo:

```text
SyncQueueService

GoogleSheetSyncWorker

ReconciliationService

ConflictService

VersionService

IdempotencyService
```

---

# 52. SYNC CENTER

Trang:

```text
/sync
```

Dashboard:

```text
Đã đồng bộ

Đang chờ

Đang xử lý

Retry

Failed

Conflict
```

Table:

```text
Thời gian

Candidate

Operation

Field

Old value

New value

Version

Retry

Status

Error
```

---

# 53. HEADER SYNC STATUS

Header luôn có:

```text
Google Sheet ● Đồng bộ
```

Nếu pending:

```text
Google Sheet ● 3 dữ liệu đang chờ
```

Nếu lỗi:

```text
Google Sheet ● Lỗi kết nối
```

Click mở Sync Center.

---

# 54. AUDIT LOG

100% mutation phải lưu Audit.

```text
USER

ACTION

ENTITY

ENTITY_ID

OLD_VALUE

NEW_VALUE

VERSION

TIME

IP

SYNC_JOB
```

Ví dụ:

```text
HR_HOCMON

CHANGE_SHIFT

UV-20260814-0011

SÁNG → CHIỀU

18 → 19

14/08/2026 – 16:32:22

SYNCED
```

---

# 55. DATABASE

Database nội bộ dùng cho:

```text
users

roles

sessions

sync_jobs

audit_logs

attendance_events

zalo_messages

webhook_events

system_settings

idempotency_keys

conflicts

API logs
```

Không dùng Database để bỏ Google Sheet.

Google Sheet vẫn phải nhận dữ liệu nghiệp vụ 1:1 theo yêu cầu.

---

# 56. REALTIME SOCKET.IO

Events:

```text
candidate:new

candidate:updated

candidate:scored

candidate:decision

candidate:sync

training:updated

shift:updated

attendance:checked

zalo:status

sync:pending

sync:success

sync:failed

sync:conflict
```

Các máy đang mở Web cập nhật mà không reload.

---

# 57. DASHBOARD CHÍNH

Trang:

```text
/dashboard
```

Widgets:

```text
Hồ sơ hôm nay

AI đang chấm

Chờ duyệt

PASS hôm nay

FAIL

Đang Training

Hoàn thành Training

Cần xử lý
```

Charts:

```text
Recruitment Funnel

Candidate 7 ngày

Training theo chi nhánh

Tỉ lệ hoàn thành Training
```

---

# 58. PHÂN QUYỀN

Role:

# ADMIN

Toàn quyền.

# HR

Có quyền:

- Candidate
- PASS/FAIL
- Training
- Shift
- Attendance
- Zalo

Không quản trị tài khoản hệ thống nếu Admin không cấp.

# VIEWER

Chỉ xem.

---

# 59. LOGIN

Phải có Login thật.

Bảo mật:

```text
bcrypt/argon2

httpOnly cookie

secure cookie

CSRF protection phù hợp

rate limiting

RBAC
```

Không lưu token trong frontend source.

---

# 60. UI DESIGN

Phong cách:

# MODERN HR SaaS

Màu thương hiệu:

```text
Hồng pastel

Trắng

Hồng đậm

Xám nhạt
```

Giao diện:

- cao cấp
- hiện đại
- dễ đọc
- responsive
- ít rối
- thao tác nhanh

Có:

```text
rounded-xl
rounded-2xl
shadow-sm
animation
toast
skeleton loading
tooltip
modal
drawer
badge
```

---

# 61. SIDEBAR

```text
Tổng quan

Ứng viên

AI chấm hồ sơ

Training

Lịch làm việc

Điểm danh

Zalo

Đồng bộ dữ liệu

Google Sheet

Nhật ký

Cài đặt
```

---

# 62. SETTINGS

## Google Sheet

```text
Spreadsheet ID

Sheet names

Service Account status
```

## AI

```text
Provider

Base URL

API Key

Model

Temperature
```

## Zalo

```text
OA ID

Access Token

Refresh Token

Webhook
```

## Recruitment

Cho phép chỉnh toàn bộ scoring rules.

## Attendance

Cho phép chỉnh:

```text
Ca Sáng

Ca Chiều

Ca Tối
```

---

# 63. HEALTH CHECK

Header hiển thị:

```text
Node.js       ● Online

Database      ● Online

Google Sheet  ● Online

AI            ● Online

Zalo          ● Online
```

Chỉ hiển thị Online nếu health-check thực tế thành công.

Không fake.

---

# 64. DEMO MODE

Nếu chưa có API key:

```env
DEMO_MODE=true
```

Web vẫn chạy.

Nhưng phải có badge:

```text
DEMO MODE
```

Không giả Google/Zalo/AI đã hoạt động.

---

# 65. API BACKEND

Ví dụ:

```text
POST /api/auth/login
POST /api/auth/logout

GET /api/dashboard

GET /api/candidates
GET /api/candidates/:id
PATCH /api/candidates/:id

POST /api/candidates/:id/score

PATCH /api/candidates/:id/decision

GET /api/training
PATCH /api/training/:id

GET /api/shifts
PUT /api/shifts/:candidateId/:date

POST /api/attendance/checkin

POST /api/zalo/send
POST /api/zalo/webhook

POST /api/google/webhook

POST /api/sync/retry/:jobId

GET /api/sync

GET /api/audit

GET /api/settings
PUT /api/settings
```

---

# 66. ERROR RESPONSE

Chuẩn hóa:

```json
{
  "success": false,
  "code": "GOOGLE_SHEET_ERROR",
  "message": "Không thể đồng bộ Google Sheet.",
  "requestId": "REQ-xxxx"
}
```

---

# 67. SOURCE STRUCTURE

```text
project/

├── client/
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── layouts/
│       ├── hooks/
│       ├── stores/
│       ├── services/
│       └── utils/
│
├── server/
│   ├── controllers/
│   ├── routes/
│   ├── services/
│   ├── repositories/
│   ├── sync/
│   ├── workers/
│   ├── jobs/
│   ├── sockets/
│   ├── middleware/
│   ├── validators/
│   └── utils/
│
├── prisma/
├── scripts/
├── tests/
├── .env.example
├── package.json
└── README.md
```

---

# 68. .ENV

Tạo:

```env
PORT=3000

DATABASE_URL=

REDIS_URL=

GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=

AI_PROVIDER=
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=

ZALO_OA_ID=
ZALO_ACCESS_TOKEN=
ZALO_REFRESH_TOKEN=

SESSION_SECRET=

TIMEZONE=Asia/Ho_Chi_Minh

DEMO_MODE=true
```

Không commit `.env`.

---

# 69. TEST BẮT BUỘC – GOOGLE SHEET

### CASE 1

HR sửa Candidate.

Google API hoạt động.

Expected:

```text
Web updated
↓
Sheet updated
↓
VERSION giống nhau
↓
SYNCED
```

---

### CASE 2

Google API mất 10 phút.

HR tiếp tục thao tác.

Expected:

```text
Dữ liệu Web KHÔNG mất.

Sync Jobs chuyển PENDING/RETRY.
```

Google hoạt động lại:

```text
Auto sync toàn bộ.
```

---

### CASE 3

Node.js restart trong lúc sync.

Expected:

```text
Pending Job vẫn còn.

Restart xong Worker tiếp tục.
```

---

### CASE 4

HR double-click PASS.

Expected:

```text
Không duplicate Candidate.
```

---

### CASE 5

Sheet bị Sort.

Expected:

```text
Vẫn cập nhật đúng Candidate nhờ CANDIDATE_ID.
```

---

### CASE 6

2 HR sửa cùng Candidate.

Expected:

```text
Optimistic locking.

Không âm thầm ghi đè.
```

---

### CASE 7

Web và Sheet cùng sửa.

Expected:

```text
CONFLICT
```

Admin xử lý.

---

### CASE 8

Web và Sheet lệch dữ liệu.

Expected:

```text
Reconciliation phát hiện.

Repair hoặc Conflict.
```

---

# 70. TEST TRAINING

Test:

```text
Chưa có ngày Training

Đúng ngày bắt đầu

Training 1/7

Training 6/7

Training 7/7

1 ca/ngày

2 ca/ngày

OFF

Sai giờ điểm danh

Điểm danh trùng
```

---

# 71. TEST END-TO-END

Phải chạy được:

```text
Ứng viên Submit Form
↓
Candidate xuất hiện Web
↓
Google Sheet nhận dữ liệu
↓
AI chấm
↓
Sheet DIEM_UV cập nhật
↓
HR thấy Score
↓
HR bấm PASS
↓
Web cập nhật
↓
Sheet cập nhật
↓
Candidate vào Training
↓
HR chọn ngày Training
↓
HR xếp ca
↓
Sheet realtime cập nhật
↓
Zalo gửi thông báo
↓
Candidate điểm danh
↓
Attendance lưu
↓
Sheet cập nhật
↓
Training Day tick
↓
7/7
↓
HOÀN THÀNH
```

---

# 72. NGUYÊN TẮC CUỐI CÙNG

Không được hiểu sai kiến trúc này.

## NƠI NHÂN SỰ THAO TÁC

```text
WEB
```

## NƠI XỬ LÝ NGHIỆP VỤ

```text
NODE.JS BACKEND
```

## NƠI LƯU DỮ LIỆU NGHIỆP VỤ 1:1

```text
GOOGLE SHEET
```

## NƠI LƯU QUEUE / LOG / ACCOUNT / EVENT

```text
DATABASE
```

## CƠ CHẾ CHỐNG MISS DATA

```text
PERSISTENT QUEUE
+
RETRY
+
IDEMPOTENCY
+
VERSION
+
AUDIT LOG
+
RECONCILIATION
+
DATA HASH
```

## REALTIME WEB

```text
SOCKET.IO
```

---

# 73. ƯU TIÊN PHÁT TRIỂN

Thứ tự ưu tiên:

```text
1. Không mất dữ liệu

2. Không duplicate

3. Đúng Candidate

4. Web ↔ Google Sheet 1:1

5. Xử lý Conflict

6. Realtime

7. AI chính xác

8. Training chính xác

9. Audit đầy đủ

10. UI/UX đẹp
```

---

# 74. YÊU CẦU ĐỐI VỚI AI CODING AGENT

Sau khi nhận prompt này:

Không chỉ giải thích.

Không chỉ dựng UI.

Không chỉ tạo Mockup.

Không dừng giữa chừng để hỏi lại những thông tin có thể cấu hình bằng `.env`.

Hãy:

```text
1. Phân tích kiến trúc

2. Tạo project Node.js + React

3. Tạo Database Schema

4. Tạo Login + RBAC

5. Xây Candidate Module

6. Xây Google Sheet Service

7. Xây Persistent Sync Queue

8. Xây Sync Worker

9. Xây Reconciliation

10. Xây AI Scoring

11. Xây PASS Pipeline

12. Xây Training

13. Xây Shift Dashboard

14. Xây Attendance

15. Xây Zalo Service

16. Xây Socket.IO

17. Xây Audit Log

18. Xây Sync Center

19. Test toàn bộ hệ thống

20. Viết README hướng dẫn chạy
```

Nếu thiếu credential:

- tạo `.env.example`
- xây Adapter hoàn chỉnh
- dùng Mock Provider
- đánh dấu rõ Mock
- tiếp tục code các phần còn lại

Không tự bịa API key.

Không fake API thành công.

Không sử dụng Docker nếu không thực sự cần thiết.

Dự án phải có khả năng chạy bằng Node.js trực tiếp:

```bash
npm install
npm run dev
```

và production:

```bash
npm run build
npm start
```

---

# MỤC TIÊU CUỐI

Tôi cần một hệ thống thật để nhân sự UMBO MILK có thể làm việc hàng ngày.

**Nhân sự chỉ thao tác trên WEB.**

Mỗi thao tác:

```text
WEB
↓
NODE.JS
↓
SAVE TRANSACTION
↓
SYNC QUEUE
↓
GOOGLE SHEET
↓
VERIFY
↓
SYNCED
```

Google Sheet phải luôn có khả năng đối soát 1:1 với Web.

Nếu Google Sheet tạm thời lỗi:

> Dữ liệu không được mất.

Nếu Node.js restart:

> Dữ liệu không được mất.

Nếu nhân sự bấm nhiều lần:

> Không duplicate.

Nếu nhiều nhân sự cùng sửa:

> Không ghi đè âm thầm.

Nếu Web và Sheet khác nhau:

> Hệ thống phải phát hiện.

Mục tiêu cuối cùng:

# WEB UMBO MILK = NƠI VẬN HÀNH

# GOOGLE SHEET = KHO DỮ LIỆU NGHIỆP VỤ 1:1

# NODE.JS SYNC ENGINE = CƠ CHẾ BẢO ĐẢM KHÔNG MISS DỮ LIỆU

Hãy bắt đầu xây dựng dự án thực tế từ **Phase 1 – Architecture + Database + Authentication + Sync Foundation**, sau đó tiếp tục hoàn thiện toàn bộ hệ thống.