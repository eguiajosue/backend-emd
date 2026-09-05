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

// Orden exacto requerido por el frontend (frontend-emd/src/lib/orderStatus.ts):
// en una DB nueva, Prisma autoincrementa el id según el orden de creación,
// por lo que sembrando en este orden quedan mapeados 1-5 correctamente.
const STATUS_NAMES = [
  'pendiente',
  'en pruebas',
  'en proceso',
  'terminado',
  'entregado',
];

const DEMO_COMPANIES = [
  {
    name: 'Textiles del Valle',
    phone: '+502 2345-6789',
    email: 'contacto@textilesdelvalle.com',
    address: '5a Avenida 12-34, Zona 4',
    location: 'Ciudad de Guatemala',
  },
  {
    name: 'Confecciones Andina',
    phone: '+502 2456-7890',
    email: 'ventas@confeccionesandina.com',
    address: 'Calzada Roosevelt 22-10',
    location: 'Mixco',
  },
  {
    name: 'Uniformes Express',
    phone: '+502 2567-8901',
    email: 'pedidos@uniformesexpress.com',
    address: '3a Calle 8-15, Zona 9',
    location: 'Ciudad de Guatemala',
  },
  {
    name: 'Bordados Real',
    phone: '+502 2678-9012',
    email: 'info@bordadosreal.com',
    address: 'Boulevard Los Próceres 4-56',
    location: 'Ciudad de Guatemala',
  },
  {
    name: 'Moda Corporativa SA',
    phone: '+502 2789-0123',
    email: 'servicioalcliente@modacorporativa.com',
    address: 'Avenida Reforma 9-40, Zona 10',
    location: 'Ciudad de Guatemala',
  },
];

const DEMO_CLIENTS = [
  { first_name: 'Carlos', last_name: 'Morales', phone: '+502 5123-4567', email: 'carlos.morales@textilesdelvalle.com' },
  { first_name: 'Ana', last_name: 'Ramírez', phone: '+502 5234-5678', email: 'ana.ramirez@confeccionesandina.com' },
  { first_name: 'Luis', last_name: 'García', phone: '+502 5345-6789', email: 'luis.garcia@uniformesexpress.com' },
  { first_name: 'María', last_name: 'López', phone: '+502 5456-7890', email: 'maria.lopez@bordadosreal.com' },
  { first_name: 'Jorge', last_name: 'Pérez', phone: '+502 5567-8901', email: 'jorge.perez@modacorporativa.com' },
];

const DEMO_ORDER_DESCRIPTIONS = [
  '50 camisas bordadas con logo',
  'Chalecos institucionales talla M-L',
  '100 gorras con bordado personalizado',
  'Uniformes completos para personal administrativo',
  'Playeras promocionales con estampado DTF',
];

function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return result;
}

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

  console.log('Seeding statuses...');
  const statuses: Record<string, { id: number }> = {};
  for (const name of STATUS_NAMES) {
    const status = await prisma.status.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    statuses[name] = status;
    console.log(`  status "${name}" ready (id=${status.id})`);
  }

  console.log('Seeding demo companies, clients and orders...');
  const existingOrderCount = await prisma.order.count();
  if (existingOrderCount >= 5) {
    console.log('Demo data already present, skipping.');
  } else {
    const companies: { id: number }[] = [];
    for (const companyData of DEMO_COMPANIES) {
      const company = await prisma.company.upsert({
        where: { name: companyData.name },
        update: {},
        create: companyData,
      });
      companies.push(company);
      console.log(`  company "${companyData.name}" ready (id=${company.id})`);
    }

    const clients: { id: number }[] = [];
    for (let i = 0; i < DEMO_CLIENTS.length; i++) {
      const clientData = DEMO_CLIENTS[i];
      const company = companies[i];
      let client = await prisma.client.findFirst({
        where: { email: clientData.email },
      });
      if (!client) {
        client = await prisma.client.create({
          data: {
            ...clientData,
            companyId: company.id,
          },
        });
        console.log(`  client "${clientData.first_name} ${clientData.last_name}" created (id=${client.id})`);
      } else {
        console.log(`  client "${clientData.first_name} ${clientData.last_name}" already exists (id=${client.id})`);
      }
      clients.push(client);
    }

    const admin = await prisma.user.findUnique({
      where: { username: ADMIN_USERNAME },
    });

    if (!admin) {
      console.log('  admin user not found, skipping demo orders.');
    } else {
      const now = new Date();

      const demoOrders = [
        {
          clientId: clients[0].id,
          statusId: statuses['pendiente'].id,
          description: DEMO_ORDER_DESCRIPTIONS[0],
          creationDate: now,
          deliveryDate: addDays(now, 1), // muy urgente: mañana
        },
        {
          clientId: clients[1].id,
          statusId: statuses['en pruebas'].id,
          description: DEMO_ORDER_DESCRIPTIONS[1],
          creationDate: now,
          deliveryDate: addDays(now, 4), // dentro de 3-4 días
        },
        {
          clientId: clients[2].id,
          statusId: statuses['en proceso'].id,
          description: DEMO_ORDER_DESCRIPTIONS[2],
          creationDate: now,
          deliveryDate: addDays(now, 7), // dentro de una semana
        },
        {
          clientId: clients[3].id,
          statusId: statuses['terminado'].id,
          description: DEMO_ORDER_DESCRIPTIONS[3],
          creationDate: now,
          deliveryDate: addDays(now, -2), // vencido: hace 2 días
        },
        {
          clientId: clients[4].id,
          statusId: statuses['entregado'].id,
          description: DEMO_ORDER_DESCRIPTIONS[4],
          creationDate: now,
          deliveryDate: addDays(now, 14), // muy a futuro / sin urgencia
        },
      ];

      for (const orderData of demoOrders) {
        const order = await prisma.order.create({
          data: {
            ...orderData,
            userId: admin.id,
          },
        });
        console.log(`  order "${order.description}" created (id=${order.id})`);
      }
    }
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
