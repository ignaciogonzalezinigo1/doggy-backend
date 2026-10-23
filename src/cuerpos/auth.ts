/**
 * Lectura del body de POST /api/auth/registro y POST /api/auth/login.
 *
 * Mismas reglas que las pantallas de registro y login de la app. El email se
 * guarda en minúsculas. La contraseña no pasa por `limpiarTexto`: se toma tal
 * cual llegó, porque los espacios cuentan (y en una nueva están prohibidos).
 */

import { DatoInvalido, exigir, leerCuerpo, leerTexto, leerTodos, type Lectores, type Resultado } from '../lib/entrada';
import {
  conCampo,
  normalizarEmail,
  validarEmail,
  validarNombrePersona,
  validarPasswordNueva,
  validarPasswordRequerida,
} from '../validaciones';

/** Datos para crear una cuenta. */
export type DatosRegistro = {
  nombre: string;
  apellido: string;
  email: string;
  password: string;
};

/** Datos para iniciar sesión. */
export type DatosLogin = {
  email: string;
  password: string;
};

/**
 * Lee una contraseña sin limpiarla.
 * @param valor lo que llegó
 * @param validar regla de validaciones.ts
 * @returns la contraseña
 */
function leerPassword(valor: unknown, validar: (password: string) => string | undefined): string {
  const password = valor ?? '';
  if (typeof password !== 'string') throw new DatoInvalido(conCampo('Contraseña', 'Tiene que ser un texto.'));
  exigir(validar(password));
  return password;
}

/**
 * Lee el email y lo deja en minúsculas.
 * @param valor lo que llegó
 * @returns el email normalizado
 */
function leerEmail(valor: unknown): string {
  return normalizarEmail(leerTexto(valor, 'Email', validarEmail));
}

const LECTORES_REGISTRO: Lectores<DatosRegistro> = {
  nombre: (v) => leerTexto(v, 'Nombre', (t) => validarNombrePersona(t, 'Nombre', 'Ingresá tu nombre.')),
  apellido: (v) =>
    leerTexto(v, 'Apellido', (t) => validarNombrePersona(t, 'Apellido', 'Ingresá tu apellido.')),
  email: leerEmail,
  password: (v) => leerPassword(v, validarPasswordNueva),
};

const LECTORES_LOGIN: Lectores<DatosLogin> = {
  email: leerEmail,
  password: (v) => leerPassword(v, validarPasswordRequerida),
};

/**
 * Lee los datos de una cuenta nueva.
 * @param body `req.body`
 * @returns los datos validados o el error del 400
 */
export function leerRegistro(body: unknown): Resultado<DatosRegistro> {
  return leerCuerpo(() => leerTodos(body, LECTORES_REGISTRO));
}

/**
 * Lee el email y la contraseña del login.
 * @param body `req.body`
 * @returns los datos validados o el error del 400
 */
export function leerLogin(body: unknown): Resultado<DatosLogin> {
  return leerCuerpo(() => leerTodos(body, LECTORES_LOGIN));
}
