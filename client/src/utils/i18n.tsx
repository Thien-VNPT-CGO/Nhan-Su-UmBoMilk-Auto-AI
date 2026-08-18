import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

export type Lang = 'vi' | 'en';

type Msg = { vi: string; en: string };

// ===== Từ điển: giao diện chính (nav, header, nút bấm, tiêu đề trang) =====
export const MESSAGES: Record<string, Msg> = {
  'nav.dashboard': { vi: 'Tổng quan', en: 'Dashboard' },
  'nav.candidates': { vi: 'Ứng viên', en: 'Candidates' },
  'nav.scoring': { vi: 'AI chấm hồ sơ', en: 'AI Scoring' },
  'nav.training': { vi: 'Đào tạo', en: 'Training' },
  'nav.shifts': { vi: 'Lịch làm việc', en: 'Shifts' },
  'nav.attendance': { vi: 'Điểm danh', en: 'Attendance' },
  'nav.zalo': { vi: 'Zalo', en: 'Zalo' },
  'nav.reports': { vi: 'Báo cáo', en: 'Reports' },
  'nav.elearning': { vi: 'E-learning', en: 'E-learning' },
  'nav.sync': { vi: 'Đồng bộ dữ liệu', en: 'Sync' },
  'nav.audit': { vi: 'Nhật ký', en: 'Audit Log' },
  'nav.settings': { vi: 'Cài đặt', en: 'Settings' },

  'header.demoMode': { vi: 'DEMO MODE', en: 'DEMO MODE' },
  'header.sheet': { vi: 'Google Sheet', en: 'Google Sheet' },
  'header.conflict': { vi: 'Xung đột', en: 'Conflict' },
  'header.syncError': { vi: 'Lỗi kết nối', en: 'Sync error' },
  'header.pending': { vi: 'dữ liệu đang chờ', en: 'items pending' },
  'header.synced': { vi: 'Đồng bộ', en: 'Synced' },
  'header.notifications': { vi: 'Thông báo', en: 'Notifications' },
  'header.markAllRead': { vi: 'Đánh dấu đã đọc', en: 'Mark all read' },
  'header.noNotifications': { vi: 'Không có thông báo nào', en: 'No notifications' },
  'header.darkMode': { vi: 'Chế độ tối', en: 'Dark mode' },
  'header.language': { vi: 'Ngôn ngữ', en: 'Language' },
  'header.logout': { vi: 'Đăng xuất', en: 'Log out' },
  'header.loggedOut': { vi: 'Đã đăng xuất.', en: 'Logged out.' },
  'header.subtitle': { vi: 'Tuyển dụng & Đào tạo AI', en: 'AI Recruitment & Training' },

  'common.save': { vi: 'Lưu cài đặt', en: 'Save' },
  'common.saving': { vi: 'Đang lưu...', en: 'Saving...' },
  'common.cancel': { vi: 'Hủy', en: 'Cancel' },
  'common.confirm': { vi: 'Xác nhận', en: 'Confirm' },
  'common.delete': { vi: 'Xóa', en: 'Delete' },
  'common.close': { vi: 'Đóng', en: 'Close' },
  'common.search': { vi: 'Tìm kiếm...', en: 'Search...' },
  'common.all': { vi: 'Tất cả', en: 'All' },
  'common.none': { vi: 'Không có dữ liệu', en: 'No data' },
  'common.loading': { vi: 'Đang tải...', en: 'Loading...' },
  'common.export': { vi: 'Tải CSV', en: 'Export CSV' },
  'common.back': { vi: 'Quay lại', en: 'Back' },

  'login.title': { vi: 'Đăng nhập', en: 'Sign in' },
  'login.subtitle': { vi: 'Hệ thống tuyển dụng & đào tạo UMBO MILK', en: 'UMBO MILK recruitment & training system' },
  'login.username': { vi: 'Tên đăng nhập', en: 'Username' },
  'login.password': { vi: 'Mật khẩu', en: 'Password' },
  'login.submit': { vi: 'Đăng nhập', en: 'Sign in' },
  'login.twoFactorTitle': { vi: 'Xác thực 2 bước', en: 'Two-factor authentication' },
  'login.twoFactorHint': { vi: 'Nhập mã 6 chữ số từ Google Authenticator', en: 'Enter the 6-digit code from your authenticator app' },
  'login.verify': { vi: 'Xác thực', en: 'Verify' },

  'reports.title': { vi: 'Báo cáo tháng', en: 'Monthly report' },
  'reports.month': { vi: 'Tháng', en: 'Month' },
  'reports.candidates': { vi: 'Tuyển dụng', en: 'Recruitment' },
  'reports.new': { vi: 'Hồ sơ mới', en: 'New profiles' },
  'reports.scored': { vi: 'Đã chấm điểm', en: 'Scored' },
  'reports.pendingDecision': { vi: 'Chờ duyệt', en: 'Pending decision' },
  'reports.pass': { vi: 'Đạt', en: 'Pass' },
  'reports.fail': { vi: 'Rớt', en: 'Fail' },
  'reports.review': { vi: 'Cần xem lại', en: 'Review' },
  'reports.byBranch': { vi: 'Theo chi nhánh', en: 'By branch' },
  'reports.training': { vi: 'Đào tạo', en: 'Training' },
  'reports.inTraining': { vi: 'Đang đào tạo', en: 'In training' },
  'reports.completed': { vi: 'Hoàn thành', en: 'Completed' },
  'reports.notEnoughDays': { vi: 'Không đủ ngày', en: 'Not enough days' },
  'reports.loai': { vi: 'Loại', en: 'Dismissed' },
  'reports.employees': { vi: 'Nhân viên chính thức', en: 'Official staff' },
  'reports.started': { vi: 'Bắt đầu tháng này', en: 'Started this month' },
  'reports.attendance': { vi: 'Chấm công', en: 'Attendance' },
  'reports.totalChecks': { vi: 'Tổng lượt điểm danh', en: 'Total check-ins' },
  'reports.valid': { vi: 'Hợp lệ', en: 'Valid' },
  'reports.absent': { vi: 'Vắng', en: 'Absent' },
  'reports.zalo': { vi: 'Zalo', en: 'Zalo' },
  'reports.sent': { vi: 'Tin đã gửi', en: 'Sent' },
  'reports.received': { vi: 'Tin nhận', en: 'Received' },
  'reports.failed': { vi: 'Tin lỗi', en: 'Failed' },
  'reports.byShift': { vi: 'Theo ca', en: 'By shift' },
  'reports.byMethod': { vi: 'Theo phương thức', en: 'By method' },

  'elearning.title': { vi: 'E-learning', en: 'E-learning' },
  'elearning.newCourse': { vi: 'Tạo khóa học', en: 'New course' },
  'elearning.courseTitle': { vi: 'Tên khóa học', en: 'Course title' },
  'elearning.description': { vi: 'Mô tả', en: 'Description' },
  'elearning.lessons': { vi: 'bài học', en: 'lessons' },
  'elearning.addLesson': { vi: 'Thêm bài học', en: 'Add lesson' },
  'elearning.lessonTitle': { vi: 'Tiêu đề bài học', en: 'Lesson title' },
  'elearning.content': { vi: 'Nội dung', en: 'Content' },
  'elearning.questions': { vi: 'Câu hỏi', en: 'Questions' },
  'elearning.addQuestion': { vi: 'Thêm câu hỏi', en: 'Add question' },
  'elearning.question': { vi: 'Câu hỏi', en: 'Question' },
  'elearning.option': { vi: 'Lựa chọn', en: 'Option' },
  'elearning.correct': { vi: 'Đáp án đúng', en: 'Correct answer' },
  'elearning.explanation': { vi: 'Giải thích', en: 'Explanation' },
  'elearning.saveQuestions': { vi: 'Lưu câu hỏi', en: 'Save questions' },
  'elearning.noCourses': { vi: 'Chưa có khóa học nào. Tạo khóa học đầu tiên!', en: 'No courses yet. Create your first course!' },
  'elearning.quizPassed': { vi: 'Đạt', en: 'Passed' },
  'elearning.quizFailed': { vi: 'Chưa đạt', en: 'Failed' },
  'elearning.score': { vi: 'Điểm', en: 'Score' },
  'elearning.attempts': { vi: 'lượt làm bài', en: 'attempts' },
  'elearning.view': { vi: 'Xem', en: 'View' },

  'settings.branches': { vi: 'Chi nhánh', en: 'Branches' },
  'settings.branchesHint': { vi: 'Cấu hình tọa độ GPS + bán kính cho từng chi nhánh (dùng cho geofence chấm công).', en: 'Configure GPS coordinates + radius per branch (used for check-in geofence).' },
  'settings.branchName': { vi: 'Tên chi nhánh', en: 'Branch name' },
  'settings.lat': { vi: 'Vĩ độ', en: 'Latitude' },
  'settings.lng': { vi: 'Kinh độ', en: 'Longitude' },
  'settings.radius': { vi: 'Bán kính (m)', en: 'Radius (m)' },
  'settings.addBranch': { vi: 'Thêm chi nhánh', en: 'Add branch' },
  'settings.geofence': { vi: 'Bật chấm công theo vị trí (geofence)', en: 'Enable GPS check-in (geofence)' },
  'settings.notifications': { vi: 'Thông báo', en: 'Notifications' },
  'settings.telegramBot': { vi: 'Telegram Bot Token', en: 'Telegram Bot Token' },
  'settings.telegramChat': { vi: 'Telegram Chat ID', en: 'Telegram Chat ID' },
  'settings.slackWebhook': { vi: 'Slack Webhook URL', en: 'Slack Webhook URL' },
  'settings.queueAlert': { vi: 'Cảnh báo queue nghẽn sau (phút)', en: 'Queue stuck alert after (minutes)' },
  'settings.testNotification': { vi: 'Gửi thông báo thử', en: 'Send test notification' },
  'settings.security': { vi: 'Bảo mật', en: 'Security' },
  'settings.twoFactor': { vi: 'Xác thực 2 bước (2FA)', en: 'Two-factor auth (2FA)' },
  'settings.twoFactorEnabled': { vi: '2FA đang BẬT', en: '2FA is ON' },
  'settings.twoFactorDisabled': { vi: '2FA đang TẮT', en: '2FA is OFF' },
  'settings.enable2fa': { vi: 'Bật 2FA', en: 'Enable 2FA' },
  'settings.disable2fa': { vi: 'Tắt 2FA', en: 'Disable 2FA' },
  'settings.scanQr': { vi: 'Quét mã QR bằng Google Authenticator hoặc Authy, rồi nhập mã:', en: 'Scan the QR with Google Authenticator or Authy, then enter the code:' },
  'settings.changePassword': { vi: 'Đổi mật khẩu', en: 'Change password' },
  'settings.oldPassword': { vi: 'Mật khẩu hiện tại', en: 'Current password' },
  'settings.newPassword': { vi: 'Mật khẩu mới', en: 'New password' },
  'settings.2faCode': { vi: 'Mã 6 chữ số', en: '6-digit code' },
  'settings.backup': { vi: 'Sao lưu', en: 'Backup' },
  'settings.backupNow': { vi: 'Sao lưu ngay', en: 'Back up now' },
  'settings.backupHint': { vi: 'Sao lưu tự động mỗi 7 ngày. Bản sao lưu lưu trong hệ thống + Google Drive (nếu có service account).', en: 'Automatic backup every 7 days. Backups stored in the system + Google Drive (if service account configured).' },
  'settings.restore': { vi: 'Khôi phục', en: 'Restore' },
  'settings.restoreConfirm': { vi: 'Khôi phục sẽ thay thế toàn bộ dữ liệu hiện tại (ứng viên, điểm danh, khóa học...). Bạn có chắc?', en: 'Restore will replace all current data (candidates, attendance, courses...). Are you sure?' },
  'settings.download': { vi: 'Tải về', en: 'Download' },
  'settings.manual': { vi: 'Thủ công', en: 'Manual' },
  'settings.auto': { vi: 'Tự động', en: 'Auto' },
  'settings.status': { vi: 'Trạng thái', en: 'Status' },
  'settings.size': { vi: 'Dung lượng', en: 'Size' },
  'settings.createdAt': { vi: 'Thời gian', en: 'Time' },
  'settings.branchScope': { vi: 'Phạm vi chi nhánh (trống = tất cả)', en: 'Branch scope (empty = all)' },
  'settings.kind': { vi: 'Loại', en: 'Kind' },
  'settings.users': { vi: 'Tài khoản', en: 'Users' },
  'settings.active': { vi: 'Hoạt động', en: 'Active' },
  'settings.zaloAutoReply': { vi: 'AI tự trả lời tin nhắn Zalo', en: 'AI auto-reply Zalo messages' },

  'zalo.incoming': { vi: 'Nhận', en: 'Incoming' },
  'zalo.outgoing': { vi: 'Gửi', en: 'Outgoing' },
  'zalo.location': { vi: 'Vị trí', en: 'Location' },
};

export function getMessage(lang: Lang, key: string, fallback = key): string {
  const msg = MESSAGES[key];
  if (!msg) return fallback;
  return msg[lang];
}

interface I18nState {
  lang: Lang;
  t: (key: string, fallback?: string) => string;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nState | null>(null);

const STORAGE_KEY = 'umbomilk_lang';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return saved === 'en' ? 'en' : 'vi';
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l === 'vi' ? 'vi' : 'en';
  }, []);

  const t = useCallback((key: string, fallback?: string) => getMessage(lang, key, fallback), [lang]);

  return <I18nContext.Provider value={{ lang, t, setLang }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}