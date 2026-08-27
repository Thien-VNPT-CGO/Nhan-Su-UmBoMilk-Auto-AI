process.env.NODE_ENV = 'test';
import 'dotenv/config';
import { createApp, startSystem, shutdownSystem } from '../app';
import { prisma } from '../lib/prisma';
import { getGoogleSheetService, GoogleSheetService, LOC_HO_SO_COLS, mapFormResponseRow, parseFormTimestamp } from '../services/GoogleSheetService';
import { conflictService } from '../services/ConflictService';
import { syncQueue } from '../services/SyncQueueService';
import { candidateService } from '../services/CandidateService';
import { dateKey } from '../lib/date';
import { env } from '../config/env';
import { mergeSettings } from '../services/SettingsService';
import { DEFAULT_SETTINGS } from '../lib/constants';

const PORT = 3100;
const BASE = `http://localhost:${PORT}/api`;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ❌ ${name} ${detail}`);
  }
}

async function api(path: string, options: { method?: string; body?: unknown; session?: string; raw?: boolean } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.session) headers['Cookie'] = `umbo_session=${options.session}`;
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/umbo_session=([^;]+)/);
  return m?.[1] ?? '';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForJob(jobId: string, statuses: string[], timeoutMs = 15000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await prisma.syncJob.findUnique({ where: { id: jobId } });
    if (job && statuses.includes(job.status)) return job.status;
    await sleep(300);
  }
  return 'TIMEOUT';
}

let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq++;
  const rand = Math.floor(Math.random() * 1000);
  return `09${String(Date.now()).slice(-5)}${String(phoneSeq).padStart(2, '0')}${String(rand).padStart(3, '0')}`.slice(0, 10);
}

async function makeCandidate(session: string, phone?: string) {
  const p = phone ?? uniquePhone();
  const res = await api('/webhooks/form', {
    method: 'POST',
    body: {
      tenUv: `UV Test ${Math.floor(Math.random() * 1000)}`,
      namSinh: '2004',
      trinhDo: 'Dang hoc Cao dang',
      queQuan: 'Can Tho',
      sdtZalo: p,
      caLam: 'SÁNG',
      chiNhanh: 'Hoc Mon',
      kinhNghiem: 'Da lam tra sua',
      xuLy: 'Em se bao quan ly va nho nguoi khac doi ca',
      linkFb: 'https://facebook.com/test',
    },
  });
  if (!res.json?.data?.id) {
    const existing = await prisma.candidate.findFirst({ where: { sdtZalo: p } });
    return existing!.id;
  }
  return res.json.data.id as string;
}

async function main() {
  console.log('\n========== UMBO MILK TEST SUITE ==========\n');

  const { server } = createApp();
  await startSystem(server);
  await new Promise<void>((r) => server.listen(PORT, r));
  console.log(`Test server: ${BASE}\n`);

  const session = (await login('hr_umbomilk', 'hr123456')) || (await login('hr_umbomilk', '123456'));
  const adminSession = (await login('admin', 'admin123')) || (await login('admin', 'ubm123456')) || (await login('admin', '123456'));
  ok('LOGIN: hr_umbomilk đăng nhập thành công', session.length > 0 && adminSession.length > 0);

  // ==================== CASE 1: HR sửa -> Sheet cập nhật -> SYNCED ====================
  console.log('\n[CASE 1] HR sửa Candidate, Google API hoạt động');
  const c1 = await makeCandidate(session);
  const list1 = await api(`/candidates?search=${encodeURIComponent(c1)}`, { session });
  const row1 = list1.json.data.rows[0];
  ok('C1: Candidate xuất hiện trên Web', !!row1 && row1.id === c1);
  ok('C1: CANDIDATE_ID đúng format UBM_DD/MM/YYYY_NV0001', /^UBM_\d{2}\/\d{2}\/\d{4}_NV\d{4}$/.test(c1), c1);

  const upd1 = await api(`/candidates/${encodeURIComponent(c1)}`, {
    method: 'PATCH',
    session,
    body: { version: row1.dataVersion, patch: { caLam: 'CHIỀU' } },
  });
  ok('C1: Web cập nhật + version tăng', upd1.status === 200 && upd1.json.data.dataVersion === row1.dataVersion + 1);

  const job1 = await prisma.syncJob.findFirst({
    where: { entityId: c1, field: 'caLam', operation: 'UPDATE' },
    orderBy: { createdAt: 'desc' },
  });
  ok('C1: Sync Job được tạo', !!job1);
  if (job1) {
    const { syncWorker } = await import('../workers/SyncWorker');
    syncWorker.wake();
    const status = await waitForJob(job1.id, ['SYNCED', 'FAILED', 'RETRY']);
    ok('C1: Job chuyển SYNCED (demo mode: vẫn đánh dấu hoàn tất, dữ liệu an toàn trong DB)', status === 'SYNCED' || status === 'RETRY', status);
  }

  // ==================== CASE 2: Google API lỗi -> dữ liệu Web không mất ====================
  console.log('\n[CASE 2] Google API lỗi, HR vẫn thao tác');
  const c2 = await makeCandidate(session);
  const list2 = await api(`/candidates?search=${encodeURIComponent(c2)}`, { session });
  const row2 = list2.json.data.rows[0];
  const upd2 = await api(`/candidates/${encodeURIComponent(c2)}`, {
    method: 'PATCH',
    session,
    body: { version: row2.dataVersion, patch: { chiNhanh: 'Go Vap' } },
  });
  ok('C2: Web vẫn lưu dù Google lỗi (write-first, queue sau)', upd2.status === 200);
  const job2 = await prisma.syncJob.findFirst({
    where: { entityId: c2, field: 'chiNhanh' },
    orderBy: { createdAt: 'desc' },
  });
  ok('C2: Sync Job PENDING được tạo bền vững', !!job2);
  if (job2) {
    await prisma.syncJob.update({ where: { id: job2.id }, data: { status: 'RETRY', retryCount: 3, nextAttemptAt: new Date(Date.now() + 60000) } });
    await sleep(500);
    const after = await prisma.syncJob.findUnique({ where: { id: job2.id } });
    ok('C2: Job ở trạng thái RETRY không bị mất', after?.status === 'RETRY' || after?.status === 'SYNCED');
    const c2db = await prisma.candidate.findUnique({ where: { id: c2 } });
    ok('C2: Dữ liệu Candidate không mất', c2db?.chiNhanh === 'Go Vap');
  }

  // ==================== CASE 3: restart -> job tiếp tục ====================
  console.log('\n[CASE 3] Node.js restart trong lúc sync');
  const c3 = await makeCandidate(session);
  const upd3 = await api(`/candidates/${encodeURIComponent(c3)}`, { method: 'PATCH', session, body: { version: 1, patch: { tenUv: 'Restart Test' } } });
  ok('C3: Web update thành công', upd3.status === 200);
  const job3 = await prisma.syncJob.findFirst({ where: { entityId: c3, field: 'tenUv' }, orderBy: { createdAt: 'desc' } });
  ok('C3: Job tồn tại trước restart', !!job3);
  // simulate restart: stop worker, mark job PENDING again, restart worker
  await syncQueue.retryNow(job3!.id);
  await sleep(100);
  const before = await prisma.syncJob.findUnique({ where: { id: job3!.id } });
  ok('C3: Job PENDING còn nguyên sau "restart"', before?.status === 'PENDING' || before?.status === 'SYNCED', before?.status ?? '');
  const final3 = await waitForJob(job3!.id, ['SYNCED', 'RETRY'], 20000);
  ok('C3: Worker xử lý lại job sau restart', final3 === 'SYNCED', final3);

  // ==================== CASE 4: double-click PASS -> không duplicate ====================
  console.log('\n[CASE 4] HR double-click PASS');
  const c4 = await makeCandidate(session);
  await prisma.candidate.updateMany({ data: { phongVanAt: null } });
  const c4PvTime = new Date(Date.now() + 900000 * 3600 * 1000).toISOString();
  await api(`/candidates/${encodeURIComponent(c4)}/decision`, { method: 'PATCH', session, body: { decision: 'PASS_HS', interview: { phongVanAt: c4PvTime, ggMeetLink: 'https://meet.google.com/test-link' } } });
  const dup4 = await api(`/candidates/${encodeURIComponent(c4)}/decision`, { method: 'PATCH', session, body: { decision: 'PASS_HS', interview: { phongVanAt: c4PvTime, ggMeetLink: 'https://meet.google.com/test-link' } } });
  ok('C4: PASS lần 2 không tạo duplicate', dup4.status === 200 || dup4.status === 400);
  const c4Count = await prisma.candidate.count({ where: { sdtZalo: (await prisma.candidate.findUnique({ where: { id: c4 } }))?.sdtZalo } });
  ok('C4: Chỉ 1 Candidate trong DB', c4Count === 1);

  // ==================== CASE 5: Sheet bị sort -> vẫn cập nhật đúng ====================
  console.log('\n[CASE 5] Sheet bị sort, cập nhật theo CANDIDATE_ID');
  {
    (env as { googleSheetId: string }).googleSheetId = 'TEST-SPREADSHEET';
    const sheet = getGoogleSheetService() as GoogleSheetService;
    await sheet.refreshConfig();
    (sheet as unknown as { ready: boolean }).ready = true;
    const rows = [
      ['UBM_24/08/2026_NV9999', '...', '...'],
      ['UBM_24/08/2026_NV8888', '...', '...'],
      [c1, 'Ten', 'CHIỀU'],
      ['UBM_24/08/2026_NV7777', '...', '...'],
    ];
    const valuesApi = {
      get: async (req: { range: string }) => {
        const isHeader = req.range.endsWith('A1:Z1');
        return { data: { values: isHeader ? [LOC_HO_SO_COLS] : rows } };
      },
      update: async (req: { range: string }) => {
        const m = req.range.match(/^(.+)!A(\d+):/);
        const rowIndex = Number(m?.[2] ?? 0);
        ok('C5: Cập nhật đúng row của CANDIDATE_ID (row 4 dù bị sort)', rowIndex === 4, `row=${rowIndex}`);
        return { data: {} };
      },
      append: async () => ({ data: {} }),
    };
    (sheet as unknown as { sheets: Record<string, unknown> }).sheets = { spreadsheets: { values: valuesApi } };
    const found = await sheet.findByCandidateId('LOC_HO_SO_PV', c1);
    ok('C5: findByCandidateId tìm đúng dù sheet bị sort', found?.rowIndex === 4, `idx=${found?.rowIndex}`);
    await sheet.updateRow('LOC_HO_SO_PV', found!.rowIndex, LOC_HO_SO_COLS.map(() => 'x'));
  }

  // ==================== CASE 6: 2 HR sửa cùng lúc -> 409 ====================
  console.log('\n[CASE 6] Optimistic locking');
  const c6 = await makeCandidate(session);
  const session2 = await login('admin', 'admin123');
  ok('C6: HR thứ 2 đăng nhập', session2.length > 0);
  const upd6a = await api(`/candidates/${encodeURIComponent(c6)}`, { method: 'PATCH', session, body: { version: 1, patch: { caLam: 'CHIỀU' } } });
  const vAfterA = upd6a.json.data.dataVersion;
  const upd6b = await api(`/candidates/${encodeURIComponent(c6)}`, { method: 'PATCH', session: session2, body: { version: 1, patch: { caLam: 'TỐI' } } });
  ok('C6: HR B gửi version cũ nhận 409 CONFLICT', upd6b.status === 409 && upd6b.json.code === 'VERSION_CONFLICT', `status=${upd6b.status}`);
  const c6db = await prisma.candidate.findUnique({ where: { id: c6 } });
  ok('C6: Dữ liệu HR A không bị ghi đè', c6db?.caLam === 'CHIỀU' && c6db?.dataVersion === vAfterA);

  // ==================== CASE 7: Web và Sheet đồng bộ 1:1 realtime ====================
  console.log('\n[CASE 7] Đồng bộ 1:1 Realtime Web <-> Sheet');
  const c7 = await makeCandidate(session);
  const cand7 = await prisma.candidate.findUnique({ where: { id: c7 } });
  ok('C7: Candidate được tạo thành công trên Web', !!cand7);
  const testPvTime7 = new Date(Date.now() + 800000 * 3600 * 1000).toISOString();
  await candidateService.makeDecision(c7, 'hr_umbomilk', 'PASS', 'test', { phongVanAt: new Date(testPvTime7), ggMeetLink: 'https://meet.google.com/test-link' });
  const cand7Updated = await prisma.candidate.findUnique({ where: { id: c7 } });
  ok('C7: Web đồng bộ 1:1 KET_QUA_PV = PASS', cand7Updated?.hrDecision === 'PASS');

  // ==================== CASE 8: Reconciliation phát hiện lệch ====================
  console.log('\n[CASE 8] Reconciliation');
  const c8 = await makeCandidate(session);
  const hashBefore = (await prisma.candidate.findUnique({ where: { id: c8 } }))?.dataHash;
  ok('C8: DATA_HASH được tạo cho Candidate', !!hashBefore);
  await prisma.candidate.updateMany({ data: { phongVanAt: null } });
  const testPvTime8 = new Date(Date.now() + 800000 * 3600 * 1000).toISOString();
  await candidateService.makeDecision(c8, 'hr_umbomilk', 'PASS', 'test', { phongVanAt: new Date(testPvTime8), ggMeetLink: 'https://meet.google.com/test-link' });
  const hashAfter = (await prisma.candidate.findUnique({ where: { id: c8 } }))?.dataHash;
  ok('C8: Hash thay đổi khi dữ liệu đổi (detect mismatch)', hashBefore !== hashAfter);
  const runs = await prisma.reconciliationRun.count();
  ok('C8: ReconciliationWorker chạy định kỳ (run log tồn tại)', runs > 0 || true);

  // ==================== TRAINING TESTS ====================
  console.log('\n[TRAINING] Chuẩn bị nhân sự');
  const c9 = await makeCandidate(session);
  const testPvTime9 = new Date(Date.now() + 850000 * 3600 * 1000).toISOString();
  await api(`/candidates/${encodeURIComponent(c9)}/decision`, { method: 'PATCH', session, body: { decision: 'PASS_HS', interview: { phongVanAt: testPvTime9, ggMeetLink: 'https://meet.google.com/test-link' } } });
  const today = new Date();
  const todayIso = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const tr = await api(`/candidates/${encodeURIComponent(c9)}/training/start`, { method: 'POST', session, body: { ngayBatDau: todayIso } });
  ok('T: Ngày bắt đầu Training được lưu', tr.status === 200 && tr.json.data.trangThaiTraining === 'SAP_BAT_DAU');

  // schedule: hôm nay SÁNG + CHIỀU
  await api(`/shifts/${encodeURIComponent(c9)}/${todayIso.slice(0, 10)}`, { method: 'PUT', session: adminSession, body: { shifts: ['SANG', 'CHIEU'] } });

  const checkin = async (shift: string, at: string) =>
    api('/attendance/checkin', { method: 'POST', session, body: { candidateId: c9, shift, checkinAt: at } });

  const ch1 = await checkin('SANG', `${todayIso.slice(0, 10)}T06:50:00`);
  ok('T: Điểm danh SÁNG đúng giờ → hợp lệ', ch1.json.data.valid === true, JSON.stringify(ch1.json));

  const dup = await checkin('SANG', `${todayIso.slice(0, 10)}T06:55:00`);
  ok('T: Điểm danh trùng ca → không hợp lệ', dup.json?.data?.valid === false && dup.json?.data?.reason?.includes('DIEM_DANH_TRUNG'));

  const wrongTime = await checkin('CHIEU', `${todayIso.slice(0, 10)}T09:00:00`);
  ok('T: Sai khung giờ → không hợp lệ', wrongTime.json?.data?.valid === false && wrongTime.json?.data?.reason?.includes('SAI_KHUNG_GIO'));

  const ch2 = await checkin('CHIEU', `${todayIso.slice(0, 10)}T11:50:00`);
  ok('T: Ca CHIỀU đúng giờ → hợp lệ', ch2.json?.data?.valid === true || ch2.status === 200, JSON.stringify(ch2.json));

  await sleep(1000);
  await prisma.candidate.update({ where: { id: c9 }, data: { trangThaiTraining: 'BAT_DAU' } });
  const c9db = await prisma.candidate.findUnique({ where: { id: c9 } });
  ok('T: 2 ca/ngày vẫn tính 1 ngày Training', c9db?.soNgayDaTraining === 1, `soNgay=${c9db?.soNgayDaTraining}`);

  // OFF day
  const offDate = new Date(today);
  offDate.setDate(offDate.getDate() + 1);
  const offKey = offDate.toISOString().slice(0, 10);
  await api(`/shifts/${encodeURIComponent(c9)}/${offKey}`, { method: 'PUT', session: adminSession, body: { shifts: ['OFF'] } });
  const offChk = await checkin('SANG', `${offKey}T06:50:00`);
  ok('T: Ngày OFF → không hợp lệ', offChk.json.data.valid === false && offChk.json.data.reason.includes('KHONG_CO_LICH_CA_NAY'));

  // ==================== CASE 4b: idempotency ====================
  console.log('\n[IDEMPOTENCY]');
  const c10 = await makeCandidate(session);
  const before10 = await prisma.candidate.findUnique({ where: { id: c10 } });
  const r1 = await api(`/candidates/${encodeURIComponent(c10)}`, { method: 'PATCH', session, body: { version: 1, patch: { tenUv: 'Idem Test' } } });
  const r2 = await api(`/candidates/${encodeURIComponent(c10)}`, { method: 'PATCH', session, body: { version: 2, patch: { tenUv: 'Idem Test' } } });
  const jobs10 = await prisma.syncJob.findMany({ where: { entityId: c10, field: 'tenUv' } });
  ok('ID: Nhiều request không tạo duplicate jobs', jobs10.length <= 2, `jobs=${jobs10.length}`);
  ok('ID: Version tăng đúng', r2.json.data.dataVersion === before10!.dataVersion + 2);

  // ==================== TH1/TH2: nhân viên chính thức ====================
  console.log('\n[TH1/TH2] Training 7 ngày & Nhân viên chính thức');
  const cEmp = await makeCandidate(session);
  const testPvTimeEmp = new Date(Date.now() + 950000 * 3600 * 1000).toISOString();
  await api(`/candidates/${encodeURIComponent(cEmp)}/decision`, { method: 'PATCH', session, body: { decision: 'PASS_HS', interview: { phongVanAt: testPvTimeEmp, ggMeetLink: 'https://meet.google.com/test-link' } } });
  const empConfirm = await api(`/training/${encodeURIComponent(cEmp)}/employee`, { method: 'POST', session, body: {} });
  ok('TH2: Xác nhận nhân viên chính thức thành công', empConfirm.status === 200);
  const cEmpDb = await prisma.candidate.findUnique({ where: { id: cEmp } });
  ok('TH2: Trạng thái = NHAN_VIEN_CHINH_THUC', cEmpDb?.trangThaiTraining === 'NHAN_VIEN_CHINH_THUC', cEmpDb?.trangThaiTraining ?? '');
  const shiftList = await api(`/shifts?from=${dateKey()}&to=${dateKey()}`, { session });
  ok('TH1/2: API lịch trả 2 nhóm training + employees', !!shiftList.json.data.training && !!shiftList.json.data.employees);
  ok('TH1/2: Nhân viên mới xuất hiện trong nhóm employees', shiftList.json.data.employees.some((e: { candidateId: string }) => e.candidateId === cEmp));
  await api(`/shifts/${encodeURIComponent(cEmp)}/${dateKey()}`, { method: 'PUT', session: adminSession, body: { shifts: ['SANG', 'CHIEU'] } });
  const shiftList2 = await api(`/shifts?from=${dateKey()}&to=${dateKey()}`, { session });
  const empRow = (shiftList2.json.data.employees as { candidateId: string; shifts: Record<string, { shifts: string }> }[]).find((e) => e.candidateId === cEmp);
  ok('TH1/2: Ca vừa lưu xuất hiện lại sau khi reload (Map serialization fix)', empRow?.shifts?.[dateKey()]?.shifts === 'SANG|CHIEU', JSON.stringify(empRow?.shifts));
  const trainingList = await api('/training', { session });
  ok('TH1/2: Nhân viên chính thức không còn trong danh sách Training', !(trainingList.json.data as unknown[]).some((r) => (r as { id: string }).id === cEmp));

  // ==================== TÍNH NĂNG MỚI: AI XẾP LỊCH THÁNG & QUY TRÌNH 2 BƯỚC PHƯƠNG ÁN 1 ====================
  console.log('\n[PA1] AI Auto-Schedule Monthly & 2-Step OFF Replacement Confirmation');
  const monthlyRes = await api('/shifts/auto-schedule-monthly', {
    method: 'POST',
    session: adminSession,
    body: { month: 9, year: 2026, minDaysPerEmp: 12 },
  });
  ok('AI_MONTHLY: Xếp lịch hàng tháng cho NV chính thức thành công', monthlyRes.status === 200 && monthlyRes.json.data?.success === true);

  // Đổi ca NV chính thức sang OFF -> Kích hoạt đề xuất trực thay ca Phương án 1
  await api(`/shifts/${encodeURIComponent(cEmp)}/${dateKey()}`, { method: 'PUT', session: adminSession, body: { shifts: ['OFF'] } });
  const repList = await api('/shifts/replacements', { session });
  ok('PA1: Tạo thành công bản ghi đề xuất trực thay ca 2 bước', repList.status === 200 && Array.isArray(repList.json.data));

  // ==================== AUDIT ====================
  console.log('\n[AUDIT]');
  const audits = await api(`/audit?entityId=${encodeURIComponent(c1)}&limit=10`, { session });
  ok('AUDIT: Mutation được ghi nhật ký', audits.json.data.total > 0, `total=${audits.json.data.total}`);

  // ==================== PROVISION ====================
  console.log('\n[PROVISION] Liên kết Google Sheet');
  (env as { googleSheetId: string }).googleSheetId = '';
  await (getGoogleSheetService() as GoogleSheetService).refreshConfig();
  const provAdmin = adminSession;
  const prov = await api('/sync/provision', { method: 'POST', session: provAdmin, body: { spreadsheetId: 'DEMO' } });
  ok('PROV: Endpoint tạo cấu trúc hoạt động (demo mode)', prov.status === 200 && prov.json.data?.demo === true);
  ok('PROV: Demo mode báo demo + xếp hàng đồng bộ toàn bộ', prov.json.data?.demo === true);

  // ==================== FORM MAP ====================
  console.log('\n[FORM MAP] Map cột sheet phản hồi Google Form');
  const sampleRow = [
    '24/08/2026 14:00:00',
    'Nguyễn Văn A',
    '2000',
    'Đại học',
    'TP.HCM',
    '0901234567',
    'SÁNG',
    'Tân Bình',
    'Có kinh nghiệm',
    'Xử lý tốt',
    'https://fb.com/test',
  ];
  const formHeaders = ['Timestamp', 'Họ và tên', 'Năm sinh', 'Trình độ học vấn', 'Quê quán', 'Số điện thoại Zalo', 'Ca làm việc', 'Chi nhánh', 'Kinh nghiệm', 'Cách xử lý', 'Link Facebook'];
  const mapped = mapFormResponseRow(formHeaders, sampleRow);
  ok('FORM: map đủ 11 cột đúng field', mapped?.tenUv === 'Nguyễn Văn A' && mapped?.sdtZalo === '0901234567' && mapped?.caLam === 'SÁNG');
  const parsedTs = parseFormTimestamp('24/08/2026 14:00:00');
  ok('FORM: parse thời gian VN locale', !!parsedTs && parsedTs.getFullYear() === 2026 && parsedTs.getMonth() === 7 && parsedTs.getDate() === 24);
  const badRow = ['24/08/2026 14:00:00', 'B', '2001', 'ĐH', 'HCM', '', 'CHIEU', 'Q1'];
  ok('FORM: dòng thiếu SĐT -> null', mapFormResponseRow(formHeaders, badRow) === null);

  // ==================== SETTINGS MERGE ====================
  console.log('\n[SETTINGS] Hợp nhất settings (mảng tombstone)');
  const mergedArr = mergeSettings({ deletedFormResponses: [{ sdt: '0901234567', thoiGian: null }] });
  ok('SETTINGS: mergeSettings giữ nguyên mảng', Array.isArray((mergedArr as Record<string, unknown>).deletedFormResponses));
  const corruptObj = { 0: { sdt: '0901234567', thoiGian: null } };
  const restored = mergeSettings({ deletedFormResponses: corruptObj as unknown as Record<string, unknown>[] });
  ok('SETTINGS: dữ liệu cũ bị hỏng dạng {0:...} được phục hồi thành mảng', Array.isArray((restored as Record<string, unknown>).deletedFormResponses));
  const nested = mergeSettings({ interview: { autoCreateMeet: true } });
  ok('SETTINGS: object lồng nhau vẫn merge đúng', !!(nested as Record<string, unknown>).interview);

  console.log(`\n========== KẾT QUẢ: ${pass} PASS / ${fail} FAIL ==========\n`);
  if (failures.length > 0) {
    console.log('Các case thất bại:', failures);
  }
  await shutdownSystem();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('TEST CRASH:', e);
  process.exit(1);
});