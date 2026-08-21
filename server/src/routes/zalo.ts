import { Router, Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireWrite, requireRole, AuthedRequest } from '../middleware/auth';
import { zaloService } from '../services/ZaloService';
import { zaloPersonalService } from '../services/ZaloPersonalService';
import { saveSettings } from '../services/SettingsService';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { ApiError } from '../lib/errors';
import { nextId } from '../lib/id';

const router = Router();



router.get('/messages', requireAuth, async (req, res, next) => {
  try {
    const messages = await prisma.zaloMessage.findMany({
      where: req.query.candidateId ? { candidateId: String(req.query.candidateId) } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { candidate: { select: { tenUv: true } } },
    });
    res.json({ success: true, data: messages });
  } catch (e) {
    next(e);
  }
});

const sendSchema = z.object({ candidateId: z.string().min(1) });

router.post('/send', requireAuth, requireWrite(), async (req, res, next) => {
  try {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const result = await zaloService.sendTrainingNotice(parsed.data.candidateId);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

const chatSchema = z.object({
  candidateId: z.string().min(1),
  content: z.string().min(1, 'Nội dung tin nhắn không được để trống.'),
});

/** Nhắn tin trực tiếp 2 chiều (Live Chat) với ứng viên qua Zalo OA. */
router.post('/chat', requireAuth, requireWrite(), async (req: AuthedRequest, res, next) => {

  try {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Nội dung tin nhắn không được để trống.');
    const { candidateId, content } = parsed.data;

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true, sdtZalo: true, tenUv: true },
    });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    const result = await zaloService.sendText(candidate.sdtZalo, content.trim(), candidate.id);
    if (!result.ok) {
      throw ApiError.badRequest(
        'SEND_FAILED',
        result.error ?? 'Gửi tin Zalo thất bại. Nhờ ứng viên nhắn 1 tin bất kỳ cho OA để kết nối Zalo User ID.',
      );
    }
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});


/** Bật/tắt AI auto-reply cho tin nhắn ứng viên gửi vào OA. */
const autoReplySchema = z.object({ enabled: z.boolean() });

router.post('/auto-reply', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = autoReplySchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    await saveSettings({ zalo: { autoReply: parsed.data.enabled } }, req.user!.username);
    res.json({ success: true, data: { autoReply: parsed.data.enabled } });
  } catch (e) {
    next(e);
  }
});

/** Webhook Zalo OA: Nhận tin nhắn & sự kiện từ Zalo Server. */
router.get('/webhook', (_req, res) => {
  // Hỗ trợ GET verify URL cho các dịch vụ kiểm tra Webhook
  res.status(200).send('OK');
});

router.post('/webhook', (req, res) => {
  // QUY TẮC BẮT BUỘC ZALO WEBHOOK:
  // Phản hồi HTTP 200 OK ngay lập tức (< 10ms) để không bị Zalo hủy kết nối (lỗi HTTP 408 Timeout).
  res.status(200).json({ success: true, message: 'OK' });

  // Đẩy toàn bộ công việc lưu log DB & xử lý Zalo User ID + AI reply ra ngầm (Async Background)
  const payload = req.body;
  void (async () => {
    try {
      if (payload && typeof payload === 'object') {
        await prisma.webhookEvent.create({
          data: { id: nextId('WEB'), source: 'ZALO', payload: payload as object },
        }).catch(() => undefined);
        await zaloService.webhook(payload);
      }
    } catch (e) {
      console.error('[ZaloWebhook] Lỗi xử lý ngầm:', e instanceof Error ? e.message : String(e));
    }
  })();
});

/** Endpoints quản lý Zalo Cá Nhân (Tự động gửi tin theo SĐT) */
router.get('/personal/status', requireAuth, async (_req, res, next) => {
  try {
    const status = await zaloPersonalService.getStatus();
    res.json({ success: true, data: status });
  } catch (e) {
    next(e);
  }
});

