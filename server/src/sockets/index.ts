import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';

export let io: Server | null = null;

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
  });
  io.on('connection', (socket) => {
    socket.on('subscribe:sync', () => {
      socket.join('sync-room');
    });
  });
  return io;
}

export function emit(event: string, payload: unknown): void {
  if (!io) return;
  io.emit(event, payload);
}

export function emitSync(payload: unknown): void {
  if (!io) return;
  throttledRoomEmit('sync-room', 'sync:status', payload);
}

// ===== Coalescing: mỗi job đồng bộ đều emit -> khi xử lý hàng loạt (import 50 hồ sơ,
// fullResync...) hàng trăm event/giây khiến web client liên tục refetch, tải DB tăng vọt.
// Throttle: mỗi event chỉ phát tối đa 1 lần / 1.5s, giữ payload mới nhất. =====
const SYNC_EVENT_INTERVAL_MS = 1500;
const throttles = new Map<string, { lastAt: number; pending: unknown; timer: NodeJS.Timeout | null }>();
const roomThrottles = new Map<string, { lastAt: number; pending: unknown; timer: NodeJS.Timeout | null }>();

function throttledEmit(event: string, payload: unknown): void {
  if (!io) return;
  const t = throttles.get(event) ?? { lastAt: 0, pending: null, timer: null };
  t.pending = payload;
  throttles.set(event, t);
  const now = Date.now();
  const wait = Math.max(0, SYNC_EVENT_INTERVAL_MS - (now - t.lastAt));
  if (t.timer) clearTimeout(t.timer);
  t.timer = setTimeout(() => {
    t.timer = null;
    t.lastAt = Date.now();
    const latest = t.pending;
    t.pending = null;
    io!.emit(event, latest);
  }, wait);
}

function throttledRoomEmit(room: string, event: string, payload: unknown): void {
  if (!io) return;
  const key = `${room}\u0000${event}`;
  const t = roomThrottles.get(key) ?? { lastAt: 0, pending: null, timer: null };
  t.pending = payload;
  roomThrottles.set(key, t);
  const now = Date.now();
  const wait = Math.max(0, SYNC_EVENT_INTERVAL_MS - (now - t.lastAt));
  if (t.timer) clearTimeout(t.timer);
  t.timer = setTimeout(() => {
    t.timer = null;
    t.lastAt = Date.now();
    const latest = t.pending;
    t.pending = null;
    io!.to(room).emit(event, latest);
  }, wait);
}

/** Sync job hoàn tất -> gộp để client không refetch toàn bộ mỗi job. */
export function emitSyncSuccess(payload: unknown): void {
  throttledEmit('sync:success', payload);
}

/** Thông báo 1 lần cho các thao tác nền dài (provision/fullResync). */
export function emitSyncNotice(kind: string, payload: unknown): void {
  if (!io) return;
  io.emit('sync:notice', { kind, ...(payload as object) });
}