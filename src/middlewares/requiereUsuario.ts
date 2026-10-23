/**
 * Middleware que exige una sesión válida.
 *
 * Lee el token de `Authorization: Bearer <token>`, busca su sesión y pone el
 * id del usuario en `req.usuarioId` (y el token en `req.token`, para el
 * logout). Responde 401 si el header falta, el token no existe o la sesión venció.
 * Va antes de todas las rutas de /api salvo health, registro y login.
 */

import type { NextFunction, Request, Response } from 'express';
import { responderError, responderErrorInterno } from '../lib/errores';
import { usuarioDeToken } from '../lib/sesiones';

declare global {
  namespace Express {
    interface Request {
      /** Id del usuario de la sesión. Lo pone `requiereUsuario` antes de las rutas privadas. */
      usuarioId: number;
      /** Token de la sesión, tal como vino en el header. */
      token: string;
    }
  }
}

/** Formato del header: "Bearer " y el token, sin espacios. */
const BEARER_REGEX = /^Bearer (\S+)$/;

/** Mensaje del 401: la app vuelve al login. */
export const MENSAJE_SIN_SESION = 'Tu sesión venció o no es válida. Volvé a iniciar sesión.';

/**
 * Saca el token del header Authorization.
 * @param req pedido entrante
 * @returns el token, o null si el header falta o no tiene el formato Bearer
 */
function leerToken(req: Request): string | null {
  return BEARER_REGEX.exec(req.get('Authorization') ?? '')?.[1] ?? null;
}

/**
 * Deja pasar solo los pedidos con una sesión válida.
 * @param req pedido entrante
 * @param res respuesta (401 si no hay sesión, 500 si falla la base)
 * @param next sigue con la ruta
 */
export async function requiereUsuario(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = leerToken(req);
    const usuarioId = token ? await usuarioDeToken(token) : null;
    if (!token || usuarioId === null) {
      responderError(res, 401, MENSAJE_SIN_SESION);
      return;
    }
    req.usuarioId = usuarioId;
    req.token = token;
    next();
  } catch (error) {
    responderErrorInterno(res, error, `sesión de ${req.method} ${req.originalUrl}`);
  }
}
