/**
 * Sesiones con token aleatorio guardado en la tabla `Sesion`.
 *
 * El token es aleatorio y se le da al cliente una sola vez; en la base queda
 * su SHA-256, así una copia de la base no sirve para entrar. El logout borra
 * la fila, y desde ese momento el token ya no sirve. Las contraseñas se hashean
 * con bcrypt, igual que en el seed.
 */

import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

/** Bytes aleatorios del token (se manda en hexadecimal, 64 caracteres). */
const BYTES_TOKEN = 32;

/** Días que dura una sesión desde el login. */
const DIAS_SESION = 30;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Costo del hash de bcrypt (el mismo que usa el seed). */
const RONDAS_BCRYPT = 10;

/**
 * Hash de una contraseña que no es de nadie. El login lo compara cuando el
 * email no existe, así tarda lo mismo que con una contraseña incorrecta y la
 * respuesta no delata qué emails tienen cuenta.
 */
const HASH_DE_RELLENO = bcrypt.hashSync('sin-cuenta-doggy', RONDAS_BCRYPT);

/**
 * SHA-256 de un token, como se guarda en `Sesion.tokenHash`.
 * @param token token que mandó el cliente
 * @returns el hash en hexadecimal
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Hashea una contraseña nueva para guardarla.
 * @param password contraseña en texto plano
 * @returns el hash de bcrypt
 */
export function hashearPassword(password: string): Promise<string> {
  return bcrypt.hash(password, RONDAS_BCRYPT);
}

/**
 * Compara una contraseña con el hash guardado. Si no hay hash (el email no
 * existe), compara igual contra uno de relleno y devuelve false.
 * @param password contraseña ingresada
 * @param hash hash guardado, o null si no hay cuenta
 * @returns true si coincide
 */
export async function passwordCorrecta(password: string, hash: string | null): Promise<boolean> {
  const coincide = await bcrypt.compare(password, hash ?? HASH_DE_RELLENO);
  return hash !== null && coincide;
}

/**
 * Abre una sesión para un usuario.
 * @param usuarioId usuario que entró
 * @returns el token para mandarle al cliente
 */
export async function abrirSesion(usuarioId: number): Promise<string> {
  const token = randomBytes(BYTES_TOKEN).toString('hex');
  await prisma.sesion.create({
    data: { tokenHash: hashToken(token), usuarioId, vence: new Date(Date.now() + DIAS_SESION * MS_POR_DIA) },
  });
  return token;
}

/**
 * Busca el usuario de un token. Si la sesión venció, la borra.
 * @param token token del header Authorization
 * @returns el id del usuario, o null si el token no existe o venció
 */
export async function usuarioDeToken(token: string): Promise<number | null> {
  const sesion = await prisma.sesion.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!sesion) return null;
  if (sesion.vence <= new Date()) {
    await prisma.sesion.deleteMany({ where: { id: sesion.id } });
    return null;
  }
  return sesion.usuarioId;
}

/**
 * Cierra la sesión de un token. Si ya no existía, no hace nada.
 * @param token token del header Authorization
 */
export async function cerrarSesion(token: string): Promise<void> {
  await prisma.sesion.deleteMany({ where: { tokenHash: hashToken(token) } });
}
