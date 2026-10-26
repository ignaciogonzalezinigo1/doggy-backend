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
 *
 * Windows: no se lanza `node_modules/.bin/prisma` (en Windows eso es un shim
 * `prisma.cmd`, y `spawn` sin shell da ENOENT), sino el JS de la CLI de Prisma
 * (el `bin` de su package.json) con el mismo Node que corre este script
 * (`process.execPath`). Así no hace falta shell ni `.cmd`, y es lo mismo en
 * macOS y Linux. La ruta va con barras `/` ("file://C:/Users/.../dev.db"): la
 * CLI saca "file:" y resuelve el resto con pathe, que junta las barras
 * repetidas y entiende la unidad "C:"; en macOS queda "file:///Users/.../dev.db".
 */

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';

/** Prefijo de las URLs de SQLite. */
const PREFIJO_FILE = 'file:';
/** Raíz del repo: las rutas relativas de la URL son relativas a ella, como en `prisma.config.ts`. */
const RAIZ = resolve(import.meta.dirname, '..');
/**
 * Archivo JS de la CLI de Prisma instalada en el proyecto (el `bin` de su package.json).
 * @returns la ruta absoluta de la CLI
 */
function rutaCliPrisma(): string {
  const paquete = createRequire(import.meta.url).resolve('prisma/package.json');
  const { bin } = JSON.parse(readFileSync(paquete, 'utf8')) as { bin: string | Record<string, string> };
  const relativa = typeof bin === 'string' ? bin : bin.prisma;
  if (!relativa) throw new Error('No se encontró la CLI de Prisma (npm ci).');
  return resolve(dirname(paquete), relativa);
}

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
  const absoluta = (isAbsolute(ruta) ? ruta : resolve(RAIZ, ruta)).replace(/\\/g, '/');
  return `${PREFIJO_FILE}//${absoluta}`;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL en el .env (copiá .env.example).');
  process.exit(1);
}

const studio = spawn(process.execPath, [rutaCliPrisma(), 'studio', '--url', urlParaStudio(url), ...process.argv.slice(2)], {
  cwd: RAIZ,
  stdio: 'inherit',
});
studio.on('error', (error) => {
  console.error('No se pudo abrir Prisma Studio:', error.message);
  process.exit(1);
});
studio.on('exit', (codigo) => process.exit(codigo ?? 0));
