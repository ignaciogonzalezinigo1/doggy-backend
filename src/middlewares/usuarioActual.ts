/**
 * Middleware que indica qué usuario hace el pedido.
 *
 * TODO (Etapa 4): es temporal. Todavía no hay login, así que todos los pedidos
 * se atienden como Sofía, la usuaria de la demo del seed. Cuando exista la
 * sesión, se reemplaza por un middleware que lea el token, ponga el id del
 * usuario logueado y responda 401 si falta o no es válido.
 */

import type { NextFunction, Request, Response } from 'express';

declare global {
  namespace Express {
    interface Request {
      /** Id del usuario de la sesión. Lo pone `usuarioActual` antes de las rutas de /api. */
      usuarioId: number;
    }
  }
}

/** Id de Sofía en el seed (`SOFIA_ID` en prisma/seed.ts). */
const USUARIO_DEMO_ID = 1;

/**
 * Pone en `req.usuarioId` el id del usuario de la demo.
 * @param req pedido entrante
 * @param _res respuesta (no se usa)
 * @param next sigue con la ruta
 */
export function usuarioActual(req: Request, _res: Response, next: NextFunction): void {
  req.usuarioId = USUARIO_DEMO_ID;
  next();
}
