/**
 * Conversión de los modelos de Prisma al JSON que responde la API.
 *
 * Acá se aplica "Del modelo a la respuesta" del CLAUDE.md: etiquetas como
 * lista, nombre y foto del cuidador desde su usuario, la mascota de una
 * invitación desde la relación, fechas sin hora como AAAA-MM-DD, opcionales
 * omitidos si son null y nunca `passwordHash`. Las rutas consultan con Prisma y pasan el resultado por estas funciones, tanto
 * en los GET como en lo que devuelvan los POST y PATCH.
 */

import {
  CATEGORIAS_TURNO,
  ESTADOS_REPORTE,
  esValorDe,
  ROLES_MASCOTA,
  TIPOS_CUIDADOR,
  TIPOS_REGISTRO,
} from './dominio';
import type {
  Cuidador,
  Etiqueta,
  Invitacion,
  Mascota,
  RegistroSanitario,
  ReportePerdida,
  Turno,
  Usuario,
} from './generated/prisma/client';
import { mesesCumplidos } from './validaciones';
import type {
  CuidadorRespuesta,
  InvitacionRespuesta,
  MascotaPublicaRespuesta,
  MascotaRespuesta,
  RegistroRespuesta,
  ReporteRespuesta,
  TurnoRespuesta,
  UsuarioRespuesta,
} from './tipos';

/** Largo de "AAAA-MM-DD" al principio de un ISO. */
const LARGO_SOLO_FECHA = 10;

/** Usuario tal como lo puede leer una ruta: puede venir sin `passwordHash` (con `omit`). */
type UsuarioLeido = Omit<Usuario, 'passwordHash'>;

/** Reporte con sus etiquetas incluidas (`include: { etiquetas: true }`). */
export type ReporteConEtiquetas = ReportePerdida & { etiquetas: Etiqueta[] };

/** Mascota con el nombre y el teléfono de su tutor (`include: INCLUIR_TUTOR`). */
export type MascotaConTutor = Mascota & { tutor: Pick<Usuario, 'nombre' | 'telefonoEmergencia'> };

/** Lo que hay que incluir al consultar una mascota para pasarla por `aMascotaPublica`. */
export const INCLUIR_TUTOR = { tutor: { select: { nombre: true, telefonoEmergencia: true } } } as const;

/** Cuidador con los datos de su usuario que se muestran (`include: { usuario: { select } }`). */
export type CuidadorConUsuario = Cuidador & {
  usuario: Pick<Usuario, 'nombre' | 'apellido' | 'foto'>;
};

/** Invitación con los datos de su mascota (`include: INCLUIR_MASCOTA_INVITACION`). */
export type InvitacionConMascota = Invitacion & {
  mascota: Pick<Mascota, 'nombre' | 'raza' | 'foto'>;
};

/** Lo que hay que incluir al consultar invitaciones para poder pasarlas por `aInvitacion`. */
export const INCLUIR_MASCOTA_INVITACION = {
  mascota: { select: { nombre: true, raza: true, foto: true } },
} as const;

/** Lo que hay que incluir al consultar reportes para poder pasarlos por `aReporte`. */
export const INCLUIR_ETIQUETAS = { etiquetas: { orderBy: { id: 'asc' } } } as const;

/** Lo que hay que incluir al consultar cuidadores para poder pasarlos por `aCuidador`. */
export const INCLUIR_USUARIO_CUIDADOR = {
  usuario: { select: { nombre: true, apellido: true, foto: true } },
} as const;

/**
 * Verifica que un campo guardado como String tenga uno de los valores válidos.
 * Si no, es un dato roto en la base: se corta con un error (la ruta responde 500).
 * @param lista valores válidos, por ejemplo `ESTADOS_REPORTE`
 * @param valor lo que hay en la base
 * @param campo nombre del campo, para el log
 * @returns el valor con su tipo
 */
function valorDe<T extends string>(lista: readonly T[], valor: string, campo: string): T {
  if (!esValorDe(lista, valor)) {
    throw new Error(`Valor inválido en la base para ${campo}: "${valor}"`);
  }
  return valor;
}

/**
 * Fecha sin hora como AAAA-MM-DD. Se guarda a medianoche UTC, así que la parte
 * de la fecha del ISO es el día correcto.
 * @param fecha fecha guardada
 * @returns el día como AAAA-MM-DD
 */
export function soloFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, LARGO_SOLO_FECHA);
}

/**
 * Usuario sin la contraseña. Copia los campos uno por uno, así aunque llegue
 * con `passwordHash` nunca se filtra.
 * @param usuario usuario leído de la base
 * @returns el usuario para responder
 */
export function aUsuario(usuario: UsuarioLeido): UsuarioRespuesta {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    email: usuario.email,
    ubicacion: usuario.ubicacion,
    foto: usuario.foto,
    telefonoEmergencia: usuario.telefonoEmergencia,
  };
}

/**
 * Mascota para responder (tiene la misma forma que el modelo).
 * @param mascota mascota leída de la base
 * @returns la mascota para responder
 */
export function aMascota(mascota: Mascota): MascotaRespuesta {
  return {
    id: mascota.id,
    tutorId: mascota.tutorId,
    nombre: mascota.nombre,
    raza: mascota.raza,
    fechaNacimiento: soloFecha(mascota.fechaNacimiento),
    codigo: mascota.codigo,
    senas: mascota.senas,
    foto: mascota.foto,
  };
}

