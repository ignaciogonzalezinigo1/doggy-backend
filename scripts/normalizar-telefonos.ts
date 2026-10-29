/**
 * Pasa a E.164 los teléfonos que ya están en la base (`npm run db:normalizar-telefonos`).
 *
 * Desde que la API guarda los teléfonos en E.164 (+5491145892310), los que se
 * cargaron antes pueden estar escritos de cualquier forma ("+54 9 11 4589-2310",
 * "0299 15 455-4060"). Este script los convierte con la misma función que usa
 * la API y la app (`aE164` de `src/lib/telefonos.ts`), que guarda todo número
 * como celular: también un fijo que ya estaba en E.164 sin el 9
 * ("+541147773020" → "+5491147773020"), porque asumimos que quien usa la app
 * tiene WhatsApp. No borra nada: si un teléfono está vacío, no se puede
 * interpretar, no tiene versión celular (0800, 0810) o es de otro país, lo
 * informa y lo deja como está. Muestra el antes y el después de cada uno. Se puede correr más de
 * una vez.
 *
 * El único campo de teléfono del schema es `Usuario.telefonoEmergencia`
 * (también lo usan las cuentas de clínicas, como Vet. San Roque).
 */

import { aE164 } from '../src/lib/telefonos';
import { prisma } from '../src/lib/prisma';

/**
 * Normaliza los teléfonos de todos los usuarios.
 * @returns una promesa que termina cuando se revisaron todos
 */
async function normalizar(): Promise<void> {
  const usuarios = await prisma.usuario.findMany({
    select: { id: true, nombre: true, telefonoEmergencia: true },
    orderBy: { id: 'asc' },
  });
  let cambiados = 0;
  let sinParsear = 0;
  for (const { id, nombre, telefonoEmergencia: antes } of usuarios) {
    const etiqueta = `${id} ${nombre}`;
    if (!antes.trim()) {
      console.log(`  ${etiqueta}: (vacío, queda igual)`);
      continue;
    }
    const despues = aE164(antes);
    if (!despues) {
      sinParsear += 1;
      console.log(`  ${etiqueta}: "${antes}" → no es un número argentino válido, queda igual`);
      continue;
    }
    if (despues === antes) {
      console.log(`  ${etiqueta}: "${antes}" (ya estaba en E.164)`);
      continue;
    }
    await prisma.usuario.update({ where: { id }, data: { telefonoEmergencia: despues } });
    cambiados += 1;
    console.log(`  ${etiqueta}: "${antes}" → "${despues}"`);
  }
  console.log(`Listo: ${cambiados} normalizados, ${sinParsear} sin poder interpretar, ${usuarios.length} usuarios en total.`);
}

normalizar()
  .catch((error: unknown) => {
    console.error('Falló la normalización:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
