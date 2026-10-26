/**
 * Reglas de validación de los datos que llegan a la API.
 *
 * Son las mismas que doggy/mobile/src/utils/validaciones.ts y que los
 * formularios de la app (largos de `LIMITES`, caracteres permitidos por tipo
 * de campo, formatos y rangos de fechas), con los mismos mensajes. Si una
 * regla cambia en la app, cambia acá. El servidor valida igual aunque la app
 * ya lo haya hecho: nunca se confía en el cliente.
 *
 * Cada función devuelve el mensaje de error o undefined si el valor es
 * válido. La única diferencia con la app: los mensajes genéricos ("Puede tener
 * hasta 30 caracteres.") llevan adelante el nombre del campo, porque acá no
 * hay un formulario que muestre el error debajo del input.
 */

import { interpretarTelefono, MENSAJE_SOLO_ARGENTINA } from './lib/telefonos';

/** Largo máximo de cada campo de texto (el `maxLength` de los inputs de la app). */
export const LIMITES = {
  nombrePersona: 40,
  email: 100,
  password: 64,
  ubicacion: 60,
  telefono: 25,
  nombreMascota: 30,
  raza: 40,
  senas: 200,
  descripcion: 300,
  infoAdicional: 300,
  etiqueta: 24,
  motivo: 80,
  lugar: 80,
  nombreRegistro: 60,
  profesional: 60,
  codigoAsignacion: 16,
  busqueda: 50,
} as const;

/** Edad máxima razonable de una mascota, en años. */
export const EDAD_MAXIMA = 30;

/** Letras del español (con tildes, ñ y ü) y de otros idiomas latinos. */
const LETRAS = 'A-Za-zÀ-ÖØ-öø-ÿ';
const LETRA_REGEX = new RegExp(`[${LETRAS}]`, 'g');

/** Palabras de letras separadas por un espacio, guion o apóstrofe ("María José", "O'Connor"). */
const NOMBRE_PERSONA_REGEX = new RegExp(`^[${LETRAS}]+(?:[ '’-][${LETRAS}]+)*$`);

/** Palabras de letras o números separadas por un espacio, guion, punto o apóstrofe ("Toby 2", "Ch. Sharpei"). */
const NOMBRE_REGEX = new RegExp(`^[${LETRAS}0-9]+(?:[ '’.-]+[${LETRAS}0-9]+)*\\.?$`);

/**
 * Caracteres aceptados en un texto libre: letras, números, espacios, saltos
 * de línea y la puntuación de uso común, incluidas las comillas y guiones
 * "tipográficos" que pone iOS (“ ” ‘ ’ – — …).
 */
const CARACTER_TEXTO_REGEX = new RegExp(`[${LETRAS}0-9 \\n.,;:¡!¿?()"'/+#°º%&@\\-“”‘’–—…]`);

/** Formato del email: usuario@dominio.ext, sin espacios ni puntos seguidos. */
const EMAIL_REGEX =
  /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/** Caracteres que puede tener un teléfono escrito a mano: números, espacios, guiones, paréntesis, puntos y "+". */
const TELEFONO_CARACTERES_REGEX = /^\+?[\d\s\-().]+$/;

/**
 * Antepone el nombre del campo a un mensaje genérico: "Nombre: puede tener hasta 30 caracteres."
 * @param campo nombre del campo como lo ve el usuario
 * @param mensaje mensaje de la app
 * @returns el mensaje con el campo adelante
 */
export function conCampo(campo: string, mensaje: string): string {
  return `${campo}: ${mensaje.charAt(0).toLowerCase()}${mensaje.slice(1)}`;
}

// --- Textos ---

/**
 * Normaliza un texto antes de validarlo o guardarlo: saca los espacios de los
 * bordes y los repetidos y, en textos de varias líneas, deja como mucho una
 * línea en blanco seguida.
 * @param texto lo que llegó
 * @param multilinea true si el campo admite saltos de línea
 * @returns el texto limpio
 */
