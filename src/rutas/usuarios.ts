/**
 * Rutas del usuario de la sesión (perfil y contacto de emergencia).
 */

import { Router } from 'express';
import { leerCambiosUsuario } from '../cuerpos/usuario';
import { esErrorPrisma, responderError, responderErrorInterno } from '../lib/errores';
import { borrarFotoSiHuerfana } from '../lib/fotos';
import { prisma } from '../lib/prisma';
import { aUsuario } from '../respuestas';

export const usuariosRouter = Router();

const MENSAJE_CUENTA_NO_EXISTE = 'No encontramos tu cuenta.';
const MENSAJE_EMAIL_REPETIDO = 'Ya hay una cuenta con ese email.';

/**
 * GET /api/usuarios/me: perfil del usuario de la sesión, sin la contraseña.
 * Responde 200 con el Usuario, 404 si el usuario ya no existe o 500.
 */
usuariosRouter.get('/me', async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.usuarioId },
      omit: { passwordHash: true },
    });
    if (!usuario) {
      responderError(res, 404, MENSAJE_CUENTA_NO_EXISTE);
      return;
    }
    res.json(aUsuario(usuario));
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/usuarios/me');
  }
});

/**
 * PATCH /api/usuarios/me: cambia datos del perfil del usuario de la sesión.
 * Body (todos opcionales): nombre, apellido, email, ubicacion,
 * telefonoEmergencia, foto (null la borra).
 * Responde 200 con el Usuario, 400 si un dato no es válido, 404 si la cuenta
 * ya no existe, 409 si el email es de otra cuenta o 500.
 */
usuariosRouter.patch('/me', async (req, res) => {
  try {
    const cambios = leerCambiosUsuario(req.body);
    if (!cambios.ok) {
      responderError(res, 400, cambios.error);
      return;
    }
    const anterior = await prisma.usuario.findUnique({ where: { id: req.usuarioId }, select: { foto: true } });
    const usuario = await prisma.usuario.update({
      where: { id: req.usuarioId },
      data: cambios.datos,
      omit: { passwordHash: true },
    });
    await borrarFotoSiHuerfana(anterior?.foto, usuario.foto);
    res.json(aUsuario(usuario));
  } catch (error) {
    if (esErrorPrisma(error, 'P2025')) {
      responderError(res, 404, MENSAJE_CUENTA_NO_EXISTE);
    } else if (esErrorPrisma(error, 'P2002')) {
      responderError(res, 409, MENSAJE_EMAIL_REPETIDO);
    } else {
      responderErrorInterno(res, error, 'PATCH /api/usuarios/me');
    }
  }
});
