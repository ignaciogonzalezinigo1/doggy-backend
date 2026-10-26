/**
 * Lectura del body de POST /api/mascotas y PATCH /api/mascotas/:id.
 *
 * Mismas reglas que MascotaForm de la app. El id, el código y el tutor los
 * pone el servidor: no se leen del body.
 */

import {
  DatoInvalido,
  exigir,
  leerCuerpo,
  leerFoto,
  leerPresentes,
  leerSoloFecha,
  leerTexto,
  leerTodos,
  type Lectores,
  type Resultado,
} from '../lib/entrada';
import { validarFechaNacimiento, validarNombreMascota, validarRaza, validarSenas } from '../validaciones';

/** Datos de una mascota que manda la app. */
export type DatosMascota = {
  nombre: string;
  raza: string;
  /** Sin hora, a medianoche UTC (llega como AAAA-MM-DD). */
  fechaNacimiento: Date;
  senas: string;
  foto: string | null;
};

const LECTORES: Lectores<DatosMascota> = {
  nombre: (v) => leerTexto(v, 'Nombre', (t) => validarNombreMascota(t)),
  raza: (v) => leerTexto(v, 'Raza', (t) => validarRaza(t)),
  fechaNacimiento: (v) => {
    if (v === undefined || v === null || v === '') throw new DatoInvalido('Ingresá la fecha de nacimiento.');
    const fecha = leerSoloFecha(v, 'Fecha de nacimiento');
    exigir(validarFechaNacimiento(fecha));
    return fecha;
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
