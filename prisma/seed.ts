/**
 * Datos de ejemplo para la base local: la demo mínima para presentar la app.
 *
 * Corre con `npm run db:seed` (y al final de `npm run db:reset`). Borra todo
 * antes de cargar, así se puede correr más de una vez. Al terminar imprime un
 * resumen con cada usuario de la demo y qué conviene mostrar con él.
 *
 * Son tres usuarios, los justos para recorrer toda la app:
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
 * - Teléfonos en E.164, celulares. El de Sofía sale de `TELEFONO_DEMO_SOFIA`
 *   del `.env` (5491…, sin + ni espacios), para mostrar WhatsApp con un número
 *   real sin escribirlo en el repo; si está vacía, va uno inventado.
 * - Las fotos son claves de imágenes que vienen en la app
 *   (doggy/mobile/assets/images, ver `FOTOS_LOCALES` en src/data/fotos.ts y
 *   los créditos en doggy/CREDITOS.md).
 * - Las fechas se calculan desde hoy, así nunca quedan viejas: los reportes
 *   dicen "hace 2 h", la Agenda tiene turnos pasados y próximos, y el carnet
 *   tiene refuerzos próximos y vencidos. Las fechas de nacimiento son fijas.
 *
 * Las pruebas (`npm test`) parten de estos datos y suman por su cuenta los
 * actores que necesitan (co-dueños, invitados, una clínica con fijo y otro
 * reencuentro): ver "Actores extra" en scripts/probar.sh.
 */

import bcrypt from 'bcryptjs';
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
    foto: 'sofia',
    telefonoEmergencia: telefonoSofia(),
  },
  {
    id: JULIAN_ID,
    nombre: 'Julián',
    apellido: 'Fernández',
    email: 'julian.fernandez@mail.com',
    ubicacion: 'Díaz Vélez 4300, Almagro',
    foto: 'julian',
    telefonoEmergencia: '+5491157698999',
  },
  {
    id: LUCIA_ID,
    nombre: 'Lucía',
    apellido: 'Gómez',
    email: 'lucia.gomez@mail.com',
    ubicacion: 'Rojas 120, Caballito',
    foto: 'lucia',
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
    foto: 'luna',
  },
  {
    id: 2,
    tutorId: SOFIA_ID,
    nombre: 'Roco',
    raza: 'Bulldog Francés',
    fechaNacimiento: dia('2025-04-02'),
    codigo: 'DOGGY-3127-ROCO',
    senas: 'Blanco con manchas negras en la cara y las orejas paradas.',
    foto: 'roco',
  },
  {
    id: 3,
    tutorId: SOFIA_ID,
    nombre: 'Milo',
    raza: 'Mestizo',
    fechaNacimiento: dia('2021-06-20'),
    codigo: 'DOGGY-5610-MILO',
    senas: 'Marrón con el pecho y las patas blancas. Orejas caídas.',
    foto: 'milo',
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
    foto: 'toby',
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
    foto: 'pipa',
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
    foto: 'pipa',
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
    foto: 'milo',
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

/** Imprime el resumen para la demo. */
function imprimirResumen(): void {
  const perdidos = reportes.filter((r) => r.estado === 'perdido').length;
  console.log(
    `Seed listo: ${usuarios.length} usuarios, ${mascotas.length} mascotas, ${registros.length} registros, ` +
      `${turnos.length} turnos y ${reportes.length} reportes (${perdidos} perdidos, ${reportes.length - perdidos} encontrados).`,
  );
  console.log(`Contraseña de todos: ${PASSWORD_DEMO}\n`);
  console.log('Usuarios para la demo:');
  for (const { email, quien, mostrar } of GUIA_DEMO) {
    console.log(`- ${email}\n  ${quien}\n  ${mostrar}`);
  }
}

/**
 * Borra todos los datos y carga los de ejemplo, en una sola transacción.
 * @returns una promesa que termina cuando se cargó todo
 */
async function sembrar(): Promise<void> {
  // Cada usuario con su propio salt, como quedaría al registrarse.
  const usuariosConPassword = await Promise.all(
    usuarios.map(async (usuario) => ({
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
    await tx.mascota.createMany({ data: mascotas });
    await tx.registroSanitario.createMany({ data: registros });
    await tx.turno.createMany({ data: turnos });
    await tx.cuidador.createMany({ data: cuidadores });
    await tx.invitacion.createMany({ data: invitaciones });

    for (const { etiquetas, ...reporte } of reportes) {
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
