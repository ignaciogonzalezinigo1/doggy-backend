/**
 * Lectura de lo que llega en el request: ids de la URL y campos del body.
 *
 * Es el primer paso del molde de las rutas: `parseId` (400 si el id no
 * sirve), `pick` del body a los campos permitidos y después validar. Los
 * lectores de campos (`leerTexto`, `leerFoto`, etc.) validan con las reglas de
 * src/validaciones.ts y cortan con `DatoInvalido`; `leerCuerpo` lo convierte
 * en un `Resultado` que la ruta responde como 400.
 */

import { CLAVES_FOTO_SEED, esValorDe } from '../dominio';
import { conCampo, limpiarTexto, parsearSoloFecha, validarTelefono } from '../validaciones';
import { esRutaUpload, existeUpload } from './fotos';
import { aE164 } from './telefonos';

/** Mensaje cuando el id de la URL no es un entero positivo. */
export const MENSAJE_ID_INVALIDO = 'El id no es válido.';

/** Mensaje cuando el body no es un objeto JSON. */
const MENSAJE_BODY_INVALIDO = 'Faltan los datos o no tienen un formato válido.';

/** Resultado de leer un body: los datos listos para Prisma o el mensaje del 400. */
export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

/** Dato del body que no pasa la validación. Lo atrapa `leerCuerpo`. */
export class DatoInvalido extends Error {}

/** Body ya filtrado: solo los campos permitidos, con valor desconocido. */
export type Cuerpo<K extends string> = Partial<Record<K, unknown>>;

/**
 * Convierte un parámetro de la URL en un id (entero positivo).
 * @param valor `req.params.id` o similar
 * @returns el id, o null si no es un entero positivo
 */
export function parseId(valor: string | undefined): number | null {
  if (valor === undefined || !/^\d+$/.test(valor)) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Se queda con los campos permitidos del body. Nunca se pasa el body entero a Prisma.
 * @param body `req.body` (puede ser cualquier cosa, o undefined si no vino JSON)
 * @param campos campos que acepta la ruta
 * @returns los campos que vinieron
 * @throws DatoInvalido si el body no es un objeto
 */
export function pick<K extends string>(body: unknown, campos: readonly K[]): Cuerpo<K> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DatoInvalido(MENSAJE_BODY_INVALIDO);
  }
  const fuente = body as Record<string, unknown>;
  return Object.fromEntries(
    campos.filter((campo) => fuente[campo] !== undefined).map((campo) => [campo, fuente[campo]]),
  ) as Cuerpo<K>;
}

/**
 * Corre la lectura de un body y convierte un `DatoInvalido` en un resultado con error.
 * Cualquier otro error sigue de largo (la ruta responde 500).
 * @param leer función que lee y valida el body
 * @returns los datos o el mensaje de error
 */
export function leerCuerpo<T>(leer: () => T): Resultado<T> {
  try {
    return { ok: true, datos: leer() };
  } catch (error) {
    if (error instanceof DatoInvalido) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Corta la lectura si una validación devolvió un mensaje.
 * @param error lo que devolvió la función de validaciones.ts
 */
export function exigir(error: string | undefined): void {
  if (error) throw new DatoInvalido(error);
}

/**
 * Lee un campo de texto: lo valida y lo devuelve limpio. Si no vino, se
 * valida como texto vacío, así sale el mensaje de "obligatorio" de la app.
 * @param valor lo que llegó
 * @param campo nombre del campo, para el mensaje si no es texto
 * @param validar regla de validaciones.ts
 * @param multilinea true si admite saltos de línea
 * @returns el texto limpio
 */
export function leerTexto(
  valor: unknown,
  campo: string,
  validar: (texto: string) => string | undefined,
  multilinea = false,
): string {
  const texto = valor ?? '';
  if (typeof texto !== 'string') throw new DatoInvalido(conCampo(campo, 'Tiene que ser un texto.'));
  exigir(validar(texto));
  return limpiarTexto(texto, multilinea);
}

/**
 * Lee un texto opcional: vacío o null se guarda como null (así se borra en un PATCH).
 * @param valor lo que llegó
 * @param campo nombre del campo
 * @param validar regla de validaciones.ts
 * @param multilinea true si admite saltos de línea
 * @returns el texto limpio, o null
 */
export function leerTextoOpcional(
  valor: unknown,
  campo: string,
  validar: (texto: string) => string | undefined,
  multilinea = false,
): string | null {
  const texto = leerTexto(valor, campo, validar, multilinea);
  return texto || null;
}

/**
 * Lee una foto. Solo acepta una clave de las fotos del seed o la ruta de una
 * foto subida con POST /api/fotos ("/uploads/<nombre>.jpg") cuyo archivo
 * exista. Una URI del celular (file://, content://, blob:) se rechaza: es un
 * archivo temporal que nadie más puede ver.
 * @param valor lo que llegó
 * @param campo nombre del campo
 * @returns la foto o null si no tiene
 */
export function leerFoto(valor: unknown, campo = 'Foto'): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string') throw new DatoInvalido(conCampo(campo, 'Tiene que ser un texto.'));
  if (esValorDe(CLAVES_FOTO_SEED, valor)) return valor;
  if (!esRutaUpload(valor)) {
    throw new DatoInvalido(conCampo(campo, 'No tiene un formato válido.'));
  }
  if (!existeUpload(valor)) {
    throw new DatoInvalido(conCampo(campo, 'No la encontramos en el servidor. Elegila de nuevo.'));
  }
  return valor;
}

/**
 * Lee un número dentro de un rango.
 * @param valor lo que llegó
 * @param campo nombre del campo
 * @param min mínimo aceptado
 * @param max máximo aceptado
 * @returns el número
 */
export function leerNumero(valor: unknown, campo: string, min: number, max: number): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < min || valor > max) {
    throw new DatoInvalido(conCampo(campo, `Tiene que ser un número entre ${min} y ${max}.`));
  }
  return valor;
}

