export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  static badRequest(code: string, message: string) {
    return new ApiError(400, code, message);
  }
  static unauthorized(message = 'Chưa đăng nhập hoặc phiên hết hạn.') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'Không có quyền thực hiện thao tác này.') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(code = 'NOT_FOUND', message = 'Không tìm thấy dữ liệu.') {
    return new ApiError(404, code, message);
  }
  static conflict(code = 'CONFLICT', message = 'Xung đột dữ liệu.') {
    return new ApiError(409, code, message);
  }
  static internal(message = 'Lỗi hệ thống.') {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
