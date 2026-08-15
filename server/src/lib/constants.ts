export const ROLES = {
  ADMIN: 'ADMIN',
  HR: 'HR',
  VIEWER: 'VIEWER',
} as const;

export const SYNC_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SYNCED: 'SYNCED',
  RETRY: 'RETRY',
  FAILED: 'FAILED',
  CONFLICT: 'CONFLICT',
} as const;

export const TRAINING_STATUS = {
  CHUA_THAM_GIA: 'CHUA_THAM_GIA',
  SAP_BAT_DAU: 'SAP_BAT_DAU',
  BAT_DAU: 'BAT_DAU',
  HOAN_THANH: 'HOAN_THANH',
  KHONG_DU_NGAY: 'KHONG_DU_NGAY',
  LOAI: 'LOAI',
  NHAN_VIEN_CHINH_THUC: 'NHAN_VIEN_CHINH_THUC',
} as const;

export const HR_DECISION = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  REVIEW: 'REVIEW',
} as const;

export const AI_RECOMMENDATION = {
  PASS: 'PASS',
  FAIL: 'FAIL',
} as const;

export const SHIFTS = {
  SANG: 'SÁNG',
  CHIEU: 'CHIỀU',
  TOI: 'TỐI',
  OFF: 'OFF',
} as const;

export const SHIFT_KEYS = {
  SANG: 'SANG',
  CHIEU: 'CHIEU',
  TOI: 'TOI',
  OFF: 'OFF',
} as const;

export const SHIFT_TIMES = {
  SANG: { start: '06:45', end: '07:05' },
  CHIEU: { start: '11:45', end: '12:05' },
  TOI: { start: '17:45', end: '18:05' },
} as const;

export const TRAINING_DAYS_REQUIRED = 7;
export const TRAINING_DEADLINE_DAYS = 14;

export const DEFAULT_SETTINGS = {
  scoring: {
    rules: {
      hoTen: { enabled: true, score: 1 },
      namSinh: { enabled: true, score: 1 },
      queQuan: {
        enabled: true,
        score: 1,
        // provinces belong to Miền Tây / TP.HCM get +1
        allowed: ['Miền Tây', 'TP.HCM'],
      },
      sdt: { enabled: true, score: 1 },
      trinhDo: {
        enabled: true,
        scores: {
          SinhVienDaiHoc_CaoDang: 1,
          NghiHoc: 2,
        },
      },
      kinhNghiem: {
        enabled: true,
        scores: {
          NO_EXPERIENCE: 0,
          OTHER_EXPERIENCE: 1,
          FNB_EXPERIENCE: 2,
        },
      },
      xuLy: { enabled: true, score: 1 },
      linkFb: { enabled: true, score: 0 },
    },
    passThreshold: 7,
  },
  attendance: {
    shifts: {
      SANG: { start: '06:45', end: '07:05', windowMinutesBefore: 30, windowMinutesAfter: 10 },
      CHIEU: { start: '11:45', end: '12:05', windowMinutesBefore: 30, windowMinutesAfter: 10 },
      TOI: { start: '17:45', end: '18:05', windowMinutesBefore: 30, windowMinutesAfter: 10 },
    },
    trainingDaysRequired: 7,
    trainingDeadlineDays: 14,
  },
  ai: {
    provider: 'mock',
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.3,
  },
  googleSheet: {
    spreadsheetId: '',
    serviceAccountEmail: '',
    privateKey: '',
    sheets: {
      locHoSo: 'LOC_HO_SO_PV',
      diemUv: 'DIEM_UV',
      hoSoNv: 'HO_SO_NHAN_VIEN_UNG_TUYEN',
    },
  },
  zalo: {
    oaId: '',
    accessToken: '',
    refreshToken: '',
  },
};
