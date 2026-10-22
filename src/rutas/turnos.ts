/**
 * Rutas de los turnos de la agenda.
 */

import { Router } from 'express';
import { leerCambiosTurno, leerTurnoNuevo } from '../cuerpos/turno';
import { buscarDeMascotaAsignada, chequearMascota, deMascotasAsignadasA } from '../lib/asignaciones';
import { MENSAJE_ID_INVALIDO, parseId } from '../lib/entrada';
import { esErrorPrisma, responderError, responderErrorInterno } from '../lib/errores';
import { prisma } from '../lib/prisma';
import { aTurno } from '../respuestas';

export const turnosRouter = Router();

const MENSAJE_TURNO_NO_EXISTE = 'No encontramos el turno.';
const MENSAJE_SIN_PERMISO_TURNO = 'No tenés permiso para modificar este turno.';

/**
 * GET /api/turnos: turnos de las mascotas asignadas al usuario, del más
 * cercano al más lejano. Responde 200 con Turno[] o 500.
 */
turnosRouter.get('/', async (req, res) => {
  try {
    const turnos = await prisma.turno.findMany({
      where: deMascotasAsignadasA(req.usuarioId),
      orderBy: { fecha: 'asc' },
    });
    res.json(turnos.map(aTurno));
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/turnos');
  }
});

/**
 * Busca un turno y chequea que sea de una mascota asignada al usuario.
 * @param id id del turno
 * @param usuarioId usuario de la sesión
 * @returns el turno, o el error a responder (404 o 403)
 */
function buscarTurnoPropio(id: number, usuarioId: number) {
  return buscarDeMascotaAsignada(() => prisma.turno.findUnique({ where: { id } }), usuarioId, {
    noExiste: MENSAJE_TURNO_NO_EXISTE,
    sinPermiso: MENSAJE_SIN_PERMISO_TURNO,
  });
}

/**
 * POST /api/turnos: agenda un turno para una mascota asignada al usuario.
 * Body: mascotaId, categoria, fecha (ISO con hora, a futuro y a no más de 2
 * años), motivo, lugar.
 * Responde 201 con el Turno, 400 si un dato no es válido, 403 si la mascota
 * no está asignada al usuario, 404 si la mascota no existe o 500.
 */
turnosRouter.post('/', async (req, res) => {
  try {
    const datos = leerTurnoNuevo(req.body);
    if (!datos.ok) {
      responderError(res, 400, datos.error);
      return;
    }
    const permiso = await chequearMascota(datos.datos.mascotaId, req.usuarioId);
    if (permiso) {
      responderError(res, permiso.status, permiso.error);
      return;
    }
    const turno = await prisma.turno.create({ data: datos.datos });
    res.status(201).json(aTurno(turno));
  } catch (error) {
    responderErrorInterno(res, error, 'POST /api/turnos');
  }
});

/**
 * PATCH /api/turnos/:id: cambia un turno (fecha, hora, lugar, etc.).
 * Body (todos opcionales): mascotaId, categoria, fecha, motivo, lugar. Si
 * cambia la fecha, la nueva tiene que ser a futuro; si cambia la mascota, el
 * usuario también tiene que estar asignado a la nueva.
 * Responde 200 con el Turno, 400 si el id o un dato no es válido, 403 sin
 * permiso, 404 si el turno (o la mascota nueva) no existe o 500.
 */
turnosRouter.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    responderError(res, 400, MENSAJE_ID_INVALIDO);
    return;
  }
  try {
    const encontrado = await buscarTurnoPropio(id, req.usuarioId);
    if (!encontrado.ok) {
      responderError(res, encontrado.status, encontrado.error);
      return;
    }
    const cambios = leerCambiosTurno(req.body, encontrado.valor);
    if (!cambios.ok) {
      responderError(res, 400, cambios.error);
      return;
    }
    const { mascotaId } = cambios.datos;
    if (mascotaId !== undefined && mascotaId !== encontrado.valor.mascotaId) {
      const permiso = await chequearMascota(mascotaId, req.usuarioId);
      if (permiso) {
        responderError(res, permiso.status, permiso.error);
        return;
      }
    }
    const turno = await prisma.turno.update({ where: { id }, data: cambios.datos });
    res.json(aTurno(turno));
  } catch (error) {
    if (esErrorPrisma(error, 'P2025')) {
      responderError(res, 404, MENSAJE_TURNO_NO_EXISTE);
    } else {
      responderErrorInterno(res, error, 'PATCH /api/turnos/:id');
    }
  }
});

/**
 * DELETE /api/turnos/:id: borra un turno.
 * Responde 204 sin body, 400 si el id no es válido, 403 si la mascota no
 * está asignada al usuario, 404 si no existe o 500.
 */
turnosRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    responderError(res, 400, MENSAJE_ID_INVALIDO);
    return;
  }
  try {
    const encontrado = await buscarTurnoPropio(id, req.usuarioId);
    if (!encontrado.ok) {
      responderError(res, encontrado.status, encontrado.error);
      return;
    }
    await prisma.turno.delete({ where: { id } });
    res.status(204).end();
  } catch (error) {
    if (esErrorPrisma(error, 'P2025')) {
      responderError(res, 404, MENSAJE_TURNO_NO_EXISTE);
    } else {
      responderErrorInterno(res, error, 'DELETE /api/turnos/:id');
    }
  }
});
