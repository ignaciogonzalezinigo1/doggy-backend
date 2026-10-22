/**
 * Rutas de las personas asignadas a las mascotas.
 */

import { Router } from 'express';
import { deMascotasAsignadasA } from '../lib/asignaciones';
import { responderErrorInterno } from '../lib/errores';
import { prisma } from '../lib/prisma';
import { aCuidador, INCLUIR_USUARIO_CUIDADOR } from '../respuestas';

export const cuidadoresRouter = Router();

/**
 * GET /api/cuidadores: personas asignadas a las mascotas del usuario (él
 * incluido), con nombre y foto tomados de cada usuario. Responde 200 con
 * Cuidador[] o 500.
 */
cuidadoresRouter.get('/', async (req, res) => {
  try {
    const cuidadores = await prisma.cuidador.findMany({
      where: deMascotasAsignadasA(req.usuarioId),
      include: INCLUIR_USUARIO_CUIDADOR,
      orderBy: { id: 'asc' },
    });
    res.json(cuidadores.map(aCuidador));
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/cuidadores');
  }
});
