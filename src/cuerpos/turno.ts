/**
 * Lectura del body de POST /api/turnos y PATCH /api/turnos/:id.
 *
 * Mismas reglas que TurnoForm de la app: fecha con hora (ISO), a no más de 2
 * años y a futuro. Al editar, "a futuro" solo se exige si cambió la fecha,
 * así se puede corregir el motivo o el lugar de un turno que ya pasó.
 */

import { CATEGORIAS_TURNO, esValorDe, type CategoriaTurno } from '../dominio';
import type { Turno } from '../generated/prisma/client';
import {
  DatoInvalido,
  exigir,
  leerCuerpo,
  leerIdDelCuerpo,
  leerPresentes,
  leerTexto,
  leerTodos,
  type Lectores,
  type Resultado,
} from '../lib/entrada';
import { parsearFechaHora, validarFechaTurno, validarLugar, validarMotivo } from '../validaciones';

/** Datos de un turno tal como se guardan (sin id). */
export type DatosTurno = {
  mascotaId: number;
  categoria: CategoriaTurno;
  fecha: Date;
  motivo: string;
  lugar: string;
};

const LECTORES: Lectores<DatosTurno> = {
  mascotaId: (v) => leerIdDelCuerpo(v, 'Elegí una mascota.'),
  categoria: (v) => {
    if (!esValorDe(CATEGORIAS_TURNO, v)) throw new DatoInvalido('Elegí una categoría.');
    return v;
  },
  fecha: (v) => {
    if (v === undefined || v === null || v === '') throw new DatoInvalido('Ingresá la fecha.');
    const fecha = typeof v === 'string' ? parsearFechaHora(v) : null;
    if (!fecha) throw new DatoInvalido('Fecha: tiene que tener día y hora.');
    // El límite de 2 años vale siempre; "a futuro" depende de si es alta o edición.
    exigir(validarFechaTurno(fecha, false));
    return fecha;
  },
  motivo: (v) => leerTexto(v, 'Motivo', validarMotivo),
  lugar: (v) => leerTexto(v, 'Lugar', validarLugar),
};

/**
 * Lee un turno nuevo (tiene que ser a futuro).
 * @param body `req.body`
 * @returns los datos validados o el error del 400
 */
export function leerTurnoNuevo(body: unknown): Resultado<DatosTurno> {
  return leerCuerpo(() => {
    const datos = leerTodos(body, LECTORES);
    exigir(validarFechaTurno(datos.fecha, true));
    return datos;
  });
}

/**
 * Lee los cambios de un turno. Si cambió la fecha, la nueva tiene que ser a futuro.
 * @param body `req.body`
 * @param actual turno guardado
 * @returns los cambios validados o el error del 400
 */
export function leerCambiosTurno(body: unknown, actual: Turno): Resultado<Partial<DatosTurno>> {
  return leerCuerpo(() => {
    const cambios = leerPresentes(body, LECTORES);
    if (cambios.fecha && cambios.fecha.getTime() !== actual.fecha.getTime()) {
      exigir(validarFechaTurno(cambios.fecha, true));
    }
    return cambios;
  });
}
