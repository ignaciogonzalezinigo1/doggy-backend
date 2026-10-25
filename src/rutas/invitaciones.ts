/**
 * Rutas de los códigos de asignación: ver uno antes de aceptarlo y aceptarlo.
 * Generarlos va colgado de la mascota: POST /api/mascotas/:id/invitaciones
 * (rutas/mascotas.ts).
 *
 * Un código es de un solo uso y no vence: si ya se usó responde 410, y si no
 * existe, 404.
 */

import { Router } from 'express';
import { rolEn } from '../lib/asignaciones';
import { responderError, responderErrorInterno } from '../lib/errores';
import { prisma } from '../lib/prisma';
import { aCuidador, aInvitacion, INCLUIR_MASCOTA_INVITACION, INCLUIR_USUARIO_CUIDADOR } from '../respuestas';
import { LIMITES } from '../validaciones';

export const invitacionesRouter = Router();

/** Letras y números, hasta el largo del campo de la app. */
const TOKEN_REGEX = new RegExp(`^[A-Z0-9]{1,${LIMITES.codigoAsignacion}}$`);

/** Detalle con el que queda quien acepta, según el rol (como en la app). */
const DETALLE_DUENO = 'Co-tutor/a';
const DETALLE_INVITADO = 'Invitado/a';
const TIPO_ACEPTADO = 'familia';

const MENSAJE_TOKEN_INVALIDO = 'Este código de asignación no tiene un formato válido.';
const MENSAJE_NO_EXISTE = 'Este código de asignación no existe. Revisá que esté bien escrito.';
const MENSAJE_USADO = 'Este código ya se usó. Pedile a un dueño que te mande uno nuevo.';

/**
 * Pasa el código a como se guarda: sin espacios y en mayúsculas.
 * @param token lo que vino en la URL
 * @returns el código normalizado, o null si no tiene un formato válido
 */
function normalizarToken(token: string | undefined): string | null {
  const normalizado = (token ?? '').trim().toUpperCase();
  return TOKEN_REGEX.test(normalizado) ? normalizado : null;
}

/**
 * GET /api/invitaciones/:token: muestra un código de asignación (con los
 * datos de la mascota) antes de aceptarlo.
 * Responde 200 con la Invitacion, 400 si el código no tiene formato válido,
 * 404 si no existe, 410 si ya se usó o 500.
 */
invitacionesRouter.get('/:token', async (req, res) => {
  const token = normalizarToken(req.params.token);
  if (token === null) {
    responderError(res, 400, MENSAJE_TOKEN_INVALIDO);
    return;
  }
  try {
    const invitacion = await prisma.invitacion.findUnique({
      where: { token },
      include: INCLUIR_MASCOTA_INVITACION,
    });
    if (!invitacion) {
      responderError(res, 404, MENSAJE_NO_EXISTE);
      return;
    }
    if (invitacion.usada) {
      responderError(res, 410, MENSAJE_USADO);
      return;
    }
    res.json(aInvitacion(invitacion));
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/invitaciones/:token');
  }
});

/**
 * POST /api/invitaciones/:token/aceptar: asigna al usuario a la mascota con
 * el rol del código y lo marca como usado, en una transacción. Marcarlo con
 * `updateMany({ usada: false })` evita que dos personas usen el mismo código
 * al mismo tiempo.
 * Responde 200 con el Cuidador creado, 400 si el código no tiene formato
 * válido, 404 si no existe, 409 si el usuario ya está asignado, 410 si ya se
 * usó o 500.
 */
invitacionesRouter.post('/:token/aceptar', async (req, res) => {
  const token = normalizarToken(req.params.token);
  if (token === null) {
    responderError(res, 400, MENSAJE_TOKEN_INVALIDO);
    return;
  }
  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const invitacion = await tx.invitacion.findUnique({
        where: { token },
        include: INCLUIR_MASCOTA_INVITACION,
      });
      if (!invitacion) return { ok: false, status: 404, error: MENSAJE_NO_EXISTE } as const;
      if (invitacion.usada) return { ok: false, status: 410, error: MENSAJE_USADO } as const;
      if (await rolEn(invitacion.mascotaId, req.usuarioId, tx)) {
        const error = `Ya estás asignado a ${invitacion.mascota.nombre}.`;
        return { ok: false, status: 409, error } as const;
      }
      const marcada = await tx.invitacion.updateMany({
        where: { token, usada: false },
        data: { usada: true },
      });
      if (marcada.count === 0) return { ok: false, status: 410, error: MENSAJE_USADO } as const;
      const cuidador = await tx.cuidador.create({
        data: {
          mascotaId: invitacion.mascotaId,
          usuarioId: req.usuarioId,
          rol: invitacion.rol,
          detalle: invitacion.rol === 'dueno' ? DETALLE_DUENO : DETALLE_INVITADO,
          tipo: TIPO_ACEPTADO,
        },
        include: INCLUIR_USUARIO_CUIDADOR,
      });
      return { ok: true, cuidador } as const;
    });
    if (resultado.ok) {
      res.json(aCuidador(resultado.cuidador));
    } else {
      responderError(res, resultado.status, resultado.error);
    }
  } catch (error) {
    responderErrorInterno(res, error, 'POST /api/invitaciones/:token/aceptar');
  }
});
