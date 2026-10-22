/**
 * Rutas del carnet sanitario (vacunas, desparasitaciones y otros registros).
 */

import { Router } from 'express';
import { deMascotasAsignadasA } from '../lib/asignaciones';
import { responderErrorInterno } from '../lib/errores';
import { prisma } from '../lib/prisma';
import { aRegistro } from '../respuestas';

export const registrosRouter = Router();

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
