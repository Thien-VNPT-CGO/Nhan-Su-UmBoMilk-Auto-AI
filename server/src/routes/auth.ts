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
    const user = await authService.login(parsed.data.username, parsed.data.password, req, res);
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

export default router;