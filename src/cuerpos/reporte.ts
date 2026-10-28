/**
 * Lectura del body de POST /api/reportes y PATCH /api/reportes/:id.
 *
 * Mismas reglas que Reportar y Mi mascota perdida de la app. Las etiquetas
 * llegan como lista de textos (hasta `MAXIMO_ETIQUETAS`, sin repetir) y el
 * radio de búsqueda es uno de `RADIOS_BUSQUEDA`, solo en reportes de perdidos.
 * En el PATCH no se puede cambiar el estado ni la mascota, y `cerrado: true`
 * cierra el reporte ("Ya apareció").
 *
 * Todo reporte es de una mascota registrada: un perdido, de una mascota del
 * usuario (`mascotaId`); un encontrado, de la mascota del `codigo` del QR de su
 * chapita, que es la única prueba de que quien avisa la tiene (sin código, 400).
 * El nombre y la raza (y en un encontrado también la foto y las señas) no se
 * leen del body: los pone la ruta desde la mascota, así quien la encontró no
 * puede cambiar los datos con los que la ve su familia.
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

/** Mensaje si un encontrado no trae el código del QR. */
const MENSAJE_SIN_CODIGO = 'Escaneá el QR de su chapita para avisar que la encontraste.';
/** Mensaje si un perdido trae el código del QR. */
const MENSAJE_CODIGO_SOLO_ENCONTRADOS = 'El código del QR es solo para avisar que la encontraste.';
/** Mensaje si un reporte de mascota encontrada trae radio de búsqueda. */
const MENSAJE_RADIO_SOLO_PERDIDOS = 'El radio de búsqueda es solo para reportes de mascotas perdidas.';

/** Lee el `mascotaId` del body, o null si no vino. */
const leerMascotaId = (v: unknown) =>
  v === undefined || v === null ? null : leerIdDelCuerpo(v, 'La mascota del reporte no es válida.');

/**
 * Lee el código del QR: normalizado, o null si no vino.
 * @param v lo que llegó
 * @returns el código DOGGY-XXXX-NOMBRE en mayúsculas, o null
 */
function leerCodigo(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const codigo = typeof v === 'string' ? normalizarCodigoMascota(v) : null;
  if (codigo === null) throw new DatoInvalido(MENSAJE_CODIGO_INVALIDO);
  return codigo;
}

/**
 * Lectores de un perdido: de una mascota del usuario (`mascotaId`). El nombre
 * y la raza quedan vacíos y la ruta los completa con los de la mascota.
 */
const LECTORES_PERDIDO: Lectores<ReporteNuevo> = {
  ...LECTORES_CONTENIDO,
  nombre: () => '',
  raza: () => '',
  estado: () => 'perdido',
  mascotaId: (v) => {
    const mascotaId = leerMascotaId(v);
    if (mascotaId === null) throw new DatoInvalido('Elegí la mascota que se perdió.');
    return mascotaId;
  },
  codigo: (v) => {
    if (v !== undefined && v !== null) throw new DatoInvalido(MENSAJE_CODIGO_SOLO_ENCONTRADOS);
    return null;
  },
};

/**
 * Lectores de un encontrado: exige el `codigo` del QR (la chapita es la única
 * prueba de que tiene a la mascota). Quien la encontró manda solo dónde está
 * (`lat`, `lng`, `zona`, `fecha`) y un comentario opcional (`infoAdicional`).
 * Nombre, raza, foto y descripción (las señas) los pone la ruta desde la
 * mascota; lo que venga en el body se ignora. El `mascotaId` es opcional y,
 * si viene, tiene que ser el del código.
 */
const LECTORES_ENCONTRADO: Lectores<ReporteNuevo> = {
  ...LECTORES_CONTENIDO,
  nombre: () => '',
  raza: () => '',
  descripcion: () => '',
  foto: () => null,
  etiquetas: () => [],
  radioMetros: (v) => {
    if (v !== undefined && v !== null) throw new DatoInvalido(MENSAJE_RADIO_SOLO_PERDIDOS);
    return null;
  },
  estado: () => 'encontrado',
  mascotaId: leerMascotaId,
  codigo: (v) => {
    const codigo = leerCodigo(v);
    if (codigo === null) throw new DatoInvalido(MENSAJE_SIN_CODIGO);
    return codigo;
  },
};

const LECTORES_CAMBIOS: Lectores<CambiosReporte> = {
  ...LECTORES_CONTENIDO,
  cerrado: (v) => {
    if (v !== true) throw new DatoInvalido('Para cerrar el reporte mandá cerrado: true.');
    return v;
  },
};

/** Cambios de un perdido: todo menos el nombre y la raza, que salen de la mascota. */
const LECTORES_CAMBIOS_PERDIDO: Lectores<Omit<CambiosReporte, 'nombre' | 'raza'>> = {
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

/** Lo que se puede cambiar de un encontrado vinculado. */
type CambiosEncontrado = Pick<CambiosReporte, 'lat' | 'lng' | 'zona' | 'fecha' | 'infoAdicional' | 'cerrado'>;

/** Cambios de un encontrado vinculado: solo dónde está, el comentario y el cierre. */
const LECTORES_CAMBIOS_ENCONTRADO: Lectores<CambiosEncontrado> = {
  lat: LECTORES_CAMBIOS.lat,
  lng: LECTORES_CAMBIOS.lng,
  zona: LECTORES_CAMBIOS.zona,
  fecha: LECTORES_CAMBIOS.fecha,
  infoAdicional: LECTORES_CAMBIOS.infoAdicional,
  cerrado: LECTORES_CAMBIOS.cerrado,
};

/**
 * Lee un reporte nuevo. Un perdido dice qué mascota es (`mascotaId`); un
 * encontrado, el `codigo` del QR de su chapita (sin código no hay encontrado).
 * @param body `req.body`
 * @returns los datos validados o el error del 400
 */
export function leerReporteNuevo(body: unknown): Resultado<ReporteNuevo> {
  return leerCuerpo(() => {
    const { estado } = pick(body, ['estado']);
    if (!esValorDe(ESTADOS_REPORTE, estado)) throw new DatoInvalido('Elegí si se perdió o la encontraste.');
    return leerTodos(body, estado === 'perdido' ? LECTORES_PERDIDO : LECTORES_ENCONTRADO);
  });
}

/**
 * Lee los cambios de un reporte.
 * @param body `req.body`
 * @param estado estado guardado del reporte (el radio es solo para perdidos)
 * @param conMascota true si el reporte es de una mascota registrada (no se
 *   cambian el nombre ni la raza, que salen de la mascota; en un encontrado,
 *   tampoco la foto ni la descripción)
 * @returns los cambios validados o el error del 400
 */
export function leerCambiosReporte(
  body: unknown,
  estado: string,
  conMascota: boolean,
): Resultado<CambiosReporte> {
  return leerCuerpo(() => {
    // Sin mascota solo quedan los encontrados anónimos de antes, que se publicaban a mano.
    if (!conMascota) {
      const cambios = leerPresentes(body, LECTORES_CAMBIOS);
      if (cambios.radioMetros) throw new DatoInvalido(MENSAJE_RADIO_SOLO_PERDIDOS);
      return cambios;
    }
    return estado === 'perdido'
      ? leerPresentes(body, LECTORES_CAMBIOS_PERDIDO)
      : leerPresentes(body, LECTORES_CAMBIOS_ENCONTRADO);
  });
}
