/**
 * Teléfonos en formato internacional, con libphonenumber-js.
 *
 * El usuario tipea el número como lo conoce ("11 15 4589-2310",
 * "011 15 4589-2310", "+54 9 11 4589-2310") y se guarda en E.164
 * ("+5491145892310"), así hay una sola forma de cada número y los links
 * `tel:` funcionan desde cualquier país. Sin código de país se toma la
 * Argentina. Se usa la metadata completa (`/max`) para validar el número de
 * verdad y no solo su largo; la app usa la misma.
 *
 * Ojo con los celulares argentinos: sin el 9 (internacional) o el 15 (local),
 * "11 4589-2310" es un número fijo (+541145892310), distinto del celular.
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/** País que se asume cuando el número no trae código de país. */
export const REGION_TELEFONO = 'AR';

/**
 * Convierte un teléfono escrito en cualquier formato habitual a E.164.
 * @param texto teléfono como lo escribió el usuario
 * @returns el número en E.164, o null si no es un número válido
 */
export function aE164(texto: string): string | null {
  const numero = parsePhoneNumberFromString(texto.trim(), REGION_TELEFONO);
  return numero?.isValid() ? numero.number : null;
}

/**
 * Teléfono ya validado, en E.164 para guardarlo.
 * @param texto teléfono validado con `validarTelefono`
 * @returns el número en E.164 (o el texto tal cual si no se pudiera convertir)
 */
export function normalizarTelefono(texto: string): string {
  return aE164(texto) ?? texto.trim();
}
