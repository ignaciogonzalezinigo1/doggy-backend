/**
 * Fotos subidas a la API: dónde se guardan, cómo se reconocen y cuándo se borran.
 *
 * Los archivos van a la carpeta `uploads/` (o la que diga `UPLOADS_DIR`, que
 * usan las pruebas) y se sirven públicos en `/uploads`. En la base se guarda
 * solo la ruta relativa ("/uploads/abc.jpg"), nunca la URL completa: la IP de
 * la PC cambia y la app arma la URL con su `API_URL`.
 */

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './prisma';

/** Prefijo de las rutas de fotos subidas, igual al path donde las sirve Express. */
export const PREFIJO_UPLOADS = '/uploads/';

/** Carpeta donde se guardan los archivos subidos. */
export const CARPETA_UPLOADS = path.resolve(process.env.UPLOADS_DIR ?? 'uploads');

/** Peso máximo de una foto: 5 MB. */
export const PESO_MAXIMO_FOTO = 5 * 1024 * 1024;

/** Largo en bytes del nombre aleatorio (32 caracteres hex). */
const BYTES_NOMBRE = 16;

/** Ruta de una foto subida: nombre aleatorio de 32 hex y una de las extensiones aceptadas. */
const PATRON_RUTA_UPLOAD = /^\/uploads\/[0-9a-f]{32}\.(jpg|png|webp)$/;

/** Extensión con la que se guarda cada formato aceptado. */
export type ExtensionFoto = 'jpg' | 'png' | 'webp';

/**
 * Detecta el formato real de la imagen por sus primeros bytes (la firma del
 * archivo). No se confía en el tipo ni en el nombre que manda el cliente.
 * @param datos contenido del archivo
 * @returns la extensión, o null si no es JPG, PNG ni WEBP
 */
export function detectarFormato(datos: Buffer): ExtensionFoto | null {
  const empiezaCon = (bytes: number[], desde = 0) => bytes.every((b, i) => datos[desde + i] === b);
  if (empiezaCon([0xff, 0xd8, 0xff])) return 'jpg';
  if (empiezaCon([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // RIFF....WEBP
  if (empiezaCon([0x52, 0x49, 0x46, 0x46]) && empiezaCon([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

/**
 * Guarda una foto con un nombre aleatorio.
 * @param datos contenido del archivo, ya validado
 * @param extension formato detectado
 * @returns la ruta relativa que se guarda en la base ("/uploads/<nombre>.jpg")
 */
export async function guardarFoto(datos: Buffer, extension: ExtensionFoto): Promise<string> {
  // Por si la carpeta no existe (un clon nuevo sin .gitkeep o el UPLOADS_DIR de las pruebas).
  await mkdir(CARPETA_UPLOADS, { recursive: true });
  const nombre = `${randomBytes(BYTES_NOMBRE).toString('hex')}.${extension}`;
  await writeFile(path.join(CARPETA_UPLOADS, nombre), datos, { flag: 'wx' });
  return `${PREFIJO_UPLOADS}${nombre}`;
}

/**
 * Indica si un valor tiene la forma de una ruta de foto subida.
 * @param foto valor guardado o recibido
 * @returns true si es "/uploads/<32 hex>.<jpg|png|webp>"
 */
export function esRutaUpload(foto: string | null | undefined): foto is string {
  return typeof foto === 'string' && PATRON_RUTA_UPLOAD.test(foto);
}

/**
 * Indica si existe el archivo de una ruta de foto subida.
 * @param ruta ruta ya validada con `esRutaUpload`
 * @returns true si el archivo está en la carpeta de uploads
 */
export function existeUpload(ruta: string): boolean {
  return existsSync(archivoDe(ruta));
}

/**
 * Convierte la ruta guardada en la base en el archivo del disco.
 * @param ruta "/uploads/<nombre>"
 * @returns path absoluto del archivo
 */
function archivoDe(ruta: string): string {
  return path.join(CARPETA_UPLOADS, path.basename(ruta));
}

/**
 * Cuenta cuántos registros de la base usan una foto, en todas las columnas de fotos.
 * @param ruta ruta de la foto
 * @returns la cantidad de usos
 */
async function usosDeFoto(ruta: string): Promise<number> {
  const [mascotas, usuarios, reportes, registros] = await Promise.all([
    prisma.mascota.count({ where: { foto: ruta } }),
    prisma.usuario.count({ where: { foto: ruta } }),
    prisma.reportePerdida.count({ where: { foto: ruta } }),
    prisma.registroSanitario.count({ where: { fotoEtiqueta: ruta } }),
  ]);
  return mascotas + usuarios + reportes + registros;
}

/**
 * Borra el archivo de una foto que se reemplazó o se borró, si ya no la usa
 * ningún registro. Se llama después de escribir en la base. Si falla, solo se
 * loguea: el cambio ya se guardó y un archivo de más no rompe nada.
 * @param anterior foto que tenía el registro antes del cambio
 * @param nueva foto que tiene ahora (null si se borró el registro o la foto)
 */
export async function borrarFotoSiHuerfana(
  anterior: string | null | undefined,
  nueva: string | null | undefined = null,
): Promise<void> {
  if (!esRutaUpload(anterior) || anterior === nueva) return;
  try {
    if ((await usosDeFoto(anterior)) > 0) return;
    await unlink(archivoDe(anterior));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    console.error(`No se pudo borrar la foto ${anterior}:`, error);
  }
}
