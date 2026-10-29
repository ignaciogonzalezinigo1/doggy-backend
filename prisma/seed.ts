/**
 * Datos de ejemplo para la base local: la demo mínima para presentar la app.
 *
 * Corre con `npm run db:seed` (y al final de `npm run db:reset`). Borra todo
 * antes de cargar, así se puede correr más de una vez. Al terminar imprime un
 * resumen con cada usuario de la demo y qué conviene mostrar con él.
 *
 * Tiene dos capas:
 *
 * Base (la usan las pruebas, `npm test`): tres usuarios.
 * - Sofía (1), la usuaria principal: dueña de Luna, Roco y Milo, con carnet,
 *   turnos y fotos. Es la dueña en el flujo de perdidos.
 * - Lucía (20): dueña de Toby. Generó el código TOBY2026 para que Sofía lo
 *   acepte como invitada (roles dueño e invitado). En la demo en vivo escanea
 *   el QR de Luna.
 * - Julián (4), un vecino: dueño de Pipa, perdida (así el mapa no arranca
 *   vacío), paseador de Roco (invitado: Familia y Cuidadores con otra persona
 *   y "Quitar") y ya escaneó el QR de Milo sin que estuviera perdido (Sofía ve
 *   "¿Se perdió Milo?").
 *
 * Demo completa (se suma salvo que `SEED_SOLO_BASE=1`, que pone `npm test`):
 * cada funcionalidad queda lista para mostrar con solo iniciar sesión.
 * - Diego (2), co-dueño de Luna (una dueña no quita a otro dueño) y dueño de
 *   Coco, donde Sofía es invitada ("Dejar de cuidar a…", sin "Asignar"; y
 *   "Eliminar mascota" lista a Sofía entre quienes pierden el acceso).
 * - Martina (5), dueña de Bruno: perdido y ya encontrado por Valentina, así
 *   el reencuentro (pin verde, "¡Encontraron a Bruno!", "Ya volvió a casa")
 *   se ve sin escanear nada.
 * - Valentina (6), sin mascotas: encontró a Bruno (WhatsApp a Martina) y
 *   muestra los estados vacíos.
 * - Tomás (7), cuenta vacía para aceptar el código LUNA2026 (rol dueño).
 * - Códigos: LUNA2026 (dueño, sin usar; Sofía recibe 409 porque ya es
 *   dueña) y MILO2025 (ya usado: 410).
 *
 * - Teléfonos en E.164, celulares. El de Sofía sale de `TELEFONO_DEMO_SOFIA`
 *   del `.env` (5491…, sin + ni espacios), para mostrar WhatsApp con un número
 *   real sin escribirlo en el repo; si está vacía, va uno inventado.
 * - Las fotos están versionadas en prisma/fotos-seed/ (créditos en
 *   CREDITOS.md). Antes de cargar los datos, el seed las copia a la carpeta de
 *   uploads como `seed-<clave>.jpg`, pisando la copia anterior, y guarda la
 *   ruta "/uploads/seed-<clave>.jpg": la app las pide al servidor como
 *   cualquier foto subida. El nombre es fijo para que los `db:reset` no
 *   acumulen copias y para recrear la que `borrarFotoSiHuerfana` haya borrado.
 * - Las fechas se calculan desde hoy, así nunca quedan viejas: los reportes
 *   dicen "hace 2 h", la Agenda tiene turnos pasados y próximos, y el carnet
 *   tiene refuerzos próximos y vencidos. Las fechas de nacimiento son fijas.
 *
 * Las pruebas (`npm test`) parten de estos datos y suman por su cuenta los
 * actores que necesitan (co-dueños, invitados, una clínica y otro
 * reencuentro): ver "Actores extra" en scripts/probar.sh.
 */

import bcrypt from 'bcryptjs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARPETA_UPLOADS, PREFIJO_UPLOADS } from '../src/lib/fotos';
import { prisma } from '../src/lib/prisma';
import { interpretarTelefono } from '../src/lib/telefonos';

/** Contraseña de todos los usuarios de prueba. */
const PASSWORD_DEMO = 'doggy1234';
/** Costo del hash de bcrypt. */
const RONDAS_BCRYPT = 10;

const HORA_MS = 60 * 60 * 1000;
/** Diferencia de Argentina con UTC (no tiene horario de verano). */
const DESFASE_ARGENTINA_MS = -3 * HORA_MS;

/** Usuaria principal de la demo: dueña de Luna, Roco y Milo. */
const SOFIA_ID = 1;
/** Vecino: dueño de Pipa (perdida), paseador de Roco y encontró a Milo. */
const JULIAN_ID = 4;
/** Dueña de Toby: generó el código de asignación TOBY2026 para Sofía. */
const LUCIA_ID = 20;
/** Demo completa: co-dueño de Luna y dueño de Coco (Sofía es invitada). */
const DIEGO_ID = 2;
/** Demo completa: dueña de Bruno (perdido y ya encontrado). */
const MARTINA_ID = 5;
/** Demo completa: sin mascotas, encontró a Bruno. */
const VALENTINA_ID = 6;
/** Demo completa: cuenta vacía que acepta el código LUNA2026. */
const TOMAS_ID = 7;

/**
 * Si es `1`, el seed carga solo la base (tres usuarios). Lo pone `npm test`,
 * porque las pruebas cuentan filas exactas del seed base.
 */
const SOLO_BASE = process.env.SEED_SOLO_BASE === '1';

/** Carpeta versionada con las fotos de la demo (prisma/fotos-seed/). */
const CARPETA_FOTOS_SEED = fileURLToPath(new URL('fotos-seed/', import.meta.url));

/** Fotos de la demo: cada clave es un archivo `<clave>.jpg` de prisma/fotos-seed/. */
const FOTOS_SEED = ['luna', 'roco', 'milo', 'toby', 'pipa', 'sofia', 'julian', 'lucia'] as const;
type ClaveFotoSeed = (typeof FOTOS_SEED)[number];

/**
 * Nombre con el que queda una foto de la demo en la carpeta de uploads.
 * @param clave foto de la demo
 * @returns "seed-<clave>.jpg"
 */
function nombreFotoSeed(clave: ClaveFotoSeed): string {
  return `seed-${clave}.jpg`;
}

/**
 * Ruta que se guarda en la base para una foto de la demo.
 * @param clave foto de la demo
 * @returns "/uploads/seed-<clave>.jpg"
 */
function fotoSeed(clave: ClaveFotoSeed): string {
  return `${PREFIJO_UPLOADS}${nombreFotoSeed(clave)}`;
}

/**
 * Copia las fotos de la demo a la carpeta de uploads (la de `UPLOADS_DIR`,
 * si está definida, como en `npm test`). Pisa las copias anteriores, así
 * correr el seed muchas veces deja siempre los mismos archivos y vuelve a
 * crear los que se hayan borrado al reemplazar una foto.
 * @returns una promesa que termina cuando están todas copiadas
 */
async function copiarFotosSeed(): Promise<void> {
  await mkdir(CARPETA_UPLOADS, { recursive: true });
  await Promise.all(
    FOTOS_SEED.map((clave) =>
      copyFile(path.join(CARPETA_FOTOS_SEED, `${clave}.jpg`), path.join(CARPETA_UPLOADS, nombreFotoSeed(clave))),
    ),
  );
}

/** Celular inventado de Sofía, si `TELEFONO_DEMO_SOFIA` está vacía. */
const TELEFONO_SOFIA_INVENTADO = '+5491160685371';

/**
 * Teléfono de Sofía: el de `TELEFONO_DEMO_SOFIA` del `.env` (5491…, sin + ni
 * espacios) o, si está vacía, uno inventado. Así la demo puede abrir WhatsApp
 * a un celular real sin que el número quede escrito en el repo.
 * @returns el teléfono en E.164
 * @throws si la variable tiene algo que no es un celular argentino válido
 */
function telefonoSofia(): string {
  const valor = process.env.TELEFONO_DEMO_SOFIA?.trim() ?? '';
  if (valor === '') return TELEFONO_SOFIA_INVENTADO;
  const lectura = interpretarTelefono(valor);
  if (!lectura.ok) throw new Error(`TELEFONO_DEMO_SOFIA no es válido: ${lectura.error}`);
  return lectura.e164;
}

/**
 * Fecha de hace una cantidad de horas (para que los reportes digan "hace 2 h").
 * @param horas horas hacia atrás desde ahora
 * @returns la fecha
 */
function haceHoras(horas: number): Date {
  return new Date(Date.now() - horas * HORA_MS);
}

/**
 * Fecha de hoy en Argentina, corrida una cantidad de días, como `Date` cuyo
 * día UTC es ese día de Argentina.
 * @param dias días desde hoy (negativo para el pasado)
 * @returns la fecha corrida al desfase
 */
function diaArgentina(dias: number): Date {
  const hoyEnArgentina = new Date(Date.now() + DESFASE_ARGENTINA_MS);
  return new Date(
    Date.UTC(hoyEnArgentina.getUTCFullYear(), hoyEnArgentina.getUTCMonth(), hoyEnArgentina.getUTCDate() + dias),
  );
}

/**
 * Fecha a cierta hora de Argentina, una cantidad de días desde hoy (turnos).
 * @param dias días desde hoy (negativo para el pasado)
 * @param horas hora en Argentina (0 a 23)
 * @param minutos minutos
 * @returns la fecha y hora
 */
function enDias(dias: number, horas: number, minutos = 0): Date {
  const base = diaArgentina(dias);
  return new Date(base.getTime() + (horas * 60 + minutos) * 60 * 1000 - DESFASE_ARGENTINA_MS);
}

/**
 * Fecha sin hora (medianoche UTC), una cantidad de días desde hoy en Argentina
 * (fechas del carnet: aplicación y refuerzo).
 * @param dias días desde hoy (negativo para el pasado)
 * @returns la fecha a medianoche UTC
 */
function desdeHoy(dias: number): Date {
  return diaArgentina(dias);
}

/**
 * Fecha sin hora (AAAA-MM-DD) guardada a medianoche UTC.
 * @param fecha fecha en formato AAAA-MM-DD
 * @returns la fecha a medianoche UTC
 */
function dia(fecha: string): Date {
  return new Date(`${fecha}T00:00:00.000Z`);
}

/** Usuarios de la demo, sin la contraseña. Todos tienen foto. */
const usuarios = [
  {
    id: SOFIA_ID,
    nombre: 'Sofía',
    apellido: 'Romero',
    email: 'sofia.romero@mail.com',
    ubicacion: 'Gurruchaga 1450, Palermo',
    foto: fotoSeed('sofia'),
    telefonoEmergencia: telefonoSofia(),
  },
  {
    id: JULIAN_ID,
    nombre: 'Julián',
    apellido: 'Fernández',
    email: 'julian.fernandez@mail.com',
    ubicacion: 'Díaz Vélez 4300, Almagro',
    foto: fotoSeed('julian'),
    telefonoEmergencia: '+5491157698999',
  },
  {
    id: LUCIA_ID,
    nombre: 'Lucía',
    apellido: 'Gómez',
    email: 'lucia.gomez@mail.com',
    ubicacion: 'Rojas 120, Caballito',
    foto: fotoSeed('lucia'),
    telefonoEmergencia: '+5491163229096',
  },
];

/** Mascotas, cada una con una foto de su raza. */
const mascotas = [
  {
    id: 1,
    tutorId: SOFIA_ID,
    nombre: 'Luna',
    raza: 'Golden Retriever',
    fechaNacimiento: dia('2023-03-14'),
    codigo: 'DOGGY-8492-LUNA',
    senas: 'Pelo dorado claro y orejas más oscuras. Collar rojo con chapita.',
    foto: fotoSeed('luna'),
  },
  {
    id: 2,
    tutorId: SOFIA_ID,
    nombre: 'Roco',
    raza: 'Bulldog Francés',
    fechaNacimiento: dia('2025-04-02'),
    codigo: 'DOGGY-3127-ROCO',
    senas: 'Blanco con manchas negras en la cara y las orejas paradas.',
    foto: fotoSeed('roco'),
  },
  {
    id: 3,
    tutorId: SOFIA_ID,
    nombre: 'Milo',
    raza: 'Mestizo',
    fechaNacimiento: dia('2021-06-20'),
    codigo: 'DOGGY-5610-MILO',
    senas: 'Marrón con el pecho y las patas blancas. Orejas caídas.',
    foto: fotoSeed('milo'),
  },
  // Mascota de otra usuaria (Lucía): Sofía no la ve hasta aceptar el código de asignación.
  {
    id: 4,
    tutorId: LUCIA_ID,
    nombre: 'Toby',
    raza: 'Beagle',
    fechaNacimiento: dia('2022-01-08'),
    codigo: 'DOGGY-7741-TOBY',
    senas: 'Tricolor, con la punta de la cola blanca.',
    foto: fotoSeed('toby'),
  },
  // De Julián, perdida sin encontrar: así el mapa no arranca vacío.
  {
    id: 5,
    tutorId: JULIAN_ID,
    nombre: 'Pipa',
    raza: 'Border Collie',
    fechaNacimiento: dia('2020-09-05'),
    codigo: 'DOGGY-2468-PIPA',
    senas: 'Negra y blanca, con la cara partida en dos colores. Collar azul con chapita.',
    foto: fotoSeed('pipa'),
  },
];

/**
 * Carnet sanitario. Luna tiene de todo (refuerzos próximos y vencidos, un
 * análisis); Roco, una vacuna y una consulta (la card de próximo refuerzo,
 * que también se desliza para borrar); Milo, la castración y refuerzos
 * vencidos. Toby y Pipa tienen una vacuna cada uno (los ve su familia).
 */
const registros = [
  // Luna
  { id: 1, mascotaId: 1, tipo: 'vacuna', nombre: 'Antirrábica', fecha: desdeHoy(-340), profesional: 'Vet. San Roque', proximaDosis: desdeHoy(25) },
  { id: 2, mascotaId: 1, tipo: 'vacuna', nombre: 'Séxtuple', fecha: desdeHoy(-400), profesional: 'Dra. Martínez', proximaDosis: desdeHoy(-35) },
  { id: 3, mascotaId: 1, tipo: 'vacuna', nombre: 'Tos de las perreras', fecha: desdeHoy(-200), profesional: 'Clínica Veterinaria Sur' },
  { id: 4, mascotaId: 1, tipo: 'desparasitacion', nombre: 'Antiparasitario interno', fecha: desdeHoy(-60), profesional: 'Dra. Martínez', proximaDosis: desdeHoy(30) },
  { id: 5, mascotaId: 1, tipo: 'desparasitacion', nombre: 'Pipeta antipulgas', fecha: desdeHoy(-45), profesional: 'Vet. San Roque', proximaDosis: desdeHoy(-15) },
  { id: 6, mascotaId: 1, tipo: 'otro', nombre: 'Análisis de sangre', fecha: desdeHoy(-90), profesional: 'Vet. San Roque' },
  // Roco
  { id: 7, mascotaId: 2, tipo: 'vacuna', nombre: 'Séxtuple (dosis 1)', fecha: desdeHoy(-38), profesional: 'Clínica Belgrano Pet', proximaDosis: desdeHoy(3) },
  { id: 8, mascotaId: 2, tipo: 'otro', nombre: 'Consulta por tos', fecha: desdeHoy(-20), profesional: 'Clínica Belgrano Pet' },
  // Milo
  { id: 9, mascotaId: 3, tipo: 'vacuna', nombre: 'Antirrábica', fecha: desdeHoy(-380), profesional: 'Vet. San Roque', proximaDosis: desdeHoy(-15) },
  { id: 10, mascotaId: 3, tipo: 'otro', nombre: 'Castración', fecha: desdeHoy(-700), profesional: 'Vet. San Roque' },
  { id: 11, mascotaId: 3, tipo: 'desparasitacion', nombre: 'Antiparasitario interno', fecha: desdeHoy(-100), profesional: 'Vet. San Roque', proximaDosis: desdeHoy(-10) },
  // Toby y Pipa (de otras familias)
  { id: 12, mascotaId: 4, tipo: 'vacuna', nombre: 'Antirrábica', fecha: desdeHoy(-200), profesional: 'Veterinaria Caballito', proximaDosis: desdeHoy(165) },
  { id: 13, mascotaId: 5, tipo: 'vacuna', nombre: 'Séxtuple', fecha: desdeHoy(-150), profesional: 'Veterinaria Almagro', proximaDosis: desdeHoy(215) },
];

