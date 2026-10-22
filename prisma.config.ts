/**
 * Configuración de la CLI de Prisma (Prisma 7).
 *
 * Desde Prisma 7 la URL de la base no va en `schema.prisma`: la CLI
 * (`db push`, `generate`, `studio`, `db seed`) la lee de acá. La CLI tampoco
 * carga el `.env` sola, por eso se importa `dotenv/config`.
 */

import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // Lo que corre `npx prisma db seed` (y `npm run db:seed`).
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