/**
 * Lee un id que viene en el body (por ejemplo, `mascotaId`).
 * @param valor lo que llegó
 * @param mensaje error si falta o no es válido
 * @returns el id
 */
export function leerIdDelCuerpo(valor: unknown, mensaje: string): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor <= 0) {
    throw new DatoInvalido(mensaje);
  }
  return valor;
}

/** Mensaje cuando un PATCH no trae ningún campo que se pueda cambiar. */
const MENSAJE_SIN_CAMBIOS = 'No hay cambios para guardar.';

/** Un lector por campo: recibe lo que llegó y devuelve el valor validado. */
export type Lectores<T> = { [K in keyof T]-?: (valor: unknown) => T[K] };

/**
 * Lee todos los campos de un POST con sus lectores (los que faltan se validan
 * como vacíos, así salen los mensajes de "obligatorio").
 * @param body `req.body`
 * @param lectores un lector por campo permitido
 * @returns los datos validados
 */
export function leerTodos<T>(body: unknown, lectores: Lectores<T>): T {
  const campos = Object.keys(lectores) as (keyof T & string)[];
  const cuerpo = pick(body, campos);
  return Object.fromEntries(
    campos.map((campo) => [campo, lectores[campo](cuerpo[campo])]),
  ) as T;
}

/**
 * Lee solo los campos que vinieron en un PATCH. Mandar `null` en un opcional
 * lo borra.
 * @param body `req.body`
 * @param lectores un lector por campo permitido
 * @returns los cambios validados
 * @throws DatoInvalido si no vino ningún campo permitido
 */
export function leerPresentes<T>(body: unknown, lectores: Lectores<T>): Partial<T> {
  const campos = Object.keys(lectores) as (keyof T & string)[];
  const cuerpo = pick(body, campos);
  const presentes = campos.filter((campo) => campo in cuerpo);
  if (presentes.length === 0) throw new DatoInvalido(MENSAJE_SIN_CAMBIOS);
  return Object.fromEntries(
    presentes.map((campo) => [campo, lectores[campo](cuerpo[campo])]),
  ) as Partial<T>;
}

/** Mensaje de formato de una fecha sin hora. */
const FORMATO_SOLO_FECHA = 'Usá el formato AAAA-MM-DD con una fecha real.';

/**
 * Lee una fecha sin hora (AAAA-MM-DD).
 * @param valor lo que llegó
 * @param campo nombre del campo
 * @returns la fecha a medianoche UTC
 * @throws DatoInvalido si no tiene el formato o el día no existe
 */
export function leerSoloFecha(valor: unknown, campo: string): Date {
  const fecha = typeof valor === 'string' ? parsearSoloFecha(valor) : null;
  if (!fecha) throw new DatoInvalido(conCampo(campo, FORMATO_SOLO_FECHA));
  return fecha;
}

/**
 * Lee un teléfono (obligatorio) y lo deja en E.164, celular salvo que se
 * marque como fijo. Lo usan el registro y el PATCH del perfil, así las dos
 * rutas aceptan y guardan los números igual.
 * @param valor lo que llegó
 * @param fijo true si vino `telefonoFijo: true` en el mismo body
 * @returns el teléfono en E.164 ("+5491145892310")
 * @throws DatoInvalido si falta o no es un número válido
 */
export function leerTelefono(valor: unknown, fijo = false): string {
  const texto = leerTexto(valor, 'Teléfono', validarTelefono);
  return aE164(texto, fijo) ?? texto;
}

/**
 * Lee `telefonoFijo` ("Es un teléfono fijo"): opcional, false si no viene.
 * @param body `req.body`
 * @returns true si el teléfono que vino se guarda como fijo
 * @throws DatoInvalido si viene y no es booleano
 */
export function leerTelefonoFijo(body: unknown): boolean {
  const { telefonoFijo } = pick(body, ['telefonoFijo']);
  if (telefonoFijo === undefined || telefonoFijo === null) return false;
  if (typeof telefonoFijo !== 'boolean') throw new DatoInvalido('Teléfono fijo: tiene que ser true o false.');
  return telefonoFijo;
}