/**
 * Datos públicos de una mascota, para quien la busca por el código del QR.
 * @param mascota mascota leída con `INCLUIR_TUTOR`
 * @param conTelefono true si se puede mostrar el teléfono del tutor (la
 *   mascota está perdida o quien la busca está asignado a ella)
 * @returns la mascota para responder
 */
export function aMascotaPublica(mascota: MascotaConTutor, conTelefono: boolean): MascotaPublicaRespuesta {
  return {
    id: mascota.id,
    nombre: mascota.nombre,
    raza: mascota.raza,
    edadMeses: mesesCumplidos(mascota.fechaNacimiento),
    senas: mascota.senas,
    foto: mascota.foto,
    codigo: mascota.codigo,
    dueno: {
      nombre: mascota.tutor.nombre,
      ...(conTelefono && { telefono: mascota.tutor.telefonoEmergencia }),
    },
  };
}

/**
 * Registro del carnet con las fechas como AAAA-MM-DD y sin los opcionales vacíos.
 * @param registro registro leído de la base
 * @returns el registro para responder
 */
export function aRegistro(registro: RegistroSanitario): RegistroRespuesta {
  return {
    id: registro.id,
    mascotaId: registro.mascotaId,
    tipo: valorDe(TIPOS_REGISTRO, registro.tipo, 'RegistroSanitario.tipo'),
    nombre: registro.nombre,
    fecha: soloFecha(registro.fecha),
    profesional: registro.profesional,
    ...(registro.proximaDosis !== null && { proximaDosis: soloFecha(registro.proximaDosis) }),
    ...(registro.fotoEtiqueta !== null && { fotoEtiqueta: registro.fotoEtiqueta }),
  };
}

/**
 * Turno con la fecha como ISO completo.
 * @param turno turno leído de la base
 * @returns el turno para responder
 */
export function aTurno(turno: Turno): TurnoRespuesta {
  return {
    id: turno.id,
    mascotaId: turno.mascotaId,
    categoria: valorDe(CATEGORIAS_TURNO, turno.categoria, 'Turno.categoria'),
    fecha: turno.fecha.toISOString(),
    motivo: turno.motivo,
    lugar: turno.lugar,
  };
}

/**
 * Reporte con las etiquetas como lista de textos y sin los opcionales vacíos.
 * @param reporte reporte leído con `INCLUIR_ETIQUETAS`
 * @param contacto quién lo publicó, si se le puede mostrar al usuario
 * @returns el reporte para responder
 */
export function aReporte(
  reporte: ReporteConEtiquetas,
  contacto?: ReporteRespuesta['contacto'],
): ReporteRespuesta {
  return {
    id: reporte.id,
    mascotaId: reporte.mascotaId,
    autorId: reporte.autorId,
    estado: valorDe(ESTADOS_REPORTE, reporte.estado, 'ReportePerdida.estado'),
    nombre: reporte.nombre,
    raza: reporte.raza,
    descripcion: reporte.descripcion,
    foto: reporte.foto,
    etiquetas: reporte.etiquetas.map((etiqueta) => etiqueta.texto),
    lat: reporte.lat,
    lng: reporte.lng,
    zona: reporte.zona,
    fecha: reporte.fecha.toISOString(),
    ...(reporte.radioMetros !== null && { radioMetros: reporte.radioMetros }),
    ...(reporte.infoAdicional !== null && { infoAdicional: reporte.infoAdicional }),
    ...(contacto && { contacto }),
  };
}

/**
 * Cuidador con el nombre (nombre y apellido unidos) y la foto de su usuario.
 * @param cuidador cuidador leído con `INCLUIR_USUARIO_CUIDADOR`
 * @returns el cuidador para responder
 */
export function aCuidador(cuidador: CuidadorConUsuario): CuidadorRespuesta {
  const { nombre, apellido, foto } = cuidador.usuario;
  return {
    id: cuidador.id,
    mascotaId: cuidador.mascotaId,
    usuarioId: cuidador.usuarioId,
    // Las cuentas de clínicas tienen el apellido vacío: el trim evita el espacio final.
    nombre: `${nombre} ${apellido}`.trim(),
    rol: valorDe(ROLES_MASCOTA, cuidador.rol, 'Cuidador.rol'),
    detalle: cuidador.detalle,
    tipo: valorDe(TIPOS_CUIDADOR, cuidador.tipo, 'Cuidador.tipo'),
    foto,
  };
}

/**
 * Invitación con los datos de la mascota.
 * @param invitacion invitación leída con `INCLUIR_MASCOTA_INVITACION`
 * @returns la invitación para responder
 */
export function aInvitacion(invitacion: InvitacionConMascota): InvitacionRespuesta {
  const { nombre, raza, foto } = invitacion.mascota;
  return {
    token: invitacion.token,
    mascotaId: invitacion.mascotaId,
    rol: valorDe(ROLES_MASCOTA, invitacion.rol, 'Invitacion.rol'),
    creadaPorId: invitacion.creadaPorId,
    usada: invitacion.usada,
    mascota: { nombre, raza, foto },
  };
}
