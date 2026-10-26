/**
 * Pasa la edad de las mascotas a fecha de nacimiento sin perder datos
 * (`npm run db:migrar-fecha-nacimiento`).
 *
 * Es para una base creada antes de que `Mascota.edad` (años) se cambiara por
 * `Mascota.fechaNacimiento`. Con el schema nuevo, `prisma db push` solo no
 * alcanza: no puede crear una columna obligatoria sin valor para las filas
 * que ya están. Por eso el npm script hace tres pasos:
 * 1. Este script suma `fechaNacimiento` como columna opcional (SQL directo,
 *    sin tocar el resto) y la completa para cada mascota con hoy menos su
 *    edad en años.
 * 2. `prisma db push --accept-data-loss` saca la columna `edad` y deja
 *    `fechaNacimiento` obligatoria. Prisma rehace la tabla copiando las filas.
 * 3. `prisma generate` regenera el cliente.
 *
 * Se puede correr más de una vez: si la columna ya existe no la vuelve a
 * crear y solo completa las que estén vacías. Si queda alguna sin fecha,
 * corta con error antes del `db push`.
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { isAbsolute, resolve } from 'node:path';
import { hoy } from '../src/validaciones';

/** Prefijo de las URLs de SQLite. */
const PREFIJO_FILE = 'file:';
/** Raíz del repo: las rutas relativas de la URL son relativas a ella, como en `prisma.config.ts`. */
const RAIZ = resolve(import.meta.dirname, '..');

/**
 * Ruta del archivo de la base a partir de la `DATABASE_URL`.
 * @param url la `DATABASE_URL` del `.env`
 * @returns la ruta absoluta del archivo
 */
function rutaDeLaBase(url: string): string {
  if (!url.startsWith(PREFIJO_FILE)) throw new Error(`La DATABASE_URL no es de SQLite: ${url}`);
  const ruta = url.slice(PREFIJO_FILE.length).replace(/^\/\//, '');
  return isAbsolute(ruta) ? ruta : resolve(RAIZ, ruta);
}

/**
 * Fecha de hoy (Argentina) menos una cantidad de años, en el formato en que
 * Prisma guarda un DateTime en SQLite.
 * @param anios años a restar
 * @returns la fecha a medianoche UTC, como texto ISO
 */
function haceAnios(anios: number): string {
  const base = hoy();
  const fecha = new Date(Date.UTC(base.getUTCFullYear() - anios, base.getUTCMonth(), base.getUTCDate()));
  return fecha.toISOString().replace('Z', '+00:00');
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL en el .env (copiá .env.example).');
  process.exit(1);
}

const ruta = rutaDeLaBase(url);
const db = new Database(ruta);
const columnas = (db.prepare('pragma table_info("Mascota")').all() as { name: string }[]).map((c) => c.name);
const total = (db.prepare('select count(*) as n from "Mascota"').get() as { n: number }).n;
console.log(`Base: ${ruta} (${total} mascotas)`);

if (!columnas.includes('fechaNacimiento')) {
  db.exec('alter table "Mascota" add column "fechaNacimiento" datetime');
  console.log('Columna fechaNacimiento creada (opcional por ahora).');
}

if (columnas.includes('edad')) {
  const pendientes = db
    .prepare('select id, nombre, edad from "Mascota" where "fechaNacimiento" is null order by id')
    .all() as { id: number; nombre: string; edad: number }[];
  const actualizar = db.prepare('update "Mascota" set "fechaNacimiento" = ? where id = ?');
  db.transaction(() => {
    for (const { id, nombre, edad } of pendientes) {
      const fecha = haceAnios(edad);
      actualizar.run(fecha, id);
      console.log(`  ${id} ${nombre}: edad ${edad} → fechaNacimiento ${fecha.slice(0, 10)}`);
    }
  })();
  if (pendientes.length === 0) console.log('No había mascotas sin fecha de nacimiento.');
}

const sinFecha = (db.prepare('select count(*) as n from "Mascota" where "fechaNacimiento" is null').get() as {
  n: number;
}).n;
db.close();
if (sinFecha > 0) {
  console.error(`Quedaron ${sinFecha} mascotas sin fecha de nacimiento: no se sigue con el db push.`);
  process.exit(1);
}
console.log('Listo: todas las mascotas tienen fecha de nacimiento. Sigue prisma db push.');
