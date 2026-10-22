/**
 * Forma del JSON que responde la API.
 *
 * Son copia de los tipos de doggy/mobile/src/types/models.ts: lo que sale de
 * acá es exactamente lo que la app espera recibir. Si cambia uno, cambia en
 * los dos repos. Los modelos de Prisma no siempre coinciden con estos tipos;
 * las funciones de src/respuestas.ts hacen la conversión.
 */

import type {
  CategoriaTurno,
  EstadoReporte,
  RolMascota,
  TipoCuidador,
  TipoRegistro,
} from './dominio';

/** Usuario de la cuenta, sin la contraseña. */
export type UsuarioRespuesta = {
  id: number;
  nombre: string;
  apellido: string;
  email: string;
  ubicacion: string;
  foto: string | null;
  telefonoEmergencia: string;
};

/** Perro registrado. */
export type MascotaRespuesta = {
  id: number;
  tutorId: number;
  nombre: string;
  raza: string;
  edad: number;
  codigo: string;
  senas: string;
  foto: string | null;
};

/** Entrada del carnet sanitario. Las fechas van como AAAA-MM-DD. */
export type RegistroRespuesta = {
  id: number;
  mascotaId: number;
  tipo: TipoRegistro;
  nombre: string;
  fecha: string;
  profesional: string;
  proximaDosis?: string;
  fotoEtiqueta?: string;
};

/** Turno de la agenda. La fecha va como ISO completo, con hora. */
export type TurnoRespuesta = {
  id: number;
  mascotaId: number;
  categoria: CategoriaTurno;
  fecha: string;
  motivo: string;
  lugar: string;
};

/** Reporte de perro perdido o encontrado, con las etiquetas como lista. */
export type ReporteRespuesta = {
  id: number;
  mascotaId: number | null;
  autorId: number;
  estado: EstadoReporte;
  nombre: string;
  raza: string;
  descripcion: string;
  foto: string | null;
  etiquetas: string[];
  lat: number;
  lng: number;
  zona: string;
  fecha: string;
  radioMetros?: number;
  infoAdicional?: string;
};

/** Persona asignada a una mascota, con nombre y foto tomados del usuario. */
export type CuidadorRespuesta = {
  id: number;
  mascotaId: number;
  usuarioId: number;
  nombre: string;
  rol: RolMascota;
  detalle: string;
  tipo: TipoCuidador;
  foto: string | null;
};
