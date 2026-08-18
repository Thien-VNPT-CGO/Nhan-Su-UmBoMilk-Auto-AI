import type { NextFunction, Request, Response } from 'express';
import { isApiError } from '../lib/errors';
import { randomId } from '../lib/id';
import { prisma } from '../lib/prisma';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

export function requestId(req: Request, _res: Response, next: NextFunction) {
  const rid = req.headers['x-request-id'];
  req.requestId = Array.isArray(rid) ? rid[0] : rid ?? randomId('REQ');
  next();
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: 'Không tìm thấy route.',
    requestId: (_req as Request & { requestId?: string }).requestId,
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = (req as Request & { requestId?: string }).requestId;
  if (isApiError(err)) {
    res.status(err.status).json({
      success: false,
      code: err.code,
      message: err.message,
      requestId,
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Lỗi hệ thống.';
  const status = /JSON/.test(message) ? 400 : 500;
  // Monitoring: lỗi 5xx đẩy lên Sentry (nếu SENTRY_DSN được cấu hình)
  if (status === 500) {
    void import('../lib/sentry')
      .then(({ captureError }) => captureError(err, { requestId, url: req.originalUrl }))
      .catch(() => undefined);
  }
  res.status(status).json({
    success: false,
    code: status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
    message,
    requestId,
  });
}

export function apiLog(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    // Chỉ ghi log request CHẬM (>1s) hoặc LỖI để giảm tải DB - không ghi mọi request
    if (res.statusCode < 400 && durationMs <= 1000) return;
    prisma.apiLog
      .create({
        data: {
          id: randomId('LOG'),
          method: req.method,
          path: req.originalUrl.slice(0, 255),
          status: res.statusCode,
          durationMs,
          ip: req.ip ?? null,
        },
      })
      .catch(() => undefined);
  });
  next();
}