router.post('/personal/qr', requireAuth, requireWrite(), async (req, res, next) => {
  try {
    const hostUrl = `${req.protocol}://${req.get('host')}`;
    const result = await zaloPersonalService.generateLoginQr(hostUrl);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

router.get('/personal/qr-status', requireAuth, async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const status = zaloPersonalService.checkQrStatus(token);
    res.json({ success: true, data: status });
  } catch (e) {
    next(e);
  }
});

/** Trang Web quét mã trên Điện Thoại di động */
router.get('/personal/scan-auth', async (req, res) => {
  const token = String(req.query.token || '');
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Xác nhận Đăng Nhập Zalo Cá Nhân</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 90vh; margin: 0; }
        .card { background: white; border-radius: 20px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); max-width: 380px; width: 100%; text-align: center; }
        .icon { width: 60px; h-60px; background: #0068ff; color: white; border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: bold; margin: 0 auto 16px; }
        h2 { font-size: 20px; color: #1e293b; margin: 0 0 8px; }
        p { font-size: 13px; color: #64748b; margin: 0 0 20px; line-height: 1.5; }
        .input-group { text-align: left; margin-bottom: 14px; }
        label { font-size: 12px; font-weight: bold; color: #334155; display: block; margin-bottom: 6px; }
        input { width: 100%; padding: 12px; border: 1.5px solid #cbd5e1; border-radius: 12px; font-size: 15px; box-sizing: border-box; outline: none; }
        input:focus { border-color: #0068ff; }
        button { width: 100%; background: #0068ff; color: white; border: none; padding: 14px; border-radius: 14px; font-size: 15px; font-weight: bold; cursor: pointer; margin-top: 10px; }
        .success { display: none; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; padding: 16px; border-radius: 14px; font-size: 14px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">Z</div>
        <h2>Xác Nhận Kết Nối Zalo</h2>
        <p>Xác nhận đăng nhập tài khoản Zalo cá nhân vào Hệ Thống Tuyển Dụng UmBo Milk</p>
        <div id="form">
          <div class="input-group">
            <label>Số Điện Thoại Zalo của bạn</label>
            <input id="phone" type="tel" placeholder="Ví dụ: 0333137633" required />
          </div>
          <div class="input-group">
            <label>Tên hiển thị Zalo (Tên HR / Chi nhánh)</label>
            <input id="name" type="text" placeholder="Ví dụ: Sếp Thiên IT" required />
          </div>
          <button onclick="submitAuth()">Xác Nhận Đăng Nhập Zalo</button>
        </div>
        <div id="success" class="success">
          🎉 Đã kết nối Zalo Cá nhân thành công!<br><span style="font-size:12px; font-weight:normal; color:#475569;">Bạn có thể đóng trang này và quay lại màn hình máy tính.</span>
        </div>
      </div>
      <script>
        async function submitAuth() {
          const phone = document.getElementById('phone').value.trim();
          const name = document.getElementById('name').value.trim();
          if (!phone || !name) { alert('Vui lòng điền đầy đủ SĐT và Tên Zalo.'); return; }
          try {
            const res = await fetch('/api/zalo/personal/confirm-scan-auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: '${token}', phone, name })
            });
            const data = await res.json();
            if (data.success) {
              document.getElementById('form').style.display = 'none';
              document.getElementById('success').style.display = 'block';
            } else {
              alert(data.message || 'Lỗi kết nối');
            }
          } catch {
            alert('Lỗi kết nối máy chủ.');
          }
        }
      </script>
    </body>
    </html>
  `);
});

router.post('/personal/confirm-scan-auth', async (req, res, next) => {
  try {
    const { token, phone, name } = req.body ?? {};
    if (!token || !phone || !name) throw ApiError.badRequest('INVALID_INPUT', 'Thiếu thông tin xác nhận.');
    const status = await zaloPersonalService.confirmScanAuth(token, phone, name);
    res.json({ success: true, data: status });
  } catch (e) {
    next(e);
  }
});

router.post('/personal/connect', requireAuth, requireWrite(), async (req, res, next) => {
  try {
    const { phone, name, avatar } = req.body;
    if (!phone || !name) throw ApiError.badRequest('INVALID_INPUT', 'Thiếu SĐT hoặc tên tài khoản Zalo.');
    const status = await zaloPersonalService.connectSession({ phone, name, avatar });
    res.json({ success: true, data: status });
  } catch (e) {
    next(e);
  }
});

router.post('/personal/logout', requireAuth, requireWrite(), async (_req, res, next) => {
  try {
    const status = await zaloPersonalService.logout();
    res.json({ success: true, data: status });
  } catch (e) {
    next(e);
  }
});

export default router;