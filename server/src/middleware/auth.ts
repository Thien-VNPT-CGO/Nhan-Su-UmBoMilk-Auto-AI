import type { NextFunction, Request, Response } from 'express';
import { authService } from '../services/AuthService';
import { ApiError } from '../lib/errors';

export interface AuthedUser {
  id: string;
  username: string;
  fullName: string;
  role: string;
  twoFactorEnabled?: boolean;
  branchScope?: string[] | null;
}

export interface AuthedRequest extends Request {
  user?: AuthedUser;
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

/** Phân quyền theo chi nhánh: ADMIN hoặc user không giới hạn -> xem tất cả. */
export function branchScope(user?: AuthedUser): string[] | null {
  if (!user || user.role === 'ADMIN') return null;
  const scopes = Array.isArray(user.branchScope) ? user.branchScope.filter(Boolean) : [];
  return scopes.length > 0 ? scopes : null;
}

/** Prisma where clause cho Candidate theo phạm vi chi nhánh của user (null = tất cả). */
export function branchWhere(user?: AuthedUser): Record<string, unknown> {
  const scopes = branchScope(user);
  return scopes ? { chiNhanh: { in: scopes } } : {};
}

/** Kiểm tra 1 chi nhánh có nằm trong phạm vi của user không. */
export function canAccessBranch(user: AuthedUser | undefined, chiNhanh: string): boolean {
  const scopes = branchScope(user);
  if (!scopes) return true;
  return scopes.includes(chiNhanh);
}