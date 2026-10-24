/**
 * Datos de ejemplo para la base local.
 *
 * Son los mismos datos, con los mismos ids, que usa el front en
 * doggy/mobile/src/data/mock.ts, así la app muestra lo mismo con o sin
 * backend. Corre con `npm run db:seed` (y al final de `npm run db:reset`).
 * Borra todo antes de cargar, así se puede correr más de una vez.
 *
 * Las fechas de los reportes se calculan desde "ahora", como en el mock, para
 * que "hace 2 h" siempre tenga sentido. Las de los turnos se calculan desde
 * hoy, así la demo de la Agenda siempre tiene uno pasado y varios próximos.
 * Las del carnet son fijas.
 */

import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';

/** Contraseña de todos los usuarios de prueba. */
const PASSWORD_DEMO = 'doggy1234';
/** Costo del hash de bcrypt. */
const RONDAS_BCRYPT = 10;

const HORA_MS = 60 * 60 * 1000;
/** Diferencia de Argentina con UTC (no tiene horario de verano). */
const DESFASE_ARGENTINA_MS = -3 * HORA_MS;

/** Usuaria logueada en la demo. */
const SOFIA_ID = 1;
/** Usuaria dueña de Toby: sirve para probar un código de asignación de otra persona. */
const LUCIA_ID = 20;

/**
 * Fecha de hace una cantidad de horas (para que los reportes digan "hace 2 h").
 * @param horas horas hacia atrás desde ahora
 * @returns la fecha
 */
function haceHoras(horas: number): Date {
  return new Date(Date.now() - horas * HORA_MS);
}

/**
 * Fecha a cierta hora de Argentina, una cantidad de días desde hoy.
 * Así los turnos de la demo no quedan viejos: se calculan cada vez que corre el seed.
 * @param dias días desde hoy (negativo para el pasado)
 * @param horas hora en Argentina (0 a 23)
 * @param minutos minutos
 * @returns la fecha y hora
 */
function enDias(dias: number, horas: number, minutos = 0): Date {
  // Corrido al desfase, el día UTC de este Date es el día de hoy en Argentina.
  const hoyEnArgentina = new Date(Date.now() + DESFASE_ARGENTINA_MS);
  const enUtc = Date.UTC(
    hoyEnArgentina.getUTCFullYear(),
    hoyEnArgentina.getUTCMonth(),
    hoyEnArgentina.getUTCDate() + dias,
    horas,
    minutos,
  );
  return new Date(enUtc - DESFASE_ARGENTINA_MS);
}

/**
 * Fecha sin hora (AAAA-MM-DD) guardada a medianoche UTC.
 * @param fecha fecha en formato AAAA-MM-DD
 * @returns la fecha a medianoche UTC
 */
function dia(fecha: string): Date {
  return new Date(`${fecha}T00:00:00.000Z`);
}

/**
 * Usuarios de la demo, sin la contraseña. Sofía es la del mock; el resto son
 * los que el mock nombra como autores de reportes, cuidadores o tutora de Toby.
 */
