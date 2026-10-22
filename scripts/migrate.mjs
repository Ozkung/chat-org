// Applies pending Prisma migrations during `npm run build` when a database is configured.
import { execSync } from 'node:child_process';
import 'dotenv/config';

if (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL) {
  execSync('prisma migrate deploy', { stdio: 'inherit' });
} else {
  console.warn('⚠ DATABASE_URL is not set: skipping database migrations.');
}
