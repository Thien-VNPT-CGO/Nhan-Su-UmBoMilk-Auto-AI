import 'dotenv/config';
import { prisma } from '../lib/prisma';

const models = [
  'attendanceEvent',
  'shift',
  'syncJob',
  'webhookEvent',
  'auditLog',
  'conflict',
  'reconciliationRun',
  'idempotencyKey',
  'zaloMessage',
  'session',
  'candidate',
] as const;

(async () => {
  for (const m of models) {
    const count = await (prisma as unknown as Record<string, { deleteMany: () => Promise<{ count: number }> }>)[m].deleteMany();
    console.log(`Xóa ${m}: ${count.count}`);
  }
  const users = await prisma.user.count();
  const settings = await prisma.systemSetting.count();
  const candidates = await prisma.candidate.count();
  console.log(`Còn lại: user=${users}, systemSetting=${settings}, candidate=${candidates}`);
  await prisma.$disconnect();
})();