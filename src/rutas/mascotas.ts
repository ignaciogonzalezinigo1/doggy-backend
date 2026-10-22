/**
 * Rutas de las mascotas del usuario.
 */

import { Router } from 'express';
import { mascotasAsignadasA } from '../lib/asignaciones';
import { responderErrorInterno } from '../lib/errores';
import { prisma } from '../lib/prisma';
import { aMascota } from '../respuestas';

export const mascotasRouter = Router();

/**
 * GET /api/mascotas: mascotas a las que está asignado el usuario (como dueño o
 * invitado), en orden de alta. Responde 200 con Mascota[] o 500.
 */
mascotasRouter.get('/', async (req, res) => {
  try {
    const mascotas = await prisma.mascota.findMany({
      where: mascotasAsignadasA(req.usuarioId),
      orderBy: { id: 'asc' },
    });
    res.json(mascotas.map(aMascota));
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/mascotas');
  }
});
