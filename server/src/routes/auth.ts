import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/AuthService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { ApiError } from '../lib/errors';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Thiếu tên đăng nhập hoặc mật khẩu.');
    const result = await authService.login(parsed.data.username, parsed.data.password, req, res);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

const twoFactorSchema = z.object({
  token: z.string().min(1),
  code: z.string().min(6).max(6),
});

router.post('/two-factor/verify', async (req, res, next) => {
  try {
    const parsed = twoFactorSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Mã xác thực phải là 6 chữ số.');
    const user = await authService.verifyTwoFactor(parsed.data.token, parsed.data.code, req, res);
    res.json({ success: true, data: { user } });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await authService.logout(req, res);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  res.json({ success: true, data: { user: req.user } });
});

router.get('/two-factor/status', requireAuth, async (req: AuthedRequest, res) => {
  res.json({ success: true, data: { enabled: !!req.user?.twoFactorEnabled } });
});

router.post('/two-factor/setup', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = z.object({ code: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const result = await authService.setupTwoFactor(req.user!.id, parsed.data.code);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

router.post('/two-factor/disable', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = z.object({ code: z.string().min(6) }).safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Mã xác thực phải là 6 chữ số.');
    const result = await authService.disableTwoFactor(req.user!.id, parsed.data.code);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6),
  totpCode: z.string().optional(),
});

router.post('/change-password', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Mật khẩu mới phải có ít nhất 6 ký tự.');
    const result = await authService.changePassword(
      req.user!.id,
      parsed.data.oldPassword,
      parsed.data.newPassword,
      parsed.data.totpCode,
    );
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

export default router;