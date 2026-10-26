/**
 * Teléfonos en formato internacional, con libphonenumber-js.
 *
 * El usuario tipea el número como lo conoce ("2994554060", "299 455-4060",
 * "0299 15 455-4060", "+54 9 299 455-4060") y se guarda en E.164
 * ("+5492994554060"), así hay una sola forma de cada número y los links
 * `tel:` y de WhatsApp funcionan desde cualquier país. Sin código de país se
 * toma la Argentina. Se usa la metadata completa (`/max`) para validar el
 * número de verdad y no solo su largo; la app usa la misma.
 *
 * Regla argentina: por defecto todo número es CELULAR. Sin el 9 ni el 15,
 * libphonenumber lo toma como fijo ("2994554060" → +542994554060); acá se
 * pasa a la versión celular (+54 9 + el número nacional) si esa versión es
 * válida. Para guardar un fijo, el usuario marca "Es un teléfono fijo" y se
 * guarda sin el 9 aunque lo haya escrito con el 15. El E.164 ya dice cuál es,
 * así que no se guarda aparte. Los números de otros países quedan como son.
 */

import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js/max';

/** País que se asume cuando el número no trae código de país. */
export const REGION_TELEFONO = 'AR';

/** Código de país de la Argentina. */
const CODIGO_ARGENTINA = '54';

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
 * Convierte un teléfono escrito en cualquier formato habitual a E.164,
 * aplicando la regla argentina (celular por defecto).
 * @param texto teléfono como lo escribió el usuario
 * @param fijo true si el usuario marcó "Es un teléfono fijo"
 * @returns el número en E.164, o null si no es un número válido
 */
export function aE164(texto: string, fijo = false): string | null {
  const numero = parsePhoneNumberFromString(texto.trim(), REGION_TELEFONO);
  if (!numero?.isValid()) return null;
  if (numero.countryCallingCode !== CODIGO_ARGENTINA) return numero.number;

  const nacional = numero.nationalNumber;
  const esCelular = numero.getType() === 'MOBILE';
  if (fijo && esCelular) {
    // El celular argentino es el fijo con un 9 adelante: se le saca.
    return siEsValido(`+${CODIGO_ARGENTINA}${nacional.replace(/^9/, '')}`)?.number ?? numero.number;
  }
  if (!fijo && !esCelular) {
    return siEsValido(`+${CODIGO_ARGENTINA}9${nacional}`)?.number ?? numero.number;
  }
  return numero.number;
}

/**
 * Teléfono ya validado, en E.164 para guardarlo.
 * @param texto teléfono validado con `validarTelefono`
 * @param fijo true si el usuario marcó "Es un teléfono fijo"
 * @returns el número en E.164 (o el texto tal cual si no se pudiera convertir)
 */
export function normalizarTelefono(texto: string, fijo = false): string {
  return aE164(texto, fijo) ?? texto.trim();
}