const usuarios = [
  {
    id: SOFIA_ID,
    nombre: 'Sofía',
    apellido: 'Romero',
    email: 'sofia.romero@mail.com',
    ubicacion: 'Palermo, Buenos Aires',
    foto: 'sofia',
    telefonoEmergencia: '+54 9 11 4589-2310',
  },
  {
    id: 2,
    nombre: 'Martín',
    apellido: 'López',
    email: 'martin.lopez@mail.com',
    ubicacion: 'Palermo, Buenos Aires',
    foto: null,
    telefonoEmergencia: '+54 9 11 5320-1187',
  },
  {
    id: 3,
    nombre: 'Valentina',
    apellido: 'Pérez',
    email: 'valentina.perez@mail.com',
    ubicacion: 'Belgrano, Buenos Aires',
    foto: null,
    telefonoEmergencia: '+54 9 11 6274-9031',
  },
  {
    id: 4,
    nombre: 'Julián',
    apellido: 'Fernández',
    email: 'julian.fernandez@mail.com',
    ubicacion: 'Recoleta, Buenos Aires',
    foto: null,
    telefonoEmergencia: '+54 9 11 4812-6650',
  },
  {
    id: 11,
    nombre: 'Carlos',
    apellido: 'Romero',
    email: 'carlos.romero@mail.com',
    ubicacion: 'Palermo, Buenos Aires',
    foto: 'carlos',
    telefonoEmergencia: '+54 9 11 4589-7712',
  },
  {
    // Cuenta de una clínica: el nombre completo va en `nombre` para que el
    // cuidador se muestre como "Vet. San Roque", igual que en el mock.
    id: 12,
    nombre: 'Vet. San Roque',
    apellido: '',
    email: 'contacto@vetsanroque.com',
    ubicacion: 'Palermo, Buenos Aires',
    foto: null,
    telefonoEmergencia: '+54 11 4777-3020',
  },
  {
    id: 13,
    nombre: 'Marcos',
    apellido: 'Díaz',
    email: 'marcos.diaz@mail.com',
    ubicacion: 'Palermo, Buenos Aires',
    foto: null,
    telefonoEmergencia: '+54 9 11 3456-7821',
  },
  {
    id: 14,
    nombre: 'Sol',
    apellido: 'Romero',
    email: 'sol.romero@mail.com',
    ubicacion: 'Colegiales, Buenos Aires',
    foto: null,
    telefonoEmergencia: '+54 9 11 4589-0045',
  },
  {
    id: LUCIA_ID,
    nombre: 'Lucía',
    apellido: 'Gómez',
    email: 'lucia.gomez@mail.com',
    ubicacion: 'Caballito, Buenos Aires',
    foto: null,
    telefonoEmergencia: '+54 9 11 5098-3364',
  },
];

const mascotas = [
  {
    id: 1,
    tutorId: SOFIA_ID,
    nombre: 'Luna',
    raza: 'Golden Retriever',
    edad: 3,
    codigo: 'DOGGY-8492-LUNA',
    senas: 'Mancha blanca en el pecho',
    foto: 'luna',
  },
  {
    id: 2,
    tutorId: SOFIA_ID,
    nombre: 'Roco',
    raza: 'Bulldog Francés',
    edad: 1,
    codigo: 'DOGGY-3127-ROCO',
    senas: 'Collar verde con chapita. Oreja izquierda un poco caída.',
    foto: 'roco',
  },
  {
    id: 3,
    tutorId: SOFIA_ID,
    nombre: 'Milo',
    raza: 'Mestizo',
    edad: 5,
    codigo: 'DOGGY-5610-MILO',
    senas: 'Pelo claro con manchas marrones en las orejas.',
    foto: 'milo',
  },
  // Mascota de otra usuaria (Lucía): Sofía no la ve hasta aceptar el código de asignación.
  {
    id: 4,
    tutorId: LUCIA_ID,
    nombre: 'Toby',
    raza: 'Beagle',
    edad: 4,
    codigo: 'DOGGY-7741-TOBY',
    senas: 'Tricolor, con la punta de la cola blanca.',
    foto: null,
  },
];

const registros = [
  {
    id: 1,
    mascotaId: 1,
    tipo: 'vacuna',
    nombre: 'Antirrábica',
    fecha: dia('2025-11-15'),
    profesional: 'Vet. San Roque',
    proximaDosis: dia('2026-11-15'),
  },
  {
    id: 2,
    mascotaId: 1,
    tipo: 'vacuna',
    nombre: 'Séxtuple',
    fecha: dia('2026-05-10'),
    profesional: 'Dra. Martínez',
    proximaDosis: dia('2027-05-10'),
  },
  {
    id: 3,
    mascotaId: 1,
    tipo: 'vacuna',
    nombre: 'Tos de las Perreras',
    fecha: dia('2026-01-12'),
    profesional: 'Clínica Veterinaria Sur',
  },
  {
    id: 4,
    mascotaId: 1,
    tipo: 'desparasitacion',
    nombre: 'Antiparasitario interno',
    fecha: dia('2026-08-02'),
    profesional: 'Dra. Martínez',
  },
  {
    id: 5,
    mascotaId: 1,
    tipo: 'desparasitacion',
    nombre: 'Pipeta antipulgas',
    fecha: dia('2026-09-01'),
    profesional: 'Vet. San Roque',
    proximaDosis: dia('2026-10-01'),
  },
  {
    id: 6,
    mascotaId: 2,
    tipo: 'vacuna',
    nombre: 'Séxtuple (Dosis 1)',
    fecha: dia('2026-09-18'),
    profesional: 'Clínica Belgrano Pet',
    proximaDosis: dia('2026-10-23'),
  },
  {
    id: 7,
    mascotaId: 3,
    tipo: 'vacuna',
    nombre: 'Antirrábica',
    fecha: dia('2026-04-20'),
    profesional: 'Vet. San Roque',
    proximaDosis: dia('2027-04-20'),
  },
];

