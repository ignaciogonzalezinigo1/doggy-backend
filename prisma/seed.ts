/**
 * Datos de ejemplo para la base local.
 *
 * Corre con `npm run db:seed` (y al final de `npm run db:reset`). Todavía no
 * hay modelos en el schema; cuando los haya, acá se cargan los mismos datos de
 * ejemplo que usa el front en doggy/mobile/src/data/mock.ts.
 */

import { prisma } from '../src/lib/prisma';

/**
 * Carga los datos de ejemplo en la base.
 * @returns una promesa que termina cuando se cargó todo
 */
async function sembrar(): Promise<void> {
  console.log('Seed: todavía no hay modelos para cargar.');
}

sembrar()
  .catch((error: unknown) => {
    console.error('Falló el seed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
