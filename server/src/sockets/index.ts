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
  io.to('sync-room').emit('sync:status', payload);
}