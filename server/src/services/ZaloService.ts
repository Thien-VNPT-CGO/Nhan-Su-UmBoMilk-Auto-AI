import { prisma } from '../lib/prisma';
import { zaloPersonalService } from './ZaloPersonalService';
import { TZ, formatDate } from '../lib/date';

/** Định dạng giờ phỏng vấn "dd/MM/yyyy lúc HH:mm" theo múi giờ hệ thống. */
function formatInterviewTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} lúc ${get('hour')}:${get('minute')}`;
}

export class ZaloService {
  /** Gửi tin nhắn Zalo Cá Nhân trực tiếp theo SĐT của ứng viên (`sdtZalo`). */
  private async sendRaw(
    phone: string,
    content: string,
    candidateId: string | null,
    options: { direction?: string; messageType?: string; buttons?: Array<{ title: string; payload: string; type?: string }> } = {},
  ): Promise<{ ok: boolean; provider: string; messageId?: string; status: string; error?: string | null }> {
    // Luôn luôn gửi tin qua Zalo Cá Nhân trực tiếp theo SĐT của ứng viên (sdtZalo)
    const pRes = await zaloPersonalService.sendMessageByPhone(phone, content, candidateId, options);
    return {
      ok: pRes.ok,
      provider: pRes.provider,
      messageId: pRes.messageId,
      status: pRes.status,
      error: pRes.error,
    };
  }



  /** Gửi tin text tùy ý (dùng cho live chat, auto-reply, thông báo thủ công...). */
  async sendText(phone: string, content: string, candidateId: string | null): Promise<{ ok: boolean; status: string; error?: string | null }> {
    const r = await this.sendRaw(phone, content, candidateId);
    return { ok: r.ok, status: r.status, error: r.error };
  }


  async sendTrainingNotice(candidateId: string): Promise<{ ok: boolean; provider: string; messageId?: string }> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    if (!c.ngayBatDauTraining) throw new Error('Chưa có ngày bắt đầu Training');

    const nameGreeting = c.tenUv.trim().toLowerCase().startsWith('sếp') ? c.tenUv.trim() : `Sếp ${c.tenUv.trim()}`;

    const content = [
      '🐮 [UMBO MILK] – THÔNG BÁO LỊCH TRAINING 🎓',
      '',
      `Chào ${nameGreeting} ❤️`,
      'UMBO MILK thông báo lịch đào tạo (Training) của bạn như sau:',
      '',
      '📌 CHI TIẾT LỊCH TRAINING:',
      `• 📅 Ngày bắt đầu: ${formatDate(c.ngayBatDauTraining)}`,
      `• 🏢 Chi nhánh làm việc: ${c.chiNhanh}`,
      `• ⏱️ Ca làm việc chính thức: ${c.caLam}`,
      '',
      '👉 Vui lòng có mặt đúng giờ và thực hiện điểm danh theo hướng dẫn nhé!',
      '',
      'UMBO MILK chúc bạn có một quá trình đào tạo thuận lợi và hiệu quả! ✨',
    ].join('\n');

    const r = await this.sendRaw(c.sdtZalo, content, c.id);
    return { ok: r.ok, provider: r.provider, messageId: r.messageId };
  }

  /** Gửi lời mời phỏng vấn (thời gian + link GG Meet) cho ứng viên vừa được HR chấm PASS. */
  async sendInterviewInvite(candidateId: string): Promise<{ ok: boolean; provider: string; messageId?: string }> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    if (!c.phongVanAt) throw new Error('Chưa có thời gian phỏng vấn');
    if (!c.ggMeetLink) throw new Error('Chưa có link GG Meet');

    const nameGreeting = c.tenUv.trim().toLowerCase().startsWith('sếp') ? c.tenUv.trim() : `Sếp ${c.tenUv.trim()}`;

    const hostOrigin = process.env.PUBLIC_APP_URL || 'https://tuyendung.umbomilk.com';
    const confirmUrl = `${hostOrigin.replace(/\/$/, '')}/confirm-pv/${c.id}`;

    const content = [
      '🐮 [UMBO MILK] – THƯ MỜI PHỎNG VẤN 📋',
      '',
      `Chào ${nameGreeting} ❤️`,
      'Chúc mừng bạn đã vượt qua vòng lọc hồ sơ ứng tuyển của UMBO MILK!',
      '',
      '📌 THÔNG TIN PHỎNG VẤN:',
      `• ⏰ Thời gian: ${formatInterviewTime(c.phongVanAt)}`,
      `• 📍 Hình thức: Phỏng vấn Online qua Google Meet`,
      `• 🔗 Link Google Meet: ${c.ggMeetLink}`,
      `• 🏢 Chi nhánh ứng tuyển: ${c.chiNhanh}`,
      `• ⏱️ Ca làm việc đăng ký: ${c.caLam}`,
      '',
      '👉 VUI LÒNG BẤM LINK DƯỚI ĐÂY ĐỂ XÁC NHẬN THAM GIA PHỎNG VẤN 1-CLICK:',
      `🔗 ${confirmUrl}`,
      '',
      'UMBO MILK rất mong được gặp bạn! ✨',
    ].join('\n');

    const buttons = [
      { title: '✅ THAM GIA PHỎNG VẤN', payload: 'THAM GIA PHỎNG VẤN', type: 'oa.query' },
      { title: '❌ TỪ CHỐI', payload: 'TỪ CHỐI', type: 'oa.query' },
    ];

    const r = await this.sendRaw(c.sdtZalo, content, c.id, { buttons });
    return { ok: r.ok, provider: r.provider, messageId: r.messageId };
  }



  /** Nhắc phỏng vấn trước giờ PV (1 lần/lịch hẹn, chống trùng bằng marker trong nội dung). */
  async sendInterviewReminder(candidateId: string, remindHours: number): Promise<{ ok: boolean; status: string }> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    if (!c.phongVanAt || !c.ggMeetLink) throw new Error('Chưa có lịch phỏng vấn');

    const nameGreeting = c.tenUv.trim().toLowerCase().startsWith('sếp') ? c.tenUv.trim() : `Sếp ${c.tenUv.trim()}`;

    const marker = `[NHACPV:${c.phongVanAt.toISOString()}]`;
    const content = [
      marker,
      '🐮 [UMBO MILK] – NHẮC LỊCH PHỎNG VẤN ⏰',
      '',
      `Chào ${nameGreeting} ❤️`,
      `Chỉ còn ${remindHours} tiếng nữa là đến buổi phỏng vấn của bạn cùng UMBO MILK!`,
      '',
      '📌 THÔNG TIN LỊCH HẸN:',
      `• ⏰ Thời gian: ${formatInterviewTime(c.phongVanAt)}`,
      `• 🔗 Link phỏng vấn: ${c.ggMeetLink}`,
      '',
      '👉 Bạn vui lòng kiểm tra kết nối mạng và chuẩn bị tham gia đúng giờ nhé.',
      '',
      'UMBO MILK chúc bạn có buổi phỏng vấn thành công tốt đẹp! ✨',
    ].join('\n');

    const existed = await prisma.zaloMessage.findFirst({
      where: { phone: c.sdtZalo, content: { contains: marker } },
    });
    if (existed) return { ok: true, status: 'SKIP_DUP' };

    const r = await this.sendRaw(c.sdtZalo, content, c.id);
    return { ok: r.ok, status: r.status };
  }

  /** Nhắc điểm danh trước giờ làm 30 phút (1 ca = 1 tin/ngày, đánh dấu trong nội dung để không gửi trùng). */
  async sendShiftReminder(
    candidate: { id: string; tenUv: string; sdtZalo: string; chiNhanh: string },
    date: string,
    shift: string,
    shiftStart: string,
  ): Promise<{ ok: boolean; status: string }> {
    const marker = `[NHACDIEMDANH:${date}:${shift}]`;
    const content = [
      marker,
      '🐮 [UMBO MILK] – NHẮC NHỞ ĐIỂM DANH CA LÀM 🥤',
      '',
      `Chào Sếp ${candidate.tenUv} ❤️`,
      `Ca làm việc (${shift}) của bạn tại ${candidate.chiNhanh} sắp bắt đầu trong 30 phút tới.`,
      '',
      '👉 Vui lòng có mặt đúng giờ và mở Zalo thực hiện gửi Vị trí / Điểm danh nhé!',
      '',
      'Chúc bạn một ca làm việc tràn đầy năng lượng và hiệu quả! ✨',
    ].join('\n');

    const existed = await prisma.zaloMessage.findFirst({
      where: { phone: candidate.sdtZalo, content: { contains: marker } },
    });
    if (existed) return { ok: true, status: 'SKIP_DUP' };

    const r = await this.sendRaw(candidate.sdtZalo, content, candidate.id);
    return { ok: r.ok, status: r.status };
  }

  /** Gửi thông báo kết quả PV (ĐẠT / LOẠI) tự động qua Zalo cho ứng viên. */
  async sendInterviewOutcomeNotice(
    candidateId: string,
    decision: 'PASS_PV' | 'PASS_HS' | 'FAIL',
    note?: string
  ): Promise<{ ok: boolean; provider: string; messageId?: string }> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');

    const nameGreeting = c.tenUv.trim().toLowerCase().startsWith('sếp') ? c.tenUv.trim() : `Sếp ${c.tenUv.trim()}`;

    let content = '';

    if (decision === 'PASS_PV' || decision === 'PASS_HS') {
      const typeLabel = decision === 'PASS_HS' ? 'ĐẠT HỒ SƠ' : 'ĐẠT PHỎNG VẤN';
      content = [
        '🐮 [UMBO MILK] – THÔNG BÁO KẾT QUẢ TUYỂN DỤNG 🎉',
        '',
        `Chào ${nameGreeting} ❤️`,
        `Chúc mừng bạn đã xuất sắc đạt kết quả (${typeLabel}) trong đợt tuyển dụng của UMBO MILK!`,
        '',
        '📌 THÔNG TIN NHẬN VIỆC & ĐÀO TẠO:',
        `• 🏢 Chi nhánh chính thức: ${c.chiNhanh || 'Đang xếp chi nhánh'}`,
        `• ⏱️ Ca làm việc chính thức: ${c.caLam || 'Đang xếp ca'}`,
        `• 📅 Ngày bắt đầu đào tạo: ${c.ngayBatDauTraining ? formatDate(c.ngayBatDauTraining) : 'Theo lịch hẹn'}`,
        '',
        '📌 HỒ SƠ CẦN CHUẨN BỊ KHI NHẬN CA:',
        '1. Bản photo CCCD/CMND (kèm bản gốc để đối chiếu)',
        '2. Sơ yếu lý lịch / Giấy xác nhận hạnh kiểm',
        '3. 2 ảnh thẻ 3x4',
        '',
        note ? `📝 Ghi chú từ HR: ${note}\n` : '',
        'Vui lòng có mặt đúng giờ và giữ liên lạc với Quản lý chi nhánh nhé! Chúc bạn làm việc hiệu quả tại UMBO MILK! ✨',
      ].filter(Boolean).join('\n');
    } else {
      content = [
        '🐮 [UMBO MILK] – THƯ CẢM ƠN TỪ HỆ THỐNG TUYỂN DỤNG 💌',
        '',
        `Chào ${nameGreeting},`,
        'Cảm ơn bạn đã dành thời gian tham gia ứng tuyển và phỏng vấn vị trí công việc tại UMBO MILK.',
        '',
        'Rất tiếc tại thời điểm này, lịch làm việc hoặc thông tin ứng tuyển của bạn chưa thực sự phù hợp nhất với chỉ tiêu ca làm đợt này. UMBO MILK xin phép lưu lại thông tin của bạn và sẽ chủ động liên hệ khi có vị trí phù hợp trong tương lai.',
        '',
        'Chúc bạn luôn nhiều sức khỏe, may mắn và thành công trên con đường sự nghiệp! ✨',
      ].join('\n');
    }

    const r = await this.sendRaw(c.sdtZalo, content, c.id);
    return { ok: r.ok, provider: r.provider, messageId: r.messageId };
  }


  // Stubs cho backwards compatibility
  async tryResolveAndSaveUserId(_candidateId: string, _phone: string): Promise<string | null> {
    return null;
  }

  async ping(): Promise<{ ok: boolean; reason: string }> {
    return { ok: true, reason: 'ZALO_PERSONAL_ACTIVE' };
  }

  async ensureTokenFresh(): Promise<{ refreshed: boolean; reason?: string }> {
    return { refreshed: false, reason: 'NOT_NEEDED_FOR_PERSONAL' };
  }

  async webhook(_payload: unknown): Promise<void> { }
}

export const zaloService = new ZaloService();