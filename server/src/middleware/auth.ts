import type { NextFunction, Request, Response } from 'express';
import { authService } from '../services/AuthService';
import { ApiError } from '../lib/errors';

export interface AuthedRequest extends Request {
  user?: { id: string; username: string; fullName: string; role: string };
}

export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const me = await authService.me(req);
    if (!me) throw ApiError.unauthorized();
    req.user = me.user;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}

export function requireWrite() {
  return requireRole('ADMIN', 'HR');
}