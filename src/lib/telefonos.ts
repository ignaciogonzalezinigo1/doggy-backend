/**
 * Teléfonos argentinos con libphonenumber-js: la única regla de teléfonos de
 * Doggy, la misma en la app y en la API.
 *
 * Este archivo es idéntico en los dos repos: `doggy/mobile/src/utils/telefonos.ts`
 * (la app) y `doggy-backend/src/lib/telefonos.ts` (la API). `npm test` del
 * backend compara las dos copias y falla si difieren: si una regla cambia, se
 * cambia acá y se copia el archivo entero al otro repo. Por eso no importa
 * nada de ninguno de los dos.
 *
 * Reglas:
 * - Solo números de la Argentina. Cualquier otro país da "Solo se aceptan
 *   teléfonos de Argentina.".
 * - Se escribe la característica y el número en cualquier formato habitual:
 *   con o sin 0, con o sin 15, con o sin 9, con espacios o guiones. Si viene
 *   el código de país adelante (+54, 54, 0054, 549), se saca.
 * - Por defecto es CELULAR: "2994554060", "299 455-4060", "0299 15 455-4060",
 *   "+54 299 455 4060" y "54 9 299 455-4060" dan +5492994554060. Sin el 9 ni
 *   el 15, libphonenumber lo toma como fijo; acá se pasa a la versión celular.
 *   Con "Es un teléfono fijo" marcado se guarda sin el 9.
 * - Se guarda en E.164 y se muestra siempre con `formatearTelefono`
 *   ("+54 9 299 455-4060", "+54 11 4777-3020").
 *
 * Se usa la metadata completa (`/max`) para validar el número de verdad y no
 * solo su largo.
 */
import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js/max';

/** País que se asume cuando el número no trae código de país. */
export const REGION_TELEFONO = 'AR';
/** Código de país de la Argentina. */
const CODIGO_ARGENTINA = '54';
/** Lo que se marca entre el código de país y la característica para llamar a un celular. */
const PREFIJO_CELULAR = '9';
/** Dígitos de un número argentino sin 0, 15 ni 9: característica y número. */
const DIGITOS_NACIONALES = 10;

/** Error de un número de otro país. */
export const MENSAJE_SOLO_ARGENTINA = 'Solo se aceptan teléfonos de Argentina.';
/** Error de un número que no existe. */
export const MENSAJE_TELEFONO_INVALIDO =
  'No es un número válido. Escribilo con la característica, por ejemplo 11 4589-2310 o 299 455-4060.';

/** Resultado de leer un teléfono: el E.164 o el mensaje de error. */
export type LecturaTelefono = { ok: true; e164: string } | { ok: false; error: string };

/**
 * Interpreta un número E.164 y lo devuelve solo si es válido.
 * @param e164 número con +
 * @returns el número, o null si no es válido
 */
function siEsValido(e164: string): PhoneNumber | null {
  const numero = parsePhoneNumberFromString(e164);
  return numero?.isValid() ? numero : null;
}

/**
 * Número nacional sin el 9 de los celulares (el celular argentino es el fijo
 * con un 9 adelante).
 * @param nacional número nacional de libphonenumber ("92994554060")
 * @returns característica y número ("2994554060")
 */
function sinPrefijoCelular(nacional: string): string {
  return nacional.length === DIGITOS_NACIONALES + 1 && nacional.startsWith(PREFIJO_CELULAR)
    ? nacional.slice(1)
    : nacional;
}

/**
 * Saca el código de país argentino que se escribió o pegó adelante: +54,
 * 0054 o 54 (con o sin el 9 de celular). Sin "+" ni "00", "54" solo se toma
 * como código de país si sobran dígitos para un número nacional (ninguna
 * característica argentina empieza con 5).
 * @param texto teléfono como lo escribió el usuario
 * @returns los dígitos de la característica y el número, o null si no venía
 *   con el código de la Argentina
 */
export function sacarCodigoPais(texto: string): string | null {
  const limpio = texto.trim();
  const digitos = limpio.replace(/\D/g, '');
  let nacional: string;
  if (limpio.startsWith('+')) {
    if (!digitos.startsWith(CODIGO_ARGENTINA)) return null;
    nacional = digitos.slice(CODIGO_ARGENTINA.length);
  } else if (digitos.startsWith(`00${CODIGO_ARGENTINA}`)) {
    nacional = digitos.slice(CODIGO_ARGENTINA.length + 2);
  } else if (digitos.startsWith(CODIGO_ARGENTINA) && digitos.length > DIGITOS_NACIONALES + 1) {
    nacional = digitos.slice(CODIGO_ARGENTINA.length);
  } else {
    return null;
  }
  return sinPrefijoCelular(nacional);
}

/**
 * Lee un teléfono escrito en cualquier formato habitual y lo pasa a E.164,
 * con la regla argentina: celular por defecto, fijo solo si se marcó.
 * @param texto teléfono como lo escribió el usuario
 * @param fijo true si el usuario marcó "Es un teléfono fijo"
 * @returns el E.164, o el error si es de otro país o no es un número válido
 */
export function interpretarTelefono(texto: string, fijo = false): LecturaTelefono {
  const nacional = sacarCodigoPais(texto);
  const numero =
    nacional !== null
      ? parsePhoneNumberFromString(`+${CODIGO_ARGENTINA}${nacional}`)
      : parsePhoneNumberFromString(texto.trim(), REGION_TELEFONO);
  if (numero && numero.countryCallingCode !== CODIGO_ARGENTINA) {
    return { ok: false, error: MENSAJE_SOLO_ARGENTINA };
  }
  if (!numero?.isValid()) return { ok: false, error: MENSAJE_TELEFONO_INVALIDO };
  const base = sinPrefijoCelular(numero.nationalNumber);
  const pedido = siEsValido(`+${CODIGO_ARGENTINA}${fijo ? '' : PREFIJO_CELULAR}${base}`);
  // Si la versión pedida no existe (pasa con pocas numeraciones), queda la que sí.
  return { ok: true, e164: (pedido ?? numero).number };
}

/**
 * Teléfono en E.164, o null si no es un número argentino válido.
 * @param texto teléfono como lo escribió el usuario (o ya en E.164)
 * @param fijo true si el usuario marcó "Es un teléfono fijo"
 * @returns el número en E.164 ("+5492994554060") o null
 */
export function aE164(texto: string, fijo = false): string | null {
  const leido = interpretarTelefono(texto, fijo);
  return leido.ok ? leido.e164 : null;
}

/**
 * Teléfono para mostrar, el mismo formato en toda la app: internacional con
 * el último grupo unido por un guion ("+54 9 299 455-4060", "+54 9 11 4589-2310",
 * "+54 11 4777-3020"). Si no se puede interpretar, queda como está.
 * @param telefono teléfono guardado (en E.164)
 * @returns el teléfono listo para mostrar
 */
export function formatearTelefono(telefono: string): string {
  const numero = parsePhoneNumberFromString(telefono.trim(), REGION_TELEFONO);
  if (!numero?.isValid()) return telefono;
  return numero.formatInternational().replace(/ (\d+)$/, '-$1');
}

/**
 * Teléfono para el input, que ya muestra el +54 fijo: solo la característica
 * y el número, sin 0, 15 ni 9 ("299 455-4060", "11 4589-2310").
 * @param telefono teléfono guardado (en E.164)
 * @returns el texto para el campo, o el teléfono tal cual si no es argentino
 */
export function telefonoParaEditar(telefono: string): string {
  const numero = parsePhoneNumberFromString(telefono.trim(), REGION_TELEFONO);
  if (!numero?.isValid() || numero.countryCallingCode !== CODIGO_ARGENTINA) return telefono;
  const base = sinPrefijoCelular(numero.nationalNumber);
  const comoFijo = siEsValido(`+${CODIGO_ARGENTINA}${base}`);
  return comoFijo ? comoFijo.formatNational().replace(/^0/, '') : base;
}

/**
 * Si el texto trae el código de país adelante, lo saca y lo deja como en el
 * input ("+54 9 299 455 4060" → "299 455-4060"). Lo usa el input al pegar y
 * al salir del campo.
 * @param texto lo que escribió o pegó el usuario
 * @returns el texto sin el código de país, o null si no lo traía
 */
export function quitarCodigoPais(texto: string): string | null {
  const nacional = sacarCodigoPais(texto);
  if (nacional === null) return null;
  const e164 = aE164(nacional);
  return e164 ? telefonoParaEditar(e164) : nacional;
}

/**
 * Indica si un teléfono es un celular (para ofrecer WhatsApp). Usa el tipo
 * de número de libphonenumber-js: MOBILE, o FIXED_LINE_OR_MOBILE cuando el
 * plan del país no permite distinguirlos. En la Argentina, un celular lleva
 * el 9 (internacional) o el 15 (local).
 * @param telefono teléfono guardado (en E.164)
 * @returns true si se le puede escribir por WhatsApp
 */
export function esCelular(telefono: string): boolean {
  const numero = parsePhoneNumberFromString(telefono.trim(), REGION_TELEFONO);
  if (!numero?.isValid()) return false;
  const tipo = numero.getType();
  return tipo === 'MOBILE' || tipo === 'FIXED_LINE_OR_MOBILE';
}