export function limpiarTexto(texto: string, multilinea = false): string {
  const lineas = texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((linea) => linea.replace(/[ \t\u00A0]+/g, ' ').trim());
  if (!multilinea) return lineas.join(' ').replace(/ +/g, ' ').trim();
  return lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Cuenta las letras de un texto (sin números, espacios ni signos).
 * @param texto texto a revisar
 * @returns cantidad de letras
 */
function contarLetras(texto: string): number {
  return texto.match(LETRA_REGEX)?.length ?? 0;
}

type FormatoTexto = 'nombrePersona' | 'nombre' | 'texto';

/** Reglas de un campo de texto. */
export type OpcionesTexto = {
  /** Nombre del campo, para los mensajes genéricos. */
  campo: string;
  /** Mensaje si el campo queda vacío; sin él, el campo es opcional. */
  requerido?: string;
  /** Largo mínimo, una vez limpio. */
  min?: number;
  /** Largo máximo, una vez limpio. */
  max: number;
  /** Qué caracteres se aceptan. */
  formato: FormatoTexto;
  /** true si el campo admite saltos de línea. */
  multilinea?: boolean;
};

/**
 * Validación común de los campos de texto: obligatorio, largo y caracteres permitidos.
 * @param texto lo que llegó
 * @param opciones reglas del campo
 * @returns mensaje de error o undefined
 */
export function validarTexto(texto: string, opciones: OpcionesTexto): string | undefined {
  const { campo, requerido, min = 1, max, formato, multilinea = false } = opciones;
  const valor = limpiarTexto(texto, multilinea);
  if (!valor) return requerido;
  if (valor.length < min) return conCampo(campo, `Tiene que tener al menos ${min} caracteres.`);
  if (valor.length > max) return conCampo(campo, `Puede tener hasta ${max} caracteres.`);

  if (formato === 'nombrePersona') {
    if (!NOMBRE_PERSONA_REGEX.test(valor)) {
      return conCampo(campo, 'Usá solo letras, espacios, guiones o apóstrofes.');
    }
    return undefined;
  }
  if (formato === 'nombre') {
    if (!NOMBRE_REGEX.test(valor)) {
      return conCampo(campo, 'Usá solo letras, números, espacios, puntos y guiones.');
    }
    if (contarLetras(valor) === 0) return conCampo(campo, 'Tiene que tener al menos una letra.');
    return undefined;
  }
  // Texto libre: se muestra el primer carácter que no se acepta, para que se entienda qué sacar.
  const invalido = Array.from(valor).find((c) => !CARACTER_TEXTO_REGEX.test(c));
  if (invalido) {
    return invalido.trim()
      ? conCampo(campo, `No se puede usar “${invalido}”. Usá letras, números y signos comunes.`)
      : conCampo(campo, 'Tiene caracteres que no se pueden usar.');
  }
  if (contarLetras(valor) < 2) {
    return conCampo(campo, 'Escribilo con palabras, no solo con números o signos.');
  }
  return undefined;
}

// --- Usuario ---

/**
 * Valida el nombre o el apellido de una persona.
 * @param texto texto recibido
 * @param campo "Nombre" o "Apellido"
 * @param mensaje error si está vacío
 * @returns mensaje de error o undefined
 */
export function validarNombrePersona(texto: string, campo: string, mensaje: string): string | undefined {
  return validarTexto(texto, {
    campo,
    requerido: mensaje,
    min: 2,
    max: LIMITES.nombrePersona,
    formato: 'nombrePersona',
  });
}

/**
 * Valida un email.
 * @param email texto recibido
 * @returns mensaje de error o undefined
 */
export function validarEmail(email: string): string | undefined {
  const valor = email.trim();
  if (!valor) return 'Ingresá tu email.';
  if (valor.length > LIMITES.email) return `El email puede tener hasta ${LIMITES.email} caracteres.`;
  if (!EMAIL_REGEX.test(valor) || valor.includes('..')) return 'El email no tiene un formato válido.';
  return undefined;
}

/**
 * Pasa un email al formato en que se guarda: sin espacios y en minúsculas.
 * @param email texto recibido
 * @returns el email normalizado
 */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Valida la contraseña del login: obligatoria y sin pasarse del largo máximo.
 * @param password texto recibido
 * @returns mensaje de error o undefined
 */
export function validarPasswordRequerida(password: string): string | undefined {
  if (!password) return 'Ingresá tu contraseña.';
  if (password.length > LIMITES.password) {
    return `La contraseña puede tener hasta ${LIMITES.password} caracteres.`;
  }
  return undefined;
}

/** Largo mínimo de una contraseña nueva. */
export const PASSWORD_MIN = 8;

/**
 * Valida una contraseña nueva: entre 8 y 64 caracteres, sin espacios y con
 * al menos una letra y un número.
 * @param password texto recibido
 * @returns mensaje de error o undefined
 */
export function validarPasswordNueva(password: string): string | undefined {
  if (!password) return 'Ingresá una contraseña.';
  if (password.length < PASSWORD_MIN) {
    return `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres.`;
  }
  if (password.length > LIMITES.password) {
    return `La contraseña puede tener hasta ${LIMITES.password} caracteres.`;
  }
  if (/\s/.test(password)) return 'La contraseña no puede tener espacios.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Usá al menos una letra y un número.';
  }
  return undefined;
}

/**
 * Valida la ubicación del usuario ("Palermo, Buenos Aires").
 * @param texto texto recibido
 * @returns mensaje de error o undefined
 */
export function validarUbicacion(texto: string): string | undefined {
  return validarTexto(texto, {
    campo: 'Ubicación',
    requerido: 'Ingresá tu barrio y ciudad.',
    min: 3,
    max: LIMITES.ubicacion,
    formato: 'texto',
  });
}

/**
 * Valida un teléfono con la regla compartida con la app (`interpretarTelefono`
 * de `lib/telefonos.ts`): solo de la Argentina y un número real, escrito en
 * cualquier formato habitual (con o sin 0, 15, 9 o +54 adelante).
 * @param telefono texto recibido
 * @returns mensaje de error o undefined
 */
export function validarTelefono(telefono: string): string | undefined {
  const valor = telefono.trim();
  if (!valor) return 'Ingresá un teléfono de contacto.';
  if (valor.length > LIMITES.telefono) {
    return conCampo('Teléfono', `Puede tener hasta ${LIMITES.telefono} caracteres.`);
  }
  if (!TELEFONO_CARACTERES_REGEX.test(valor)) {
    return conCampo('Teléfono', 'Usá solo números, espacios, guiones, paréntesis y "+".');
  }
  const leido = interpretarTelefono(valor);
  if (leido.ok) return undefined;
  // "Solo se aceptan teléfonos de Argentina." va tal cual; el otro error lleva el campo adelante.
  return leido.error === MENSAJE_SOLO_ARGENTINA ? leido.error : conCampo('Teléfono', leido.error);
}

// --- Mascotas y reportes ---

/**
 * Valida el nombre de una mascota.
 * @param texto texto recibido
 * @param requerido false si el campo es opcional
 * @returns mensaje de error o undefined
 */
export function validarNombreMascota(texto: string, requerido = true): string | undefined {
  return validarTexto(texto, {
    campo: 'Nombre',
    requerido: requerido ? 'Ingresá el nombre de tu mascota.' : undefined,
    min: 2,
    max: LIMITES.nombreMascota,
    formato: 'nombre',
  });
}

/**
 * Valida la raza de una mascota.
 * @param texto texto recibido
 * @param requerido false si el campo es opcional
 * @returns mensaje de error o undefined
 */
export function validarRaza(texto: string, requerido = true): string | undefined {
  return validarTexto(texto, {
    campo: 'Raza',
    requerido: requerido ? 'Ingresá la raza (o "Mestizo").' : undefined,
    min: 3,
    max: LIMITES.raza,
    formato: 'nombre',
  });
}

/**
 * Valida las señas particulares de una mascota (como en MascotaForm).
 * @param texto texto recibido
 * @returns mensaje de error o undefined
 */
export function validarSenas(texto: string): string | undefined {
  return validarTexto(texto, {
    campo: 'Señas',
    requerido: 'Contá alguna seña para reconocerla.',
    min: 5,
    max: LIMITES.senas,
    formato: 'texto',
    multilinea: true,
  });
}

/**
 * Valida la descripción de un reporte (como en Reportar).
 * @param texto texto recibido
 * @returns mensaje de error o undefined
 */
export function validarDescripcion(texto: string): string | undefined {
  return validarTexto(texto, {
    campo: 'Descripción',
    requerido: 'Describí cómo es para que su familia la reconozca.',
    min: 5,
    max: LIMITES.descripcion,
    formato: 'texto',
    multilinea: true,
  });
}

/**
 * Valida la información adicional de un reporte (opcional, como en Mi mascota perdida).
 * @param texto texto recibido
 * @returns mensaje de error o undefined
 */
export function validarInfoAdicional(texto: string): string | undefined {
  return validarTexto(texto, {
    campo: 'Información adicional',
    max: LIMITES.infoAdicional,
    formato: 'texto',
    multilinea: true,
  });
}

/**
 * Valida la zona legible de un reporte ("Palermo, CABA"). La app la arma
 * desde el GPS; usa el mismo largo que la ubicación del usuario.
 * @param texto texto recibido
 * @returns mensaje de error o undefined
 */
export function validarZona(texto: string): string | undefined {
  return validarTexto(texto, {
    campo: 'Zona',
    requerido: 'Indicá la zona del reporte.',
    max: LIMITES.ubicacion,
    formato: 'texto',
  });
}

/**
 * Valida una etiqueta del reporte ("Collar rojo").
 * @param texto texto recibido
 * @returns mensaje de error o undefined
 */
export function validarEtiqueta(texto: string): string | undefined {
  return validarTexto(texto, {
    campo: 'Etiqueta',
    requerido: 'Escribí la etiqueta.',
    min: 2,
    max: LIMITES.etiqueta,
    formato: 'nombre',
  });
}

// --- Carnet y turnos ---

/**
 * Valida el nombre de un registro del carnet (como en RegistroForm).
 * @param texto texto recibido
 * @returns mensaje de error o undefined
 */
export function validarNombreRegistro(texto: string): string | undefined {
  return validarTexto(texto, {
    campo: 'Nombre',
    requerido: 'Ingresá el nombre del registro.',
    min: 3,
    max: LIMITES.nombreRegistro,
    formato: 'texto',
  });
}

/**
 * Valida el veterinario o la clínica de un registro (como en RegistroForm).
 * @param texto texto recibido
 * @returns mensaje de error o undefined
 */
export function validarProfesional(texto: string): string | undefined {
  return validarTexto(texto, {
    campo: 'Profesional',
    requerido: 'Indicá el veterinario o la clínica.',
    min: 3,
    max: LIMITES.profesional,
    formato: 'texto',
  });
}

/**
 * Valida el motivo de un turno (como en TurnoForm).
 * @param texto texto recibido
 * @returns mensaje de error o undefined
 */
export function validarMotivo(texto: string): string | undefined {
  return validarTexto(texto, {
    campo: 'Motivo',
    requerido: 'Contá el motivo del turno.',
    min: 3,
    max: LIMITES.motivo,
    formato: 'texto',
  });
}

/**
 * Valida el lugar de un turno (como en TurnoForm).
 * @param texto texto recibido
 * @returns mensaje de error o undefined
 */
export function validarLugar(texto: string): string | undefined {
  return validarTexto(texto, {
    campo: 'Lugar',
    requerido: 'Indicá dónde es el turno.',
    min: 3,
    max: LIMITES.lugar,
    formato: 'texto',
  });
}

// --- Fechas ---

/** Zona horaria en la que se usa la app: define qué día es "hoy". */
const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';
/** Fecha sin hora, como viaja en la API: AAAA-MM-DD. */
const SOLO_FECHA_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Fecha con hora en ISO 8601 ("2026-10-22T13:30:00.000Z"). */
const FECHA_HORA_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Hasta cuántos años en el futuro se puede agendar un turno. */
const ANIOS_TURNO_MAXIMO = 2;
/** Hasta cuántos años después de la aplicación puede ser un refuerzo. */
const ANIOS_REFUERZO_MAXIMO = 5;

/**
 * Convierte una fecha AAAA-MM-DD en un Date a medianoche UTC, verificando que
 * el día exista. Así se guarda sin que se corra de día (ver "Del modelo a la
 * respuesta" en el CLAUDE.md).
 * @param texto fecha recibida
 * @returns el Date, o null si el formato o el día no son válidos (ej. 2026-02-31)
 */
export function parsearSoloFecha(texto: string): Date | null {
  const partes = SOLO_FECHA_REGEX.exec(texto);
  if (!partes) return null;
  const [, anio, mes, dia] = partes.map(Number);
  if (anio === undefined || mes === undefined || dia === undefined) return null;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  const existe =
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
  return existe ? fecha : null;
}

/**
 * Convierte una fecha con hora en ISO 8601 en un Date.
 * @param texto fecha recibida
 * @returns el Date, o null si no es un ISO con hora válido
 */
