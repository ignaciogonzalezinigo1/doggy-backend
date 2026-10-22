/**
 * Lectura del body de POST /api/reportes y PATCH /api/reportes/:id.
 *
 * Mismas reglas que Reportar y Mi mascota perdida de la app. Las etiquetas
 * llegan como lista de textos (hasta `MAXIMO_ETIQUETAS`, sin repetir) y el
 * radio de búsqueda es uno de `RADIOS_BUSQUEDA`, solo en reportes de perdidos.
 * En el PATCH no se puede cambiar el estado ni la mascota, y `cerrado: true`
 * cierra el reporte ("Ya apareció").
 */

import {
  ESTADOS_REPORTE,
  esValorDe,
  MAXIMO_ETIQUETAS,
  RADIOS_BUSQUEDA,
  type EstadoReporte,
} from '../dominio';
import {
  DatoInvalido,
  leerCuerpo,
  leerFoto,
  leerIdDelCuerpo,
  leerNumero,
  leerPresentes,
  leerTexto,
  leerTextoOpcional,
  leerTodos,
  type Lectores,
  type Resultado,
} from '../lib/entrada';
import {
  parsearFechaHora,
  validarDescripcion,
  validarEtiqueta,
  validarInfoAdicional,
  validarNombreMascota,
  validarRaza,
  validarZona,
} from '../validaciones';

/** Contenido de un reporte que se puede cargar y editar. */
export type ContenidoReporte = {
  nombre: string;
  raza: string;
  descripcion: string;
  foto: string | null;
  etiquetas: string[];
  lat: number;
  lng: number;
  zona: string;
  fecha: Date;
  radioMetros: number | null;
  infoAdicional: string | null;
};

/** Reporte nuevo: el contenido más el estado y la mascota, que no cambian después. */
export type DatosReporte = ContenidoReporte & {
  estado: EstadoReporte;
  mascotaId: number | null;
};

/** Cambios de un reporte, con el pedido de cierre. */
export type CambiosReporte = Partial<ContenidoReporte> & { cerrado?: true };

/** Margen para la hora del celular un poco adelantada: un reporte "de ahora" no se rechaza por futuro. */
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;
const LATITUD_MAXIMA = 90;
const LONGITUD_MAXIMA = 180;

/**
 * Lee las etiquetas: lista de textos válidos, sin repetir (sin distinguir mayúsculas).
 * @param valor lo que llegó
 * @returns las etiquetas limpias
 */
function leerEtiquetas(valor: unknown): string[] {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) throw new DatoInvalido('Etiquetas: tiene que ser una lista.');
  if (valor.length > MAXIMO_ETIQUETAS) {
    throw new DatoInvalido(`Podés cargar hasta ${MAXIMO_ETIQUETAS} etiquetas.`);
  }
  const etiquetas = valor.map((etiqueta: unknown) => leerTexto(etiqueta, 'Etiqueta', validarEtiqueta));
  const distintas = new Set(etiquetas.map((etiqueta) => etiqueta.toLowerCase()));
  if (distintas.size !== etiquetas.length) throw new DatoInvalido('Esa etiqueta ya está.');
  return etiquetas;
}

/**
 * Lee el momento en que se perdió o se encontró: ISO con hora, no futuro.
 * @param valor lo que llegó
 * @returns la fecha
 */
function leerFechaReporte(valor: unknown): Date {
  const fecha = typeof valor === 'string' ? parsearFechaHora(valor) : null;
  if (!fecha) throw new DatoInvalido('Fecha: tiene que tener día y hora.');
  if (fecha.getTime() > Date.now() + TOLERANCIA_FUTURO_MS) {
    throw new DatoInvalido('La fecha del reporte no puede ser futura.');
  }
  return fecha;
}

/**
 * Lee el radio de búsqueda: uno de `RADIOS_BUSQUEDA`, o null si no tiene.
 * @param valor lo que llegó
 * @returns el radio en metros o null
 */
function leerRadio(valor: unknown): number | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'number' || !(RADIOS_BUSQUEDA as readonly number[]).includes(valor)) {
    throw new DatoInvalido(`Radio de búsqueda: elegí uno de ${RADIOS_BUSQUEDA.join(', ')} metros.`);
  }
  return valor;
}

const LECTORES_CONTENIDO: Lectores<ContenidoReporte> = {
  nombre: (v) => leerTexto(v, 'Nombre', (t) => validarNombreMascota(t)),
  raza: (v) => leerTexto(v, 'Raza', (t) => validarRaza(t)),
  descripcion: (v) => leerTexto(v, 'Descripción', validarDescripcion, true),
  foto: (v) => leerFoto(v),
  etiquetas: leerEtiquetas,
  lat: (v) => leerNumero(v, 'Latitud', -LATITUD_MAXIMA, LATITUD_MAXIMA),
  lng: (v) => leerNumero(v, 'Longitud', -LONGITUD_MAXIMA, LONGITUD_MAXIMA),
  zona: (v) => leerTexto(v, 'Zona', validarZona),
  fecha: leerFechaReporte,
  radioMetros: leerRadio,
  infoAdicional: (v) => leerTextoOpcional(v, 'Información adicional', validarInfoAdicional, true),
};

const LECTORES_NUEVO: Lectores<DatosReporte> = {
  ...LECTORES_CONTENIDO,
  estado: (v) => {
    if (!esValorDe(ESTADOS_REPORTE, v)) throw new DatoInvalido('Elegí si se perdió o la encontraste.');
    return v;
  },
  mascotaId: (v) =>
    v === undefined || v === null ? null : leerIdDelCuerpo(v, 'La mascota del reporte no es válida.'),
};

const LECTORES_CAMBIOS: Lectores<CambiosReporte> = {
  ...LECTORES_CONTENIDO,
  cerrado: (v) => {
    if (v !== true) throw new DatoInvalido('Para cerrar el reporte mandá cerrado: true.');
    return v;
  },
};

/** Mensaje si un reporte de mascota encontrada trae radio de búsqueda. */
const MENSAJE_RADIO_SOLO_PERDIDOS = 'El radio de búsqueda es solo para reportes de mascotas perdidas.';

/**
 * Lee un reporte nuevo. Uno de perdida tiene que decir qué mascota es.
 * @param body `req.body`
 * @returns los datos validados o el error del 400
 */
export function leerReporteNuevo(body: unknown): Resultado<DatosReporte> {
  return leerCuerpo(() => {
    const datos = leerTodos(body, LECTORES_NUEVO);
    if (datos.estado === 'perdido' && datos.mascotaId === null) {
      throw new DatoInvalido('Elegí la mascota que se perdió.');
    }
    if (datos.estado === 'encontrado' && datos.radioMetros !== null) {
      throw new DatoInvalido(MENSAJE_RADIO_SOLO_PERDIDOS);
    }
    return datos;
  });
}

/**
 * Lee los cambios de un reporte.
 * @param body `req.body`
 * @param estado estado guardado del reporte (el radio es solo para perdidos)
 * @returns los cambios validados o el error del 400
 */
export function leerCambiosReporte(body: unknown, estado: string): Resultado<CambiosReporte> {
  return leerCuerpo(() => {
    const cambios = leerPresentes(body, LECTORES_CAMBIOS);
    if (estado !== 'perdido' && cambios.radioMetros) throw new DatoInvalido(MENSAJE_RADIO_SOLO_PERDIDOS);
    return cambios;
  });
}
