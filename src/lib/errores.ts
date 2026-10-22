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

/**
 * Responde un error esperado (400, 403, 404, 409, 410) con `{ error }`.
 * @param res respuesta de Express
 * @param status status de la tabla del contrato
 * @param mensaje mensaje para el usuario
 */
export function responderError(res: Response, status: number, mensaje: string): void {
  res.status(status).json({ error: mensaje });
}

/** Códigos de error de Prisma que las rutas traducen a un status. */
type CodigoPrisma =
  /** Registro no encontrado en un update o delete → 404. */
  | 'P2025'
  /** Valor repetido en un campo único → 409. */
  | 'P2002';

/**
 * Indica si un error es de Prisma con cierto código.
 * @param error lo que se capturó en el catch
 * @param codigo código de Prisma
 * @returns true si coincide
 */
export function esErrorPrisma(error: unknown, codigo: CodigoPrisma): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === codigo;
}
