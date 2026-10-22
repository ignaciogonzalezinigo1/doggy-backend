/**
 * Lectura del body de POST /api/mascotas y PATCH /api/mascotas/:id.
 *
 * Mismas reglas que MascotaForm de la app. El id, el código y el tutor los
 * pone el servidor: no se leen del body.
 */

import {
  exigir,
  leerCuerpo,
  leerFoto,
  leerPresentes,
  leerTexto,
  leerTodos,
  type Lectores,
  type Resultado,
} from '../lib/entrada';
import { validarEdad, validarNombreMascota, validarRaza, validarSenas } from '../validaciones';

/** Datos de una mascota que manda la app. */
export type DatosMascota = {
  nombre: string;
  raza: string;
  edad: number;
  senas: string;
  foto: string | null;
};

const LECTORES: Lectores<DatosMascota> = {
  nombre: (v) => leerTexto(v, 'Nombre', (t) => validarNombreMascota(t)),
  raza: (v) => leerTexto(v, 'Raza', (t) => validarRaza(t)),
  edad: (v) => {
    exigir(validarEdad(v));
    return v as number;
  },
  senas: (v) => leerTexto(v, 'Señas', validarSenas, true),
  foto: (v) => leerFoto(v),
};

/**
 * Lee los datos de una mascota nueva.
 * @param body `req.body`
 * @returns los datos validados o el error del 400
 */
export function leerMascotaNueva(body: unknown): Resultado<DatosMascota> {
  return leerCuerpo(() => leerTodos(body, LECTORES));
}

/**
 * Lee los cambios de una mascota.
 * @param body `req.body`
 * @returns los campos que vinieron, validados, o el error del 400
 */
export function leerCambiosMascota(body: unknown): Resultado<Partial<DatosMascota>> {
  return leerCuerpo(() => leerPresentes(body, LECTORES));
}
