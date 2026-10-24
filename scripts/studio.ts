/**
 * Abre Prisma Studio sobre la base SQLite del `.env` (`npm run studio`).
 *
 * Por qué no alcanza con `prisma studio`: en Prisma 7.10 Studio sí abre
 * SQLite, pero la CLI saca el protocolo de la URL cortándola en "://". Con
 * `file:./dev.db` no encuentra "://", toma la URL entera como protocolo y
 * responde "Prisma Studio is not supported for the file:./dev.db protocol".
 * Con una URL absoluta (`file:///ruta/a/dev.db`) el protocolo da "file" y
 * funciona. No se puede dejar así en el `.env` porque la ruta cambia en
 * cada PC, entonces este script la arma y se la pasa con `--url`.
 *
 * Los argumentos extra se pasan tal cual (por ejemplo, `npm run studio -- --port 5556`).
 */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

/** Prefijo de las URLs de SQLite. */
const PREFIJO_FILE = 'file:';
/** Raíz del repo: las rutas relativas de la URL son relativas a ella, como en `prisma.config.ts`. */
const RAIZ = resolve(import.meta.dirname, '..');
/** CLI de Prisma instalada en el proyecto. */
const PRISMA = resolve(RAIZ, 'node_modules/.bin/prisma');

/**
 * Convierte una URL de SQLite relativa en una absoluta que Studio acepte.
 * Las que no son `file:` relativas se devuelven sin cambios.
 * @param url la `DATABASE_URL` del `.env`
 * @returns la URL para `prisma studio --url`
 */
function urlParaStudio(url: string): string {
  if (!url.startsWith(PREFIJO_FILE) || url.startsWith(`${PREFIJO_FILE}//`)) return url;
  const ruta = url.slice(PREFIJO_FILE.length);
  // Sin codificar (nada de pathToFileURL): la CLI saca "file:" y usa el resto como ruta.
  return `${PREFIJO_FILE}//${isAbsolute(ruta) ? ruta : resolve(RAIZ, ruta)}`;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL en el .env (copiá .env.example).');
  process.exit(1);
}

const studio = spawn(PRISMA, ['studio', '--url', urlParaStudio(url), ...process.argv.slice(2)], {
  cwd: RAIZ,
  stdio: 'inherit',
});
studio.on('error', (error) => {
  console.error('No se pudo abrir Prisma Studio:', error.message);
  process.exit(1);
});
studio.on('exit', (codigo) => process.exit(codigo ?? 0));
