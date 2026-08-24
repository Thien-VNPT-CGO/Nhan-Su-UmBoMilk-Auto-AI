import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = [
    { username: 'admin', fullName: 'Quản trị hệ thống', role: 'ADMIN', password: 'admin123' },
    { username: 'hr_umbomilk', fullName: 'HR UMBO Milk', role: 'HR', password: 'hr123456' },
    { username: 'viewer', fullName: 'Người xem', role: 'VIEWER', password: 'view1234' },
    { username: 'umbomilk', fullName: 'Quản lý Umbo Milk', role: 'MANAGER', password: 'ubm123456', allowedTabs: ['/shifts', '/approvals'] },
  ];
  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { username: u.username } });
    if (!existing) {
      await prisma.user.create({
        data: {
          username: u.username,
          fullName: u.fullName,
          role: u.role,
          password: bcrypt.hashSync(u.password, 10),
          allowedTabs: u.allowedTabs || null,
        },
      });
      console.log(`Created user: ${u.username}`);
    }
  }
  console.log('Seed done. Users: admin, hr_umbomilk/hr123456, viewer/view1234, umbomilk/ubm123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());