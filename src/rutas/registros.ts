/**
 * Rutas del carnet sanitario (vacunas, desparasitaciones y otros registros).
 * El alta va colgada de la mascota: POST /api/mascotas/:id/registros (rutas/mascotas.ts).
 */

import { Router } from 'express';
import { leerCambiosRegistro } from '../cuerpos/registro';
import { buscarDeMascotaAsignada, deMascotasAsignadasA } from '../lib/asignaciones';
import { MENSAJE_ID_INVALIDO, parseId } from '../lib/entrada';
import { esErrorPrisma, responderError, responderErrorInterno } from '../lib/errores';
import { prisma } from '../lib/prisma';
import { aRegistro } from '../respuestas';

export const registrosRouter = Router();

const MENSAJE_REGISTRO_NO_EXISTE = 'No encontramos el registro.';
const MENSAJE_SIN_PERMISO_REGISTRO = 'No tenés permiso para modificar este registro.';

/**
 * GET /api/registros: registros del carnet de todas las mascotas asignadas al
 * usuario, con las fechas como AAAA-MM-DD. Responde 200 con RegistroSanitario[] o 500.
 */
registrosRouter.get('/', async (req, res) => {
  try {
    const registros = await prisma.registroSanitario.findMany({
      where: deMascotasAsignadasA(req.usuarioId),
      orderBy: { id: 'asc' },
    });
    res.json(registros.map(aRegistro));
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/registros');
  }
});

/**
 * Busca un registro y chequea que sea de una mascota asignada al usuario.
 * @param id id del registro
 * @param usuarioId usuario de la sesión
 * @returns el registro, o el error a responder (404 o 403)
 */
function buscarRegistroPropio(id: number, usuarioId: number) {
  return buscarDeMascotaAsignada(() => prisma.registroSanitario.findUnique({ where: { id } }), usuarioId, {
    noExiste: MENSAJE_REGISTRO_NO_EXISTE,
    sinPermiso: MENSAJE_SIN_PERMISO_REGISTRO,
  });
}

/**
 * PATCH /api/registros/:id: corrige un registro del carnet.
 * Body (todos opcionales): tipo, nombre, fecha (AAAA-MM-DD), profesional,
 * proximaDosis (AAAA-MM-DD o null para sacarla), fotoEtiqueta (o null). Las
 * reglas entre campos se revisan contra el registro completo.
 * Responde 200 con el RegistroSanitario, 400 si el id o un dato no es válido,
 * 403 si la mascota no está asignada al usuario, 404 si no existe o 500.
 */
registrosRouter.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    responderError(res, 400, MENSAJE_ID_INVALIDO);
    return;
  }
  try {
    const encontrado = await buscarRegistroPropio(id, req.usuarioId);
    if (!encontrado.ok) {
      responderError(res, encontrado.status, encontrado.error);
      return;
    }
    const cambios = leerCambiosRegistro(req.body, encontrado.valor);
    if (!cambios.ok) {
      responderError(res, 400, cambios.error);
      return;
    }
    const registro = await prisma.registroSanitario.update({ where: { id }, data: cambios.datos });
    res.json(aRegistro(registro));
  } catch (error) {
    if (esErrorPrisma(error, 'P2025')) {
      responderError(res, 404, MENSAJE_REGISTRO_NO_EXISTE);
    } else {
      responderErrorInterno(res, error, 'PATCH /api/registros/:id');
    }
  }
});

/**
 * DELETE /api/registros/:id: borra un registro del carnet.
 * Responde 204 sin body, 400 si el id no es válido, 403 si la mascota no
 * está asignada al usuario, 404 si no existe o 500.
 */
registrosRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    responderError(res, 400, MENSAJE_ID_INVALIDO);
    return;
  }
  try {
    const encontrado = await buscarRegistroPropio(id, req.usuarioId);
    if (!encontrado.ok) {
      responderError(res, encontrado.status, encontrado.error);
      return;
    }
    await prisma.registroSanitario.delete({ where: { id } });
    res.status(204).end();
  } catch (error) {
    if (esErrorPrisma(error, 'P2025')) {
      responderError(res, 404, MENSAJE_REGISTRO_NO_EXISTE);
    } else {
      responderErrorInterno(res, error, 'DELETE /api/registros/:id');
    }
  }
});
