/**
 * Lectura del body de POST /api/reportes y PATCH /api/reportes/:id.
 *
 * Mismas reglas que Reportar y Mi mascota perdida de la app. Las etiquetas
 * llegan como lista de textos (hasta `MAXIMO_ETIQUETAS`, sin repetir) y el
 * radio de búsqueda es uno de `RADIOS_BUSQUEDA`, solo en reportes de perdidos.
 * En el PATCH no se puede cambiar el estado ni la mascota, y `cerrado: true`
 * cierra el reporte ("Ya apareció").
 *
 * Un encontrado se vincula a una mascota con el `codigo` del QR de su chapita
 * o con su `mascotaId` (desde "Encontré a …" en un perdido del mapa).
 *
 * Si el reporte es de una mascota registrada (`mascotaId` o `codigo`), el nombre y la
 * raza no se leen del body: los pone la ruta desde la mascota, así quien la
 * encontró por el QR no puede cambiar los datos con los que la ve su familia.
 */

import {
  ESTADOS_REPORTE,
  esValorDe,
  MAXIMO_ETIQUETAS,
  RADIOS_BUSQUEDA,
  type EstadoReporte,
} from '../dominio';
import { MENSAJE_CODIGO_INVALIDO, normalizarCodigoMascota } from '../lib/codigos';
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
  pick,
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

/**
 * Body de un reporte nuevo: los datos más el código del QR, que identifica la
 * mascota de un encontrado y prueba que quien la reporta tiene la chapita.
 */
export type ReporteNuevo = DatosReporte & { codigo: string | null };

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

const LECTORES_NUEVO: Lectores<ReporteNuevo> = {
  ...LECTORES_CONTENIDO,
  codigo: (v) => {
    if (v === undefined || v === null) return null;
    const codigo = typeof v === 'string' ? normalizarCodigoMascota(v) : null;
    if (codigo === null) throw new DatoInvalido(MENSAJE_CODIGO_INVALIDO);
    return codigo;
  },
  estado: (v) => {
    if (!esValorDe(ESTADOS_REPORTE, v)) throw new DatoInvalido('Elegí si se perdió o la encontraste.');
    return v;
  },
  mascotaId: (v) =>
    v === undefined || v === null ? null : leerIdDelCuerpo(v, 'La mascota del reporte no es válida.'),
};

/**
 * Lectores de un reporte nuevo de una mascota registrada: el nombre y la raza
 * quedan vacíos y la ruta los completa con los de la mascota.
 */
const LECTORES_NUEVO_CON_MASCOTA: Lectores<ReporteNuevo> = {
  ...LECTORES_NUEVO,
  nombre: () => '',
  raza: () => '',
};

const LECTORES_CAMBIOS: Lectores<CambiosReporte> = {
  ...LECTORES_CONTENIDO,
  cerrado: (v) => {
    if (v !== true) throw new DatoInvalido('Para cerrar el reporte mandá cerrado: true.');
    return v;
  },
};

/** Cambios de un reporte de una mascota registrada: todo menos el nombre y la raza. */
const LECTORES_CAMBIOS_CON_MASCOTA: Lectores<Omit<CambiosReporte, 'nombre' | 'raza'>> = {
  descripcion: LECTORES_CAMBIOS.descripcion,
  foto: LECTORES_CAMBIOS.foto,
  etiquetas: LECTORES_CAMBIOS.etiquetas,
  lat: LECTORES_CAMBIOS.lat,
  lng: LECTORES_CAMBIOS.lng,
  zona: LECTORES_CAMBIOS.zona,
  fecha: LECTORES_CAMBIOS.fecha,
  radioMetros: LECTORES_CAMBIOS.radioMetros,
  infoAdicional: LECTORES_CAMBIOS.infoAdicional,
  cerrado: LECTORES_CAMBIOS.cerrado,
};

/** Mensaje si un reporte de mascota encontrada trae radio de búsqueda. */
const MENSAJE_RADIO_SOLO_PERDIDOS = 'El radio de búsqueda es solo para reportes de mascotas perdidas.';

/**
 * Lee un reporte nuevo. Uno de perdida tiene que decir qué mascota es (por
 * `mascotaId`); el código del QR es solo para los encontrados.
 * @param body `req.body`
 * @returns los datos validados o el error del 400
 */
export function leerReporteNuevo(body: unknown): Resultado<ReporteNuevo> {
  return leerCuerpo(() => {
    const { mascotaId, codigo } = pick(body, ['mascotaId', 'codigo']);
    const conMascota =
      (mascotaId !== undefined && mascotaId !== null) || (codigo !== undefined && codigo !== null);
    const datos = leerTodos(body, conMascota ? LECTORES_NUEVO_CON_MASCOTA : LECTORES_NUEVO);
    if (datos.estado === 'perdido' && datos.mascotaId === null) {
      throw new DatoInvalido('Elegí la mascota que se perdió.');
    }
    if (datos.estado === 'perdido' && datos.codigo !== null) {
      throw new DatoInvalido('El código del QR es solo para avisar que la encontraste.');
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
 * @param conMascota true si el reporte es de una mascota registrada (no se
 *   cambian el nombre ni la raza, que salen de la mascota)
 * @returns los cambios validados o el error del 400
 */
export function leerCambiosReporte(
  body: unknown,
  estado: string,
  conMascota: boolean,
): Resultado<CambiosReporte> {
  return leerCuerpo(() => {
    const cambios: CambiosReporte = conMascota
      ? leerPresentes(body, LECTORES_CAMBIOS_CON_MASCOTA)
      : leerPresentes(body, LECTORES_CAMBIOS);
    if (estado !== 'perdido' && cambios.radioMetros) throw new DatoInvalido(MENSAJE_RADIO_SOLO_PERDIDOS);
    return cambios;
  });
}