export function parsearFechaHora(texto: string): Date | null {
  if (!FECHA_HORA_REGEX.test(texto)) return null;
  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Día de hoy en Argentina, a medianoche UTC (el mismo formato con que se
 * guardan las fechas sin hora), aunque el servidor esté en otra zona.
 * @returns el Date de hoy
 */
export function hoy(): Date {
  // en-CA da el formato AAAA-MM-DD.
  const texto = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date());
  const fecha = parsearSoloFecha(texto);
  if (!fecha) throw new Error(`No se pudo calcular la fecha de hoy: "${texto}"`);
  return fecha;
}

/**
 * Suma años a una fecha guardada a medianoche UTC (negativo para restar).
 * @param fecha fecha de partida
 * @param anios años a sumar
 * @returns la fecha nueva
 */
function sumarAnios(fecha: Date, anios: number): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear() + anios, fecha.getUTCMonth(), fecha.getUTCDate()));
}

/**
 * Valida la fecha de aplicación de un registro sanitario: no futura (en el
 * carnet solo se cargan aplicaciones ya hechas) y no más vieja que la edad
 * máxima de una mascota.
 * @param fecha fecha de aplicación
 * @returns mensaje de error o undefined
 */
export function validarFechaAplicacion(fecha: Date): string | undefined {
  if (fecha > hoy()) return 'Una aplicación no puede tener fecha futura.';
  if (fecha < sumarAnios(hoy(), -EDAD_MAXIMA)) return 'Revisá el año: la fecha es demasiado vieja.';
  return undefined;
}

/**
 * Valida la fecha de nacimiento de una mascota: no futura y de hace como
 * mucho `EDAD_MAXIMA` años.
 * @param fecha fecha de nacimiento (sin hora)
 * @returns mensaje de error o undefined
 */
export function validarFechaNacimiento(fecha: Date): string | undefined {
  if (fecha > hoy()) return 'La fecha de nacimiento no puede ser futura.';
  if (fecha < sumarAnios(hoy(), -EDAD_MAXIMA)) {
    return `Revisá el año: una mascota no puede tener más de ${EDAD_MAXIMA} años.`;
  }
  return undefined;
}

/**
 * Meses cumplidos entre una fecha sin hora y hoy (la edad de una mascota).
 * Cuenta un mes más recién cuando se llega al mismo día del mes.
 * @param desde fecha de nacimiento, a medianoche UTC
 * @param hasta fecha de referencia (hoy si no se pasa)
 * @returns los meses cumplidos (0 si todavía no cumplió uno)
 */
export function mesesCumplidos(desde: Date, hasta: Date = hoy()): number {
  const meses =
    (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 12 + (hasta.getUTCMonth() - desde.getUTCMonth());
  const ajuste = hasta.getUTCDate() < desde.getUTCDate() ? 1 : 0;
  return Math.max(0, meses - ajuste);
}

/**
 * Valida la fecha del próximo refuerzo: posterior a la aplicación y a no más de 5 años.
 * @param refuerzo fecha del refuerzo
 * @param aplicada fecha de la aplicación
 * @returns mensaje de error o undefined
 */
export function validarProximaDosis(refuerzo: Date, aplicada: Date): string | undefined {
  if (refuerzo <= aplicada) return 'El refuerzo tiene que ser posterior a la aplicación.';
  if (refuerzo > sumarAnios(aplicada, ANIOS_REFUERZO_MAXIMO)) {
    return `El refuerzo no puede ser a más de ${ANIOS_REFUERZO_MAXIMO} años de la aplicación.`;
  }
  return undefined;
}

/**
 * Valida la fecha y hora de un turno: a no más de 2 años y, si se pide, a futuro.
 * @param fecha fecha y hora del turno
 * @param exigirFuturo false al editar un turno sin cambiarle la fecha (se puede
 *   corregir el motivo o el lugar de uno que ya pasó)
 * @returns mensaje de error o undefined
 */
export function validarFechaTurno(fecha: Date, exigirFuturo: boolean): string | undefined {
  // Como en la app: el límite es por día, así un turno del último día vale a cualquier hora.
  const dia = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  if (dia > sumarAnios(hoy(), ANIOS_TURNO_MAXIMO)) {
    return `El turno no puede ser a más de ${ANIOS_TURNO_MAXIMO} años.`;
  }
  if (exigirFuturo && fecha < new Date()) return 'Ese horario ya pasó.';
  return undefined;
}
