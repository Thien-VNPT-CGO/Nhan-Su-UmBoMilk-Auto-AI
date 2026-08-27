import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const metaEnv = (import.meta as unknown as { env?: { VITE_API_URL?: string; VITE_API_BASE_URL?: string } }).env;
    const rawUrl = metaEnv?.VITE_API_URL || metaEnv?.VITE_API_BASE_URL;
    const targetUrl = rawUrl
      ? rawUrl.replace(/\/api\/?$/, '')
      : window.location.origin;
    socket = io(targetUrl, { withCredentials: true, transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}