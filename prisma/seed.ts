/**
 * Datos de ejemplo para la base local: la demo de la app.
 *
 * Corre con `npm run db:seed` (y al final de `npm run db:reset`). Borra todo
 * antes de cargar, así se puede correr más de una vez. Al terminar imprime un
 * resumen con cada usuario de la demo y qué conviene mostrar con él.
 *
 * - Usuarios con direcciones de CABA y teléfonos en E.164: los celulares con
 *   el 9; la clínica, fijo (así se ve que no ofrece WhatsApp).
 * - Las fotos son claves de imágenes que vienen en la app
 *   (doggy/mobile/assets/images, ver `FOTOS_LOCALES` en src/data/fotos.ts y
 *   los créditos en doggy/CREDITOS.md).
 * - Las fechas se calculan desde hoy, así nunca quedan viejas: los reportes
 *   dicen "hace 2 h", la Agenda tiene turnos pasados y próximos, y el carnet
 *   tiene refuerzos próximos y vencidos. Las fechas de nacimiento son fijas.
 *
 * Las pruebas (`npm test`) parten de estos datos: Sofía (1) tiene a Luna,
 * Roco y Milo (1 a 3), Lucía (20) a Toby (4), Roco tiene una sola dueña, y
 * ninguna de esas cuatro mascotas está reportada como perdida. Rocky (6), de
 * Marcos, está perdido y con un encontrado de Martín todavía sin recuperar.
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

/** Usuaria principal de la demo: tutora de Luna, Roco y Milo. */
const SOFIA_ID = 1;
const MARTIN_ID = 2;
/** Encontró a Milo escaneando su chapita. */
const VALENTINA_ID = 3;
/** Tutor de Pipa, la mascota perdida con QR (para la demo de WhatsApp). */
const JULIAN_ID = 4;
const CARLOS_ID = 11;
/** La clínica: teléfono fijo, sin WhatsApp. */
const VETERINARIA_ID = 12;
/** Tutor de Rocky: perdido en Núñez y encontrado por Martín, todavía sin recuperar. */
const MARCOS_ID = 13;
const SOL_ID = 14;
/** Tutora de Toby: generó el código de asignación TOBY2026 para Sofía. */
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
    telefonoEmergencia: '+5491145892310',
  },
  {
    id: MARTIN_ID,
    nombre: 'Martín',
    apellido: 'López',
    email: 'martin.lopez@mail.com',
    ubicacion: 'Charcas 4120, Palermo',
    foto: 'martin',
    telefonoEmergencia: '+5491153201187',
  },
  {
    id: VALENTINA_ID,
    nombre: 'Valentina',
    apellido: 'Pérez',
    email: 'valentina.perez@mail.com',
    ubicacion: 'Juramento 2380, Belgrano',
    foto: 'valentina',
    telefonoEmergencia: '+5491162749031',
  },
  {
    id: JULIAN_ID,
    nombre: 'Julián',
    apellido: 'Fernández',
    email: 'julian.fernandez@mail.com',
    ubicacion: 'Díaz Vélez 4300, Almagro',
    foto: 'julian',
    telefonoEmergencia: '+5491148126650',
  },
  {
    id: CARLOS_ID,
    nombre: 'Carlos',
    apellido: 'Romero',
    email: 'carlos.romero@mail.com',
    ubicacion: 'Gurruchaga 1450, Palermo',
    foto: 'carlos',
    telefonoEmergencia: '+5491145897712',
  },
  {
    // Cuenta de una clínica: el nombre completo va en `nombre` para que el
    // cuidador se muestre como "Vet. San Roque". Teléfono fijo: sin WhatsApp.
    id: VETERINARIA_ID,
    nombre: 'Vet. San Roque',
    apellido: '',
    email: 'contacto@vetsanroque.com',
    ubicacion: 'Av. Scalabrini Ortiz 1830, Palermo',
    foto: 'vet-san-roque',
    telefonoEmergencia: '+541147773020',
  },
  {
    id: MARCOS_ID,
    nombre: 'Marcos',
    apellido: 'Díaz',
    email: 'marcos.diaz@mail.com',
    ubicacion: 'Cuba 3150, Núñez',
    foto: 'marcos',
    telefonoEmergencia: '+5491134567821',
  },
  {
    id: SOL_ID,
    nombre: 'Sol',
    apellido: 'Romero',
    email: 'sol.romero@mail.com',
    ubicacion: 'Virrey Loreto 3010, Colegiales',
    foto: 'sol',
    telefonoEmergencia: '+5491145890045',
  },
  {
    id: LUCIA_ID,
    nombre: 'Lucía',
    apellido: 'Gómez',
    email: 'lucia.gomez@mail.com',
    ubicacion: 'Rojas 120, Caballito',
    foto: 'lucia',
    telefonoEmergencia: '+5491150983364',
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
  // Perdida y con QR: quien la escanea ve el celular de Julián y "Avisar por WhatsApp".
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
  // Perdido y encontrado: en el mapa es un solo pin, con "¡La encontraron!".
  {
    id: 6,
    tutorId: MARCOS_ID,
    nombre: 'Rocky',
    raza: 'Boxer',
    fechaNacimiento: dia('2019-11-12'),
    codigo: 'DOGGY-1953-ROCKY',
    senas: 'Boxer atigrado con el pecho blanco. Collar de cuero marrón.',
    foto: 'rocky',
  },
];

/**
 * Carnet sanitario. Luna tiene de todo (refuerzos próximos y vencidos, un
 * análisis); Roco, una sola vacuna (la card de próximo refuerzo, que también
 * se desliza para borrar); Milo, la castración y un refuerzo vencido.
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
 * Reportes con sus etiquetas, repartidos por barrios. Perdidos y
 * encontrados, con y sin mascota registrada.
 */
const reportes = [
  {
    id: 1,
    mascotaId: null,
    autorId: MARTIN_ID,
    estado: 'perdido',
    nombre: 'Simba',
    raza: 'Golden Retriever',
    descripcion: 'Golden de 2 años, collar azul sin chapita. Muy amigable, responde a su nombre.',
    foto: 'simba',
    etiquetas: ['Collar azul'],
    lat: -34.5887,
    lng: -58.4286,
    zona: 'Palermo, CABA',
    fecha: haceHoras(2),
    radioMetros: 1000,
    infoAdicional: 'Se escapó cerca de Plaza Armenia. Tenía puesto un pretal rojo. Se asusta con las motos.',
  },
  {
    id: 2,
    mascotaId: null,
    autorId: VALENTINA_ID,
    estado: 'encontrado',
    nombre: 'Sin collar',
    raza: 'Mestizo',
    descripcion: 'Lo encontramos cerca de las Barrancas de Belgrano. Está en tránsito con nosotros.',
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
    autorId: SOL_ID,
    estado: 'perdido',
    nombre: 'Nieve',
    raza: 'Spitz',
    descripcion: 'Perrita blanca de pelo largo. Se asustó con la pirotecnia y salió corriendo.',
    foto: 'nieve',
    etiquetas: ['Asustadiza', 'Pelo largo'],
    lat: -34.5786,
    lng: -58.4887,
    zona: 'Villa Urquiza, CABA',
    fecha: haceHoras(22),
    radioMetros: 500,
  },
  // Valentina escaneó la chapita de Milo: Sofía ve "¡Encontraron a Milo!" con el contacto de Valentina.
  {
    id: 4,
    mascotaId: 3,
    autorId: VALENTINA_ID,
    estado: 'encontrado',
    nombre: 'Milo',
    raza: 'Mestizo',
    descripcion: 'Estaba solo en la plaza, con la chapita puesta. Lo tenemos en casa.',
    foto: 'milo',
    etiquetas: [],
    lat: -34.5614,
    lng: -58.4565,
    zona: 'Belgrano, CABA',
    fecha: haceHoras(1),
  },
  // Perdida con QR: quien escanee su chapita ve el celular de Julián y puede avisar por WhatsApp.
  {
    id: 5,
    mascotaId: 5,
    autorId: JULIAN_ID,
    estado: 'perdido',
    nombre: 'Pipa',
    raza: 'Border Collie',
    descripcion: 'Negra y blanca, con la cara partida en dos colores. Collar azul con chapita.',
    foto: 'pipa',
    etiquetas: ['Chapita Doggy'],
    lat: -34.6067,
    lng: -58.4352,
    zona: 'Caballito, CABA',
    fecha: haceHoras(5),
    radioMetros: 1000,
    infoAdicional: 'Se soltó de la correa en Parque Centenario. Es tímida: mejor no correrla.',
  },
  {
    id: 6,
    mascotaId: null,
    autorId: LUCIA_ID,
    estado: 'encontrado',
    nombre: 'Sin identificar',
    raza: 'Caniche toy',
    descripcion: 'Caniche color damasco, muy cariñoso. Andaba solo por Medrano y Corrientes. Lo tengo en casa.',
    foto: 'caniche',
    etiquetas: ['En tránsito'],
    lat: -34.6036,
    lng: -58.4209,
    zona: 'Almagro, CABA',
    fecha: haceHoras(8),
  },
  // Rocky sigue perdido aunque Martín lo encontró (reporte 10): espera que Marcos lo recupere.
  {
    id: 7,
    mascotaId: 6,
    autorId: MARCOS_ID,
    estado: 'perdido',
    nombre: 'Rocky',
    raza: 'Boxer',
    descripcion: 'Boxer atigrado con el pecho blanco. Collar de cuero marrón.',
    foto: 'rocky',
    etiquetas: ['Collar de cuero'],
    lat: -34.5458,
    lng: -58.4636,
    zona: 'Núñez, CABA',
    fecha: haceHoras(30),
    radioMetros: 2000,
  },
  {
    id: 8,
    mascotaId: null,
    autorId: CARLOS_ID,
    estado: 'encontrado',
    nombre: 'Sin identificar',
    raza: 'Labrador',
    descripcion: 'Labrador negro, adulto y muy tranquilo. Collar sin chapita. Lo dejé en un patio cerca de la plaza.',
    foto: 'labrador',
    etiquetas: [],
    lat: -34.5735,
    lng: -58.487,
    zona: 'Villa Urquiza, CABA',
    fecha: haceHoras(4),
  },
  {
    id: 9,
    mascotaId: null,
    autorId: VETERINARIA_ID,
    estado: 'encontrado',
    nombre: 'Sin identificar',
    raza: 'Salchicha',
    descripcion: 'Lo trajo un vecino a la veterinaria. Negro y fuego, collar rojo sin chapita. Está bien de salud.',
    foto: 'salchicha',
    etiquetas: ['En la veterinaria'],
    lat: -34.5876,
    lng: -58.4209,
    zona: 'Palermo, CABA',
    fecha: haceHoras(12),
  },
  // Martín escaneó la chapita de Rocky: no se dibuja aparte, se ve en el detalle del perdido.
  {
    id: 10,
    mascotaId: 6,
    autorId: MARTIN_ID,
    estado: 'encontrado',
    nombre: 'Rocky',
    raza: 'Boxer',
    descripcion: 'Estaba atado en la puerta de un kiosco, con la chapita puesta. Lo tenemos en casa.',
    foto: 'rocky',
    etiquetas: ['Chapita Doggy'],
    lat: -34.5531,
    lng: -58.4802,
    zona: 'Saavedra, CABA',
    fecha: haceHoras(3),
  },
];

