/**
 * Rutas de los reportes de perros perdidos y encontrados (mapa comunitario).
 */

import { Router } from 'express';
import { responderErrorInterno } from '../lib/errores';
import { prisma } from '../lib/prisma';
import { aReporte, INCLUIR_ETIQUETAS } from '../respuestas';

export const reportesRouter = Router();

/**
 * GET /api/reportes: todos los reportes activos, de cualquier usuario, con sus
 * etiquetas. Un reporte cerrado se borra (DELETE), así que los que están en la
 * base son los activos. Responde 200 con ReportePerdida[] o 500.
 */
reportesRouter.get('/', async (_req, res) => {
  try {
    const reportes = await prisma.reportePerdida.findMany({
      include: INCLUIR_ETIQUETAS,
      orderBy: { id: 'asc' },
    });
    res.json(reportes.map(aReporte));
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/reportes');
  }
});
