import { env } from './config/env';
import { createApp, startSystem, shutdownSystem } from './app';

// Node 15+ mặc định CRASH khi có promise rejection chưa xử lý.
// Trên Render free (DB đôi khi giật) một lỗi nhỏ không được phép giết cả server.
process.on('unhandledRejection', (reason) => {
  console.warn('[UMBO MILK] unhandledRejection:', reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason));
});
process.on('uncaughtException', (err) => {
  console.error('[UMBO MILK] uncaughtException:', err.message, err.stack ?? '');
});

const { server } = createApp();

server.listen(env.port, () => {
  console.log(`[UMBO MILK] Server running on http://localhost:${env.port}`);
  console.log(`[UMBO MILK] Timezone: ${env.timezone}`);
  console.log(`[UMBO MILK] Demo mode: ${env.demoMode ? 'ON' : 'OFF'}`);

  void startSystem(server).catch((e) => {
    console.error('[UMBO MILK] Background startSystem failed:', e instanceof Error ? e.message : String(e));
  });
});

process.on('SIGINT', () => {
  void shutdownSystem().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdownSystem().finally(() => process.exit(0));
});