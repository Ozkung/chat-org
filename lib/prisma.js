import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// One client per server process (Next dev hot-reload would otherwise open a new pool per edit).
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  (globalForPrisma.__prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  }));
