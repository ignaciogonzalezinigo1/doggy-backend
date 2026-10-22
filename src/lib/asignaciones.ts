/**
 * Filtros de Prisma para quedarse con lo que el usuario puede ver.
 *
 * Un usuario ve una mascota (y su carnet, turnos y cuidadores) solo si está
 * asignado a ella como dueño o invitado. El filtro se hace en la consulta,
 * así nunca salen de la base datos de mascotas ajenas.
 */

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
