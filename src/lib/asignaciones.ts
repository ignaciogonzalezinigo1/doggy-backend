/**
 * Filtros de Prisma para quedarse con lo que el usuario puede ver.
 *
 * Un usuario ve una mascota (y su carnet, turnos y cuidadores) solo si está
 * asignado a ella como dueño o invitado. El filtro se hace en la consulta,
 * así nunca salen de la base datos de mascotas ajenas. Para escribir vale la
 * misma regla: `rolEn` dice si el usuario está asignado (403 si no).
 */

import { prisma } from './prisma';

/**
 * Filtro de mascotas a las que está asignado un usuario.
 * @param usuarioId usuario de la sesión
 * @returns el `where` para consultar mascotas
 */
export function mascotasAsignadasA(usuarioId: number) {
  return { cuidadores: { some: { usuarioId } } };
}

/**
 * Filtro de lo que pertenece a una mascota asignada al usuario (registros,
 * turnos o cuidadores, que tienen relación `mascota`).
 * @param usuarioId usuario de la sesión
 * @returns el `where` para consultar esos modelos
 */
export function deMascotasAsignadasA(usuarioId: number) {
  return { mascota: mascotasAsignadasA(usuarioId) };
}

/**
 * Cliente con el que se consulta: el de Prisma o el de una transacción.
 * Solo se usa la parte de `cuidador` que hace falta acá.
 */
type ConCuidadores = Pick<typeof prisma, 'cuidador'>;

/**
 * Rol de un usuario sobre una mascota. Sirve para los 403: si no tiene rol,
 * no está asignado y no puede escribir sobre esa mascota.
 * @param mascotaId mascota
 * @param usuarioId usuario de la sesión
 * @param cliente prisma o el `tx` de una transacción
 * @returns el rol guardado ('dueno' o 'invitado'), o null si no está asignado
 */
export async function rolEn(
  mascotaId: number,
  usuarioId: number,
  cliente: ConCuidadores = prisma,
): Promise<string | null> {
  const cuidador = await cliente.cuidador.findUnique({
    where: { mascotaId_usuarioId: { mascotaId, usuarioId } },
    select: { rol: true },
  });
  return cuidador?.rol ?? null;
}

/** Error de permiso o existencia, listo para responder. */
export type ErrorDePermiso = { status: 403 | 404; error: string };

/** Mensajes de los chequeos sobre una mascota. */
export const MENSAJE_MASCOTA_NO_EXISTE = 'No encontramos la mascota.';
export const MENSAJE_SIN_PERMISO_MASCOTA = 'No tenés permiso para modificar esta mascota.';

/**
 * Chequea que la mascota exista (404) y que el usuario esté asignado a ella (403).
 * @param mascotaId mascota sobre la que se quiere escribir
 * @param usuarioId usuario de la sesión
 * @returns el error a responder, o null si puede escribir
 */
export async function chequearMascota(
  mascotaId: number,
  usuarioId: number,
): Promise<ErrorDePermiso | null> {
  const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId }, select: { id: true } });
  if (!mascota) return { status: 404, error: MENSAJE_MASCOTA_NO_EXISTE };
  if (!(await rolEn(mascotaId, usuarioId))) return { status: 403, error: MENSAJE_SIN_PERMISO_MASCOTA };
  return null;
}

/** Resultado de buscar algo de una mascota: lo encontrado, o el error a responder. */
export type Encontrado<T> = { ok: true; valor: T } | ({ ok: false } & ErrorDePermiso);

/**
 * Busca algo que pertenece a una mascota (un registro, un turno) y chequea
 * que esa mascota esté asignada al usuario.
 * @param buscar consulta que trae el elemento o null
 * @param usuarioId usuario de la sesión
 * @param mensajes textos del 404 y del 403
 * @returns lo encontrado, o el error (404 si no existe, 403 si no tiene permiso)
 */
export async function buscarDeMascotaAsignada<T extends { mascotaId: number }>(
  buscar: () => Promise<T | null>,
  usuarioId: number,
  mensajes: { noExiste: string; sinPermiso: string },
): Promise<Encontrado<T>> {
  const valor = await buscar();
  if (!valor) return { ok: false, status: 404, error: mensajes.noExiste };
  if (!(await rolEn(valor.mascotaId, usuarioId))) {
    return { ok: false, status: 403, error: mensajes.sinPermiso };
  }
  return { ok: true, valor };
}
