/**
 * Instancia única de Prisma Client para toda la API.
 *
 * Prisma 7 no trae un motor propio para conectarse a la base: usa un driver
 * adapter. Para SQLite es `@prisma/adapter-better-sqlite3`, que recibe la
 * misma `DATABASE_URL` que usa la CLI en `prisma.config.ts`.
 */

import 'dotenv/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Falta DATABASE_URL en el .env (copiá .env.example).');
}

const adapter = new PrismaBetterSqlite3({ url });

/** Cliente de Prisma compartido por las rutas y el seed. */
export const prisma = new PrismaClient({ adapter });
