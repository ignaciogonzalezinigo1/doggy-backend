/**
 * Lectura del body de PATCH /api/usuarios/me (perfil del usuario).
 *
 * Mismas reglas que EditarPerfilForm de la app. El email se guarda en
 * minúsculas, como lo normaliza la app. La contraseña no se cambia por acá.
 */

import { leerCuerpo, leerFoto, leerPresentes, leerTexto, type Lectores, type Resultado } from '../lib/entrada';
import {
  normalizarEmail,
  validarEmail,
  validarNombrePersona,
  validarTelefono,
  validarUbicacion,
} from '../validaciones';

/** Campos del perfil que puede cambiar el usuario. */
export type DatosUsuario = {
  nombre: string;
  apellido: string;
  email: string;
  ubicacion: string;
  telefonoEmergencia: string;
  foto: string | null;
};

const LECTORES: Lectores<DatosUsuario> = {
  nombre: (v) => leerTexto(v, 'Nombre', (t) => validarNombrePersona(t, 'Nombre', 'Ingresá tu nombre.')),
  apellido: (v) =>
    leerTexto(v, 'Apellido', (t) => validarNombrePersona(t, 'Apellido', 'Ingresá tu apellido.')),
  email: (v) => normalizarEmail(leerTexto(v, 'Email', validarEmail)),
  ubicacion: (v) => leerTexto(v, 'Ubicación', validarUbicacion),
  telefonoEmergencia: (v) => leerTexto(v, 'Teléfono', validarTelefono),
  foto: (v) => leerFoto(v),
};

/**
 * Lee los cambios del perfil.
 * @param body `req.body`
 * @returns los campos que vinieron, validados, o el error del 400
 */
export function leerCambiosUsuario(body: unknown): Resultado<Partial<DatosUsuario>> {
  return leerCuerpo(() => leerPresentes(body, LECTORES));
}
