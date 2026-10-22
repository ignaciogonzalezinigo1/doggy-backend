/**
 * Rutas del usuario de la sesión (perfil y contacto de emergencia).
 */

import { Router } from 'express';
import { responderErrorInterno } from '../lib/errores';
import { prisma } from '../lib/prisma';
import { aUsuario } from '../respuestas';

export const usuariosRouter = Router();

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
      res.status(404).json({ error: 'No encontramos tu cuenta.' });
      return;
    }
    res.json(aUsuario(usuario));
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/usuarios/me');
  }
});
