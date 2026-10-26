/**
 * Valores válidos de los campos fijos del modelo.
 *
 * En el schema estos campos son String (SQLite no hace cumplir enums), así que
 * Express los valida contra estas listas antes de guardar. Son los mismos
 * valores que los tipos de doggy/mobile/src/types/models.ts: si cambia uno,
 * cambia en los dos repos.
 */

/** Tipos de registro del carnet sanitario (`RegistroSanitario.tipo`). */
export const TIPOS_REGISTRO = ['vacuna', 'desparasitacion', 'otro'] as const;
export type TipoRegistro = (typeof TIPOS_REGISTRO)[number];

/** Categorías de turno (`Turno.categoria`). */
export const CATEGORIAS_TURNO = ['vacunas', 'veterinario', 'peluqueria'] as const;
export type CategoriaTurno = (typeof CATEGORIAS_TURNO)[number];

/** Estados de un reporte (`ReportePerdida.estado`). */
export const ESTADOS_REPORTE = ['perdido', 'encontrado'] as const;
export type EstadoReporte = (typeof ESTADOS_REPORTE)[number];

/**
 * Roles sobre una mascota (`Cuidador.rol`, `Invitacion.rol`).
 * - dueno: puede generar códigos de asignación.
 * - invitado: tiene la mascota en su cuenta pero no puede asignar a nadie.
 */
export const ROLES_MASCOTA = ['dueno', 'invitado'] as const;
export type RolMascota = (typeof ROLES_MASCOTA)[number];

/** Tipos de vínculo de un cuidador, para el ícono (`Cuidador.tipo`). */
export const TIPOS_CUIDADOR = ['familia', 'clinica', 'paseador'] as const;
export type TipoCuidador = (typeof TIPOS_CUIDADOR)[number];

/** Radios de búsqueda que ofrece la app, en metros (`RADIOS_BUSQUEDA` de doggy/mobile/src/utils/mapa.ts). */
export const RADIOS_BUSQUEDA = [200, 500, 1000, 2000] as const;

/** Etiquetas que puede tener un reporte como máximo (`MAXIMO` de EtiquetasInput en la app). */
export const MAXIMO_ETIQUETAS = 5;

/**
 * Claves de las fotos que vienen empaquetadas en la app para los datos de
 * ejemplo (`FOTOS_LOCALES` de doggy/mobile/src/data/fotos.ts).
 */
export const CLAVES_FOTO_SEED = [
  'luna',
  'roco',
  'milo',
  'toby',
  'pipa',
  'simba',
  'sin-collar',
  'nieve',
  'caniche',
  'rocky',
  'labrador',
  'salchicha',
  'sofia',
  'carlos',
  'martin',
  'valentina',
  'julian',
  'marcos',
  'sol',
  'lucia',
  'vet-san-roque',
] as const;

/**
 * Indica si un valor recibido pertenece a una de las listas de arriba.
 * @param lista valores válidos, por ejemplo `ESTADOS_REPORTE`
 * @param valor lo que llegó en el body (de tipo desconocido)
 * @returns true si es uno de los valores de la lista
 */
export function esValorDe<T extends string>(lista: readonly T[], valor: unknown): valor is T {
  return typeof valor === 'string' && (lista as readonly string[]).includes(valor);
}