const turnos = [
  {
    id: 1,
    mascotaId: 3,
    categoria: 'peluqueria',
    fecha: enDias(-10, 15),
    motivo: 'Baño y corte de pelo',
    lugar: 'Peluquería Canina Patitas, Palermo',
  },
  {
    id: 2,
    mascotaId: 1,
    categoria: 'veterinario',
    fecha: enDias(3, 10, 30),
    motivo: 'Chequeo General Anual',
    lugar: 'Vet. San Roque, Palermo',
  },
  {
    id: 3,
    mascotaId: 2,
    categoria: 'vacunas',
    fecha: enDias(3, 17),
    motivo: 'Vacuna Séxtuple (Dosis 2)',
    lugar: 'Clínica Belgrano Pet',
  },
  {
    id: 4,
    mascotaId: 1,
    categoria: 'peluqueria',
    fecha: enDias(10, 11),
    motivo: 'Baño y deslanado',
    lugar: 'Peluquería Canina Patitas, Palermo',
  },
];

/** Reportes con sus etiquetas, que se cargan en la tabla Etiqueta. */
const reportes = [
  {
    id: 1,
    mascotaId: null,
    autorId: 2,
    estado: 'perdido',
    nombre: 'Simba',
    raza: 'Golden Retriever',
    descripcion: 'Collar azul sin chapita. Muy amigable, responde a su nombre.',
    foto: 'simba',
    etiquetas: ['Collar azul'],
    lat: -34.5889,
    lng: -58.4306,
    zona: 'Palermo, CABA',
    fecha: haceHoras(2),
    radioMetros: 1000,
    infoAdicional: 'Tenía puesto un pretal rojo. Se asusta con las motos.',
  },
  {
    id: 2,
    mascotaId: null,
    autorId: 3,
    estado: 'encontrado',
    nombre: 'Sin collar',
    raza: 'Mestizo',
    descripcion: 'Lo encontramos cerca de Barrancas de Belgrano. Está en tránsito con nosotros.',
    foto: 'sin-collar',
    etiquetas: ['En tránsito'],
    lat: -34.5627,
    lng: -58.4583,
    zona: 'Belgrano, CABA',
    fecha: haceHoras(26),
  },
  {
    id: 3,
    mascotaId: null,
    autorId: 4,
    estado: 'perdido',
    nombre: 'Nieve',
    raza: 'Mestiza',
    descripcion: 'Perrita blanca de pelo largo. Se asustó con la pirotecnia y salió corriendo.',
    foto: null,
    etiquetas: ['Asustadiza', 'Pelo largo'],
    lat: -34.5875,
    lng: -58.3974,
    zona: 'Recoleta, CABA',
    fecha: haceHoras(22),
    radioMetros: 500,
  },
];

/** Asignaciones de personas a mascotas. El nombre y la foto salen del usuario. */
const cuidadores = [
  { id: 1, mascotaId: 1, usuarioId: SOFIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  { id: 2, mascotaId: 1, usuarioId: 11, rol: 'dueno', detalle: 'Co-tutor', tipo: 'familia' },
  { id: 3, mascotaId: 1, usuarioId: 12, rol: 'invitado', detalle: 'Dra. Martínez', tipo: 'clinica' },
  { id: 4, mascotaId: 2, usuarioId: SOFIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  {
    id: 5,
    mascotaId: 2,
    usuarioId: 13,
    rol: 'invitado',
    detalle: 'Paseos de lunes a viernes (10-12 hs)',
    tipo: 'paseador',
  },
  { id: 6, mascotaId: 3, usuarioId: SOFIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  { id: 7, mascotaId: 3, usuarioId: 14, rol: 'dueno', detalle: 'Hogar secundario', tipo: 'familia' },
  { id: 8, mascotaId: 4, usuarioId: LUCIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
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
    vence: new Date('2027-12-31T23:59:59.000Z'),
    usada: false,
  },
];

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

  console.log(`Seed listo: ${usuarios.length} usuarios con contraseña "${PASSWORD_DEMO}".`);
}

sembrar()
  .catch((error: unknown) => {
    console.error('Falló el seed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
