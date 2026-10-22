/**
 * Rutas de los turnos de la agenda.
 */

import { Router } from 'express';
import { deMascotasAsignadasA } from '../lib/asignaciones';
import { responderErrorInterno } from '../lib/errores';
import { prisma } from '../lib/prisma';
import { aTurno } from '../respuestas';

export const turnosRouter = Router();

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
