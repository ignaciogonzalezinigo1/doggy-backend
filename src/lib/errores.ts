/**
 * Respuestas de error compartidas por las rutas.
 *
 * Todo error sale como `{ error: "mensaje en español" }`. El mensaje lo ve el
 * usuario tal cual en la app, así que nunca lleva detalles internos.
 */

import type { Response } from 'express';

/** Mensaje genérico para los errores imprevistos (500). */
export const MENSAJE_ERROR_INTERNO = 'Tuvimos un problema en el servidor. Probá de nuevo en un rato.';

/** Status de un error imprevisto. */
const STATUS_ERROR_INTERNO = 500;

/**
 * Loguea un error imprevisto en la consola del servidor y responde 500 con el
 * mensaje genérico. Va en el `catch` de cada ruta async.
 * @param res respuesta de Express
 * @param error lo que se capturó en el catch
 * @param contexto qué estaba haciendo la ruta, por ejemplo "GET /api/mascotas"
 */
export function responderErrorInterno(res: Response, error: unknown, contexto: string): void {
  console.error(`Error en ${contexto}:`, error);
  res.status(STATUS_ERROR_INTERNO).json({ error: MENSAJE_ERROR_INTERNO });
}
