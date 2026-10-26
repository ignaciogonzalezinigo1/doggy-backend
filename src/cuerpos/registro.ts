/**
 * Lectura del body de POST /api/mascotas/:id/registros y PATCH /api/registros/:id.
 *
 * Mismas reglas que RegistroForm de la app. Las fechas llegan como AAAA-MM-DD
 * y se guardan a medianoche UTC. Las reglas que cruzan campos (refuerzo
 * posterior a la aplicación, foto de etiqueta solo en vacunas) se revisan
 * sobre el registro completo: en un PATCH, lo que vino más lo guardado.
 */

import { esValorDe, TIPOS_REGISTRO, type TipoRegistro } from '../dominio';
import type { RegistroSanitario } from '../generated/prisma/client';
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
import {
  validarFechaAplicacion,
  validarNombreRegistro,
  validarProfesional,
  validarProximaDosis,
} from '../validaciones';

/** Datos de un registro tal como se guardan (sin id ni mascotaId). */
export type DatosRegistro = {
  tipo: TipoRegistro;
  nombre: string;
  fecha: Date;
  profesional: string;
  proximaDosis: Date | null;
  fotoEtiqueta: string | null;
};

const LECTORES: Lectores<DatosRegistro> = {
  tipo: (v) => {
    if (!esValorDe(TIPOS_REGISTRO, v)) throw new DatoInvalido('Elegí el tipo de registro.');
    return v;
  },
  nombre: (v) => leerTexto(v, 'Nombre', validarNombreRegistro),
  fecha: (v) => {
    if (v === undefined || v === null || v === '') throw new DatoInvalido('Ingresá la fecha.');
    const fecha = leerSoloFecha(v, 'Fecha');
    exigir(validarFechaAplicacion(fecha));
    return fecha;
  },
  profesional: (v) => leerTexto(v, 'Profesional', validarProfesional),
  proximaDosis: (v) => (v === undefined || v === null || v === '' ? null : leerSoloFecha(v, 'Próxima dosis')),
  fotoEtiqueta: (v) => leerFoto(v, 'Foto de la etiqueta'),
};

/**
 * Revisa las reglas que cruzan campos sobre el registro completo.
 * @param registro registro como va a quedar
 */
function validarConjunto(registro: DatosRegistro): void {
  if (registro.proximaDosis) exigir(validarProximaDosis(registro.proximaDosis, registro.fecha));
}

/**
 * Lee un registro nuevo.
 * @param body `req.body`
 * @returns los datos validados o el error del 400
 */
export function leerRegistroNuevo(body: unknown): Resultado<DatosRegistro> {
  return leerCuerpo(() => {
    const datos = leerTodos(body, LECTORES);
    if (datos.fotoEtiqueta && datos.tipo !== 'vacuna') {
      throw new DatoInvalido('La foto de la etiqueta es solo para vacunas.');
    }
    validarConjunto(datos);
    return datos;
  });
}

/**
 * Lee los cambios de un registro y los valida junto con lo guardado.
 * Si el registro deja de ser una vacuna y no se mandó la foto de la etiqueta,
 * la foto guardada se borra (es lo que hace el formulario de la app).
 * @param body `req.body`
 * @param actual registro guardado
 * @returns los cambios a guardar o el error del 400
 */
export function leerCambiosRegistro(
  body: unknown,
  actual: RegistroSanitario,
): Resultado<Partial<DatosRegistro>> {
  return leerCuerpo(() => {
    const leidos = leerPresentes(body, LECTORES);
    const tipo = leidos.tipo ?? (actual.tipo as TipoRegistro);
    if (tipo !== 'vacuna' && leidos.fotoEtiqueta) {
      throw new DatoInvalido('La foto de la etiqueta es solo para vacunas.');
    }
    const cambios = tipo === 'vacuna' ? leidos : { ...leidos, fotoEtiqueta: null };
    validarConjunto({
      tipo,
      nombre: cambios.nombre ?? actual.nombre,
      fecha: cambios.fecha ?? actual.fecha,
      profesional: cambios.profesional ?? actual.profesional,
      proximaDosis: cambios.proximaDosis !== undefined ? cambios.proximaDosis : actual.proximaDosis,
      fotoEtiqueta: cambios.fotoEtiqueta ?? actual.fotoEtiqueta,
    });
    return cambios;
  });
}