/** Turnos: pasados y próximos, a horas de Argentina. */
const turnos = [
  { id: 1, mascotaId: 3, categoria: 'peluqueria', fecha: enDias(-10, 15), motivo: 'Baño y corte de pelo', lugar: 'Peluquería Canina Patitas, Palermo' },
  { id: 2, mascotaId: 1, categoria: 'veterinario', fecha: enDias(3, 10, 30), motivo: 'Chequeo general anual', lugar: 'Vet. San Roque, Palermo' },
  { id: 3, mascotaId: 2, categoria: 'vacunas', fecha: enDias(3, 17), motivo: 'Séxtuple (dosis 2)', lugar: 'Clínica Belgrano Pet' },
  { id: 4, mascotaId: 1, categoria: 'peluqueria', fecha: enDias(10, 11), motivo: 'Baño y deslanado', lugar: 'Peluquería Canina Patitas, Palermo' },
  { id: 5, mascotaId: 3, categoria: 'veterinario', fecha: enDias(-30, 9, 30), motivo: 'Control anual', lugar: 'Vet. San Roque, Palermo' },
  { id: 6, mascotaId: 4, categoria: 'veterinario', fecha: enDias(7, 18), motivo: 'Control de oídos', lugar: 'Veterinaria Caballito' },
];

/**
 * Reportes con sus etiquetas: el perdido de Pipa (el mapa no arranca vacío)
 * y el encontrado de Milo (el caso "¿Se perdió…?"). Llevan los datos de la
 * mascota (nombre, raza, foto y señas); el encontrado lo publicó quien
 * escaneó la chapita, con su comentario en `infoAdicional`. El reencuentro se
 * muestra en vivo: Sofía reporta a Luna y Lucía escanea su QR.
 */
const reportes = [
  // Perdida en Parque Centenario hace 5 horas: el pin mostaza del mapa.
  {
    id: 1,
    mascotaId: 5,
    autorId: JULIAN_ID,
    estado: 'perdido',
    nombre: 'Pipa',
    raza: 'Border Collie',
    descripcion: 'Negra y blanca, con la cara partida en dos colores. Collar azul con chapita.',
    foto: fotoSeed('pipa'),
    etiquetas: ['Collar azul'],
    lat: -34.6067,
    lng: -58.4352,
    zona: 'Caballito, CABA',
    fecha: haceHoras(5),
    radioMetros: 1000,
    infoAdicional: 'Se soltó de la correa en Parque Centenario. Es tímida: mejor no correrla.',
  },
  // Julián escaneó la chapita de Milo, que no estaba perdido: Sofía ve "¿Se perdió Milo?" con su WhatsApp.
  {
    id: 2,
    mascotaId: 3,
    autorId: JULIAN_ID,
    estado: 'encontrado',
    nombre: 'Milo',
    raza: 'Mestizo',
    descripcion: 'Marrón con el pecho y las patas blancas. Orejas caídas.',
    foto: fotoSeed('milo'),
    etiquetas: [],
    lat: -34.5994,
    lng: -58.4397,
    zona: 'Villa Crespo, CABA',
    fecha: haceHoras(1),
    infoAdicional: 'Andaba solo por Corrientes y Scalabrini Ortiz, con la chapita. Lo tengo en casa.',
  },
];