/** Asignaciones de personas a mascotas. El nombre y la foto salen del usuario. */
const cuidadores = [
  { id: 1, mascotaId: 1, usuarioId: SOFIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  { id: 2, mascotaId: 1, usuarioId: CARLOS_ID, rol: 'dueno', detalle: 'Co-tutor', tipo: 'familia' },
  { id: 3, mascotaId: 1, usuarioId: VETERINARIA_ID, rol: 'invitado', detalle: 'Dra. Martínez', tipo: 'clinica' },
  { id: 4, mascotaId: 2, usuarioId: SOFIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  {
    id: 5,
    mascotaId: 2,
    usuarioId: MARCOS_ID,
    rol: 'invitado',
    detalle: 'Paseos de lunes a viernes (10-12 hs)',
    tipo: 'paseador',
  },
  { id: 6, mascotaId: 3, usuarioId: SOFIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  { id: 7, mascotaId: 3, usuarioId: SOL_ID, rol: 'dueno', detalle: 'Hogar secundario', tipo: 'familia' },
  { id: 8, mascotaId: 4, usuarioId: LUCIA_ID, rol: 'dueno', detalle: 'Tutora', tipo: 'familia' },
  { id: 9, mascotaId: 5, usuarioId: JULIAN_ID, rol: 'dueno', detalle: 'Tutor', tipo: 'familia' },
  { id: 10, mascotaId: 6, usuarioId: MARCOS_ID, rol: 'dueno', detalle: 'Tutor', tipo: 'familia' },
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
    quien: 'Sofía, tutora de Luna, Roco y Milo',
    mostrar: '"¡Encontraron a Milo!" con WhatsApp a Valentina; carnet de Luna (refuerzos próximos y vencidos) y de Roco (una sola vacuna); Agenda; código TOBY2026.',
  },
  {
    email: 'lucia.gomez@mail.com',
    quien: 'Lucía, tutora de Toby',
    mostrar: 'Escanear el QR de Pipa (perdida): celular de Julián y "Avisar por WhatsApp". Escanear el de Luna: solo "Su familia: Sofía".',
  },
  {
    email: 'julian.fernandez@mail.com',
    quien: 'Julián, tutor de Pipa (perdida en Caballito)',
    mostrar: 'Descargar o compartir el QR de Pipa para escanearlo con otra cuenta; editar el reporte o "Ya apareció".',
  },
  {
    email: 'valentina.perez@mail.com',
    quien: 'Valentina, encontró a Milo y a un mestizo en Belgrano',
    mostrar: 'Sus reportes de encontrado en Perdidos.',
  },
  {
    email: 'contacto@vetsanroque.com',
    quien: 'Vet. San Roque, clínica invitada en Luna',
    mostrar: 'Teléfono fijo: sin WhatsApp. Publicó la salchicha encontrada en Palermo.',
  },
  {
    email: 'carlos.romero@mail.com',
    quien: 'Carlos, co-tutor de Luna',
    mostrar: 'Ve a Luna y su carnet; publicó el labrador encontrado en Villa Urquiza.',
  },
  {
    email: 'marcos.diaz@mail.com',
    quien: 'Marcos, tutor de Rocky (perdido en Núñez, encontrado por Martín en Saavedra)',
    mostrar: 'Perdidos: un solo pin de Rocky con "¡La encontraron!" y el hallazgo en el detalle; "Ya volvió a casa" cierra los dos como "Devuelta a su familia".',
  },
  {
    email: 'martin.lopez@mail.com / sol.romero@mail.com',
    quien: 'Martín y Sol',
    mostrar: 'Perdidos sin chapita: Simba (Palermo) y Nieve (Villa Urquiza). Martín publicó el encontrado de Rocky.',
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
