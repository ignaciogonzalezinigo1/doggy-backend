/**
 * Códigos que genera el servidor.
 *
 * - Código de mascota (el del QR de la chapita): DOGGY-XXXX-NOMBRE, con cuatro
 *   dígitos y el nombre en mayúsculas sin tildes. Misma lógica que
 *   doggy/mobile/src/utils/codigos.ts, pero se fija en la base que no exista.
 * - Código de asignación: 8 caracteres de un alfabeto sin 0/O ni 1/I, que se
 *   confunden al leerlos (el mismo que usaba el mock de la app).
 */

import { prisma } from './prisma';

/** Dígitos del número del código de mascota: de 1000 a 9999. */
const NUMERO_MINIMO = 1000;
const CANTIDAD_NUMEROS = 9000;
/** Intentos antes de rendirse si todos los números al azar ya existen. */
const INTENTOS_MAXIMOS = 50;
/** Sufijo si el nombre no tiene ninguna letra ni número que sirva. */
const SUFIJO_POR_DEFECTO = 'MASCOTA';

/** Caracteres del código de asignación. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Largo del código de asignación. */
export const LARGO_TOKEN = 8;

/**
 * Normaliza un nombre para usarlo en el código: sin tildes, sin espacios ni símbolos.
 * @param nombre nombre de la mascota
 * @returns el nombre en mayúsculas y solo con letras y números
 */
function normalizarNombre(nombre: string): string {
  const limpio = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return limpio || SUFIJO_POR_DEFECTO;
}

/**
 * Genera un código de mascota que no esté en la base. Igual se guarda con
 * `codigo @unique`: si dos altas chocan al mismo tiempo, la base lo frena.
 * @param nombre nombre de la mascota
 * @returns un código DOGGY-XXXX-NOMBRE libre
 * @throws si no encontró uno libre en `INTENTOS_MAXIMOS` intentos
 */
export async function generarCodigoMascota(nombre: string): Promise<string> {
  const sufijo = normalizarNombre(nombre);
  for (let intento = 0; intento < INTENTOS_MAXIMOS; intento++) {
    const numero = NUMERO_MINIMO + Math.floor(Math.random() * CANTIDAD_NUMEROS);
    const codigo = `DOGGY-${numero}-${sufijo}`;
    const existe = await prisma.mascota.findUnique({ where: { codigo }, select: { id: true } });
    if (!existe) return codigo;
  }
  throw new Error(`No se encontró un código libre para "${sufijo}"`);
}

/**
 * Genera un código de asignación que no esté en la base.
 * @returns código de `LARGO_TOKEN` caracteres
 * @throws si no encontró uno libre en `INTENTOS_MAXIMOS` intentos
 */
export async function generarToken(): Promise<string> {
  for (let intento = 0; intento < INTENTOS_MAXIMOS; intento++) {
    const token = Array.from(
      { length: LARGO_TOKEN },
      () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)],
    ).join('');
    const existe = await prisma.invitacion.findUnique({ where: { token }, select: { token: true } });
    if (!existe) return token;
  }
  throw new Error('No se encontró un código de asignación libre');
}
