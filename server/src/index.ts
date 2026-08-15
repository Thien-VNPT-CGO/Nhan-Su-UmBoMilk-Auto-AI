import { env } from './config/env';
import { createApp, startSystem, shutdownSystem } from './app';

const { server } = createApp();
void startSystem(server).then(() => {
  server.listen(env.port, () => {
    console.log(`[UMBO MILK] Server running on http://localhost:${env.port}`);
    console.log(`[UMBO MILK] Timezone: ${env.timezone}`);
    console.log(`[UMBO MILK] Demo mode: ${env.demoMode ? 'ON' : 'OFF'}`);
  });
});

process.on('SIGINT', () => {
  void shutdownSystem().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdownSystem().finally(() => process.exit(0));
});