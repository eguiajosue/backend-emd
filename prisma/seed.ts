import { PrismaClient } from '@prisma/client';
import * as bcryptjs from 'bcryptjs';

const prisma = new PrismaClient();

// Nombres de roles usados en los controllers via @Auth(...) (ver src/common/enums/roles.enum.ts)
const ROLE_NAMES = [
  'admin',
  'taller',
  'recepcion',
  'superuser',
  'dtf',
  'bordado',
  'diseno',
  'laser',
  'impresiones',
];

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';

async function main() {
  console.log('Seeding roles...');
  const roles: Record<string, { id: number }> = {};
  for (const name of ROLE_NAMES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    roles[name] = role;
    console.log(`  role "${name}" ready (id=${role.id})`);
  }

  console.log('Seeding admin user...');
  const hashedPassword = await bcryptjs.hash(ADMIN_PASSWORD, 10);

  const existingAdmin = await prisma.user.findUnique({
    where: { username: ADMIN_USERNAME },
  });

  if (existingAdmin) {
    await prisma.user.update({
      where: { username: ADMIN_USERNAME },
      data: {
        password: hashedPassword,
        roles: { connect: [{ id: roles['admin'].id }] },
      },
    });
    console.log(`  admin user already existed, password and role reset (id=${existingAdmin.id})`);
  } else {
    const admin = await prisma.user.create({
      data: {
        firstName: 'Admin',
        lastName: 'User',
        username: ADMIN_USERNAME,
        password: hashedPassword,
        roles: { connect: [{ id: roles['admin'].id }] },
      },
    });
    console.log(`  admin user created (id=${admin.id})`);
  }

  console.log('Seed completed.');
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(
      `Using default admin password. Set SEED_ADMIN_PASSWORD env var to override.`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