/** Asignaciones de personas a mascotas. El nombre y la foto salen del usuario. */
const cuidadores = [
  { id: 1, mascotaId: 1, usuarioId: SOFIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  { id: 2, mascotaId: 2, usuarioId: SOFIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  // Julián pasea a Roco: Familia y Cuidadores con otra persona, y "Quitar" para Sofía.
  {
    id: 3,
    mascotaId: 2,
    usuarioId: JULIAN_ID,
    rol: 'invitado',
    detalle: 'Paseos de lunes a viernes (10-12 hs)',
    tipo: 'paseador',
  },
  { id: 4, mascotaId: 3, usuarioId: SOFIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  { id: 5, mascotaId: 4, usuarioId: LUCIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  { id: 6, mascotaId: 5, usuarioId: JULIAN_ID, rol: 'dueno', detalle: 'Tutor', tipo: 'familia' },
];

/**
 * Código de Toby que creó Lucía para que Sofía lo acepte desde Perfil →
 * "Tengo un código de asignación".
 */
const invitaciones = [
  {
    token: 'TOBY2026',
    mascotaId: 4,
    rol: 'invitado',
    creadaPorId: LUCIA_ID,
    usada: false,
  },
];


// --- Demo completa (no se carga con SEED_SOLO_BASE=1) ---

/** Usuarios extra. Sin foto: la app muestra la inicial (se puede cargar una en vivo). */
const usuariosExtra = [
  {
    id: DIEGO_ID,
    nombre: 'Diego',
    apellido: 'Romero',
    email: 'diego.romero@mail.com',
    ubicacion: 'Gurruchaga 1450, Palermo',
    foto: null,
    telefonoEmergencia: '+5491158312044',
  },
  {
    id: MARTINA_ID,
    nombre: 'Martina',
    apellido: 'Sosa',
    email: 'martina.sosa@mail.com',
    ubicacion: 'Juramento 2100, Belgrano',
    foto: null,
    telefonoEmergencia: '+5491164417720',
  },
  {
    id: VALENTINA_ID,
    nombre: 'Valentina',
    apellido: 'Ruiz',
    email: 'valentina.ruiz@mail.com',
    ubicacion: 'Cabildo 3200, Núñez',
    foto: null,
    telefonoEmergencia: '+5491139905512',
  },
  {
    id: TOMAS_ID,
    nombre: 'Tomás',
    apellido: 'Acosta',
    email: 'tomas.acosta@mail.com',
    ubicacion: 'Thames 900, Villa Crespo',
    foto: null,
    telefonoEmergencia: '+5491147206631',
  },
];

/** Mascotas extra (sin foto: la app muestra la huella). */
const mascotasExtra = [
  {
    id: 6,
    tutorId: MARTINA_ID,
    nombre: 'Bruno',
    raza: 'Labrador',
    fechaNacimiento: dia('2022-07-30'),
    codigo: 'DOGGY-6315-BRUNO',
    senas: 'Labrador chocolate, con una mancha blanca en el pecho. Collar verde.',
    foto: null,
  },
  {
    id: 7,
    tutorId: DIEGO_ID,
    nombre: 'Coco',
    raza: 'Caniche',
    fechaNacimiento: dia('2024-02-11'),
    codigo: 'DOGGY-9054-COCO',
    senas: 'Blanco, pelo enrulado y corte de verano.',
    foto: null,
  },
];

const registrosExtra = [
  { id: 14, mascotaId: 6, tipo: 'vacuna', nombre: 'Antirrábica', fecha: desdeHoy(-120), profesional: 'Veterinaria Belgrano', proximaDosis: desdeHoy(245) },
  { id: 15, mascotaId: 7, tipo: 'vacuna', nombre: 'Séxtuple', fecha: desdeHoy(-300), profesional: 'Vet. San Roque', proximaDosis: desdeHoy(65) },
];

/** Turno de Coco: Sofía lo ve en su Agenda porque es invitada. */
const turnosExtra = [
  { id: 7, mascotaId: 7, categoria: 'peluqueria', fecha: enDias(5, 16), motivo: 'Corte de verano', lugar: 'Peluquería Canina Patitas, Palermo' },
];

/**
 * Reencuentro ya armado: Bruno perdido (Martina) y encontrado por Valentina
 * escaneando su chapita. En el mapa es un solo pin verde.
 */
const reportesExtra = [
  {
    id: 3,
    mascotaId: 6,
    autorId: MARTINA_ID,
    estado: 'perdido',
    nombre: 'Bruno',
    raza: 'Labrador',
    descripcion: 'Labrador chocolate, con una mancha blanca en el pecho. Collar verde.',
    foto: null,
    etiquetas: ['Collar verde'],
    lat: -34.5617,
    lng: -58.4563,
    zona: 'Belgrano, CABA',
    fecha: haceHoras(26),
    radioMetros: 500,
    infoAdicional: 'Se escapó por el portón. Responde a su nombre y es muy amigable.',
  },
  {
    id: 4,
    mascotaId: 6,
    autorId: VALENTINA_ID,
    estado: 'encontrado',
    nombre: 'Bruno',
    raza: 'Labrador',
    descripcion: 'Labrador chocolate, con una mancha blanca en el pecho. Collar verde.',
    foto: null,
    etiquetas: [],
    lat: -34.5486,
    lng: -58.4631,
    zona: 'Núñez, CABA',
    fecha: haceHoras(2),
    infoAdicional: 'Estaba en la plaza de Cabildo y Congreso. Lo tengo en casa, está bien.',
  },
];

const cuidadoresExtra = [
  // Diego co-dueño de Luna: Sofía no ve "Quitar" en su fila (un dueño no quita a otro).
  { id: 7, mascotaId: 1, usuarioId: DIEGO_ID, rol: 'dueno', detalle: 'Co-tutor', tipo: 'familia' },
  { id: 8, mascotaId: 6, usuarioId: MARTINA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  { id: 9, mascotaId: 7, usuarioId: DIEGO_ID, rol: 'dueno', detalle: 'Tutor', tipo: 'familia' },
  // Sofía invitada de Coco: "Dejar de cuidar a Coco" y sin "+ Asignar a…".
  { id: 10, mascotaId: 7, usuarioId: SOFIA_ID, rol: 'invitado', detalle: 'Lo cuida los fines de semana', tipo: 'familia' },
];

const invitacionesExtra = [
  // Rol dueño, sin usar: Tomás la acepta; Sofía recibe 409 (ya es dueña de Luna).
  { token: 'LUNA2026', mascotaId: 1, rol: 'dueno', creadaPorId: SOFIA_ID, usada: false },
  // Ya usado: 410 "ya se usó".
  { token: 'MILO2025', mascotaId: 3, rol: 'invitado', creadaPorId: SOFIA_ID, usada: true },
];

/** Datos que se cargan: la base y, salvo `SEED_SOLO_BASE=1`, la demo completa. */
const datos = {
  usuarios: SOLO_BASE ? usuarios : [...usuarios, ...usuariosExtra],
  mascotas: SOLO_BASE ? mascotas : [...mascotas, ...mascotasExtra],
  registros: SOLO_BASE ? registros : [...registros, ...registrosExtra],
  turnos: SOLO_BASE ? turnos : [...turnos, ...turnosExtra],
  reportes: SOLO_BASE ? reportes : [...reportes, ...reportesExtra],
  cuidadores: SOLO_BASE ? cuidadores : [...cuidadores, ...cuidadoresExtra],
  invitaciones: SOLO_BASE ? invitaciones : [...invitaciones, ...invitacionesExtra],
};

/** Qué mostrar con cada usuario en la demo (se imprime al final del seed). */
const GUIA_DEMO: { email: string; quien: string; mostrar: string }[] = [
  {
    email: 'sofia.romero@mail.com',
    quien: 'Sofía, dueña de Luna, Roco y Milo',
    mostrar: '"Alguien encontró a Milo. ¿Se perdió Milo?" con WhatsApp a Julián; carnet de Luna (refuerzos próximos y vencidos); Agenda; Familia y Cuidadores (Julián pasea a Roco); código TOBY2026. En vivo: reportar a Luna como perdida.',
  },
  {
    email: 'lucia.gomez@mail.com',
    quien: 'Lucía, dueña de Toby',
    mostrar: 'En vivo: "Encontré una mascota" → escanear el QR de Luna → reencuentro y WhatsApp a Sofía. Generó el código TOBY2026.',
  },
  {
    email: 'julian.fernandez@mail.com',
    quien: 'Julián, vecino: dueño de Pipa (perdida) y paseador de Roco',
    mostrar: 'Pipa en el mapa; su encontrado de Milo con WhatsApp a Sofía.',
  },
];

/** Guía de los usuarios de la demo completa. */
const GUIA_EXTRA: { email: string; quien: string; mostrar: string }[] = [
  {
    email: 'diego.romero@mail.com',
    quien: 'Diego, co-dueño de Luna y dueño de Coco (Sofía es invitada)',
    mostrar: 'Quitar a Sofía de Coco; "Eliminar mascota" con Coco (lista a Sofía).',
  },
  {
    email: 'martina.sosa@mail.com',
    quien: 'Martina, dueña de Bruno (perdido y ya encontrado)',
    mostrar: '"¡Encontraron a Bruno!" con WhatsApp a Valentina y "Ya volvió a casa".',
  },
  {
    email: 'valentina.ruiz@mail.com',
    quien: 'Valentina, sin mascotas, encontró a Bruno',
    mostrar: 'Pin verde de reencuentro con WhatsApp a Martina; estados vacíos.',
  },
  {
    email: 'tomas.acosta@mail.com',
    quien: 'Tomás, cuenta vacía',
    mostrar: 'Aceptar el código LUNA2026 (queda como dueño de Luna). MILO2025 ya está usado (410).',
  },
];

/** Imprime el resumen para la demo. */
function imprimirResumen(): void {
  const { usuarios, mascotas, registros, turnos, reportes } = datos;
  const perdidos = reportes.filter((r) => r.estado === 'perdido').length;
  console.log(
    `Seed listo${SOLO_BASE ? ' (solo base)' : ' (demo completa)'}: ${usuarios.length} usuarios, ${mascotas.length} mascotas, ` +
      `${registros.length} registros, ${turnos.length} turnos y ${reportes.length} reportes ` +
      `(${perdidos} perdidos, ${reportes.length - perdidos} encontrados).`,
  );
  console.log(`Contraseña de todos: ${PASSWORD_DEMO}\n`);
  console.log('Usuarios para la demo:');
  for (const { email, quien, mostrar } of SOLO_BASE ? GUIA_DEMO : [...GUIA_DEMO, ...GUIA_EXTRA]) {
    console.log(`- ${email}\n  ${quien}\n  ${mostrar}`);
  }
}

/**
 * Copia las fotos de la demo, borra todos los datos y carga los de ejemplo,
 * en una sola transacción.
 * @returns una promesa que termina cuando se cargó todo
 */
async function sembrar(): Promise<void> {
  // Antes que los datos: las filas apuntan a estos archivos.
  await copiarFotosSeed();

  // Cada usuario con su propio salt, como quedaría al registrarse.
  const usuariosConPassword = await Promise.all(
    datos.usuarios.map(async (usuario) => ({
      ...usuario,
      passwordHash: await bcrypt.hash(PASSWORD_DEMO, RONDAS_BCRYPT),
    })),
  );

  await prisma.$transaction(async (tx) => {
    // Primero las tablas que dependen de otras.
    await tx.sesion.deleteMany();
    await tx.etiqueta.deleteMany();
    await tx.reportePerdida.deleteMany();
    await tx.invitacion.deleteMany();
    await tx.cuidador.deleteMany();
    await tx.turno.deleteMany();
    await tx.registroSanitario.deleteMany();
    await tx.mascota.deleteMany();
    await tx.usuario.deleteMany();

    await tx.usuario.createMany({ data: usuariosConPassword });
    await tx.mascota.createMany({ data: datos.mascotas });
    await tx.registroSanitario.createMany({ data: datos.registros });
    await tx.turno.createMany({ data: datos.turnos });
    await tx.cuidador.createMany({ data: datos.cuidadores });
    await tx.invitacion.createMany({ data: datos.invitaciones });

    for (const { etiquetas, ...reporte } of datos.reportes) {
      await tx.reportePerdida.create({
        data: { ...reporte, etiquetas: { create: etiquetas.map((texto) => ({ texto })) } },
      });
    }
  });

  imprimirResumen();
}

sembrar()
  .catch((error: unknown) => {
    console.error('Falló el seed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
