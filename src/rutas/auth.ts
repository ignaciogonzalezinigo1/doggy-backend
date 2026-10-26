/**
 * Rutas de la cuenta: registro, login y logout.
 *
 * Registro y login son públicas y devuelven `{ usuario, token }`; el token va
 * después en `Authorization: Bearer <token>`. El logout va detrás de
 * `requiereUsuario` y borra la sesión de ese token.
 */

import { Router } from 'express';
import { leerLogin, leerRegistro } from '../cuerpos/auth';
import { esErrorPrisma, responderError, responderErrorInterno } from '../lib/errores';
import { prisma } from '../lib/prisma';
import { abrirSesion, cerrarSesion, hashearPassword, passwordCorrecta } from '../lib/sesiones';
import { requiereUsuario } from '../middlewares/requiereUsuario';
import { aUsuario } from '../respuestas';

export const authRouter = Router();

const MENSAJE_EMAIL_REPETIDO = 'Ya hay una cuenta con ese email.';
/** Igual para email inexistente y contraseña incorrecta: no se dice cuál falló. */
const MENSAJE_LOGIN_INCORRECTO = 'Email o contraseña incorrectos';

/**
 * Datos del perfil que el registro no pide. Quedan vacíos y el usuario los
 * completa después desde Editar perfil (PATCH /api/usuarios/me).
 */
const PERFIL_INICIAL = { ubicacion: '', foto: null };

/**
 * POST /api/auth/registro: crea una cuenta y abre su sesión.
 * Body: { nombre, apellido, email, password }.
 * Responde 201 con { usuario, token }, 400 si un dato no es válido, 409 si el
 * email ya tiene cuenta o 500.
 */
authRouter.post('/registro', async (req, res) => {
  try {
    const datos = leerRegistro(req.body);
    if (!datos.ok) {
      responderError(res, 400, datos.error);
      return;
    }
    const { password, ...resto } = datos.datos;
    const usuario = await prisma.usuario.create({
      data: { ...resto, ...PERFIL_INICIAL, passwordHash: await hashearPassword(password) },
      omit: { passwordHash: true },
    });
    const token = await abrirSesion(usuario.id);
    res.status(201).json({ usuario: aUsuario(usuario), token });
  } catch (error) {
    if (esErrorPrisma(error, 'P2002')) {
      responderError(res, 409, MENSAJE_EMAIL_REPETIDO);
    } else {
      responderErrorInterno(res, error, 'POST /api/auth/registro');
    }
  }
});

/**
 * POST /api/auth/login: abre una sesión con email y contraseña.
 * Body: { email, password }.
 * Responde 200 con { usuario, token }, 400 si falta un dato o no tiene
 * formato válido, 401 si el email o la contraseña no coinciden (mismo
 * mensaje para los dos) o 500.
 */
authRouter.post('/login', async (req, res) => {
  try {
    const datos = leerLogin(req.body);
    if (!datos.ok) {
      responderError(res, 400, datos.error);
      return;
    }
    const usuario = await prisma.usuario.findUnique({ where: { email: datos.datos.email } });
    const correcta = await passwordCorrecta(datos.datos.password, usuario?.passwordHash ?? null);
    if (!usuario || !correcta) {
      responderError(res, 401, MENSAJE_LOGIN_INCORRECTO);
      return;
    }
    const token = await abrirSesion(usuario.id);
    res.json({ usuario: aUsuario(usuario), token });
  } catch (error) {
    responderErrorInterno(res, error, 'POST /api/auth/login');
  }
});

/**
 * POST /api/auth/logout: cierra la sesión del token del header. Desde ahí,
 * ese token responde 401.
 * Responde 204 sin body, 401 si no hay sesión válida o 500.
 */
authRouter.post('/logout', requiereUsuario, async (req, res) => {
  try {
    await cerrarSesion(req.token);
    res.status(204).end();
  } catch (error) {
    responderErrorInterno(res, error, 'POST /api/auth/logout');
  }
});
