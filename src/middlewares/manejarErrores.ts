/**
 * Middlewares del final de `src/index.ts`, después de todas las rutas: el 404
 * de las rutas que no existen y el manejador de errores.
 *
 * Atrapa lo que no pasa por el try/catch de una ruta, sobre todo los errores
 * de `express.json()`: un body que no es JSON válido o que pesa más de lo
 * permitido. Sin este middleware, Express responde con una página HTML que
 * incluye el stack trace; así sale siempre `{ error }` en español, como el
 * resto de la API, y sin detalles internos.
 */

import type { NextFunction, Request, Response } from 'express';
import { MENSAJE_ERROR_INTERNO, responderError } from '../lib/errores';

/** Status de un body más grande que el límite de `express.json()` (Payload Too Large). */
const STATUS_MUY_GRANDE = 413;
const STATUS_ERROR_INTERNO = 500;

const MENSAJE_JSON_INVALIDO = 'Los datos enviados no tienen un formato válido.';
const MENSAJE_BODY_MUY_GRANDE = 'Los datos enviados son demasiado grandes.';
const MENSAJE_PEDIDO_INVALIDO = 'No pudimos leer los datos enviados.';
const MENSAJE_RUTA_INEXISTENTE = 'No existe esa ruta.';

/** Forma de los errores de `express.json()` (body-parser) que nos interesan. */
type ErrorDeBody = { type?: unknown; status?: unknown };

/**
 * Indica si un error vino de `express.json()` y tiene cierto tipo.
 * @param error lo que llegó al middleware
 * @param tipo `type` de body-parser, por ejemplo "entity.parse.failed"
 * @returns true si coincide
 */
function esErrorDeBody(error: unknown, tipo: string): boolean {
  return typeof error === 'object' && error !== null && (error as ErrorDeBody).type === tipo;
}

/**
 * Indica si es otro error del pedido (4xx) que body-parser marca con su status,
 * por ejemplo un charset que no soporta.
 * @param error lo que llegó al middleware
 * @returns true si es un error del cliente
 */
function esErrorDelCliente(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status } = error as ErrorDeBody;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Responde 404 con `{ error }` cuando ninguna ruta atendió el pedido. Va
 * después de todas las rutas y antes de `manejarErrores`.
 * @param _req pedido
 * @param res respuesta
 */
export function rutaInexistente(_req: Request, res: Response): void {
  responderError(res, 404, MENSAJE_RUTA_INEXISTENTE);
}

/**
 * Responde cualquier error que llegue a Express como `{ error }`:
 * 400 si el body no es JSON válido (u otro error del pedido), 413 si es
 * demasiado grande y 500 para el resto, logueado en la consola.
 * @param error lo que se lanzó o se pasó a `next(error)`
 * @param req pedido
 * @param res respuesta
 * @param next siguiente manejador (solo si ya se empezó a responder)
 */
export function manejarErrores(error: unknown, req: Request, res: Response, next: NextFunction): void {
  // Si la respuesta ya salió a medias, solo Express puede cortar la conexión.
  if (res.headersSent) {
    next(error);
    return;
  }
  if (esErrorDeBody(error, 'entity.parse.failed')) {
    responderError(res, 400, MENSAJE_JSON_INVALIDO);
  } else if (esErrorDeBody(error, 'entity.too.large')) {
    responderError(res, STATUS_MUY_GRANDE, MENSAJE_BODY_MUY_GRANDE);
  } else if (esErrorDelCliente(error)) {
    responderError(res, 400, MENSAJE_PEDIDO_INVALIDO);
  } else {
    console.error(`Error sin manejar en ${req.method} ${req.originalUrl}:`, error);
    responderError(res, STATUS_ERROR_INTERNO, MENSAJE_ERROR_INTERNO);
  }
}
