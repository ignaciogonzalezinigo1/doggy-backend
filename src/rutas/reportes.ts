/**
 * Rutas de los reportes de perros perdidos y encontrados (mapa comunitario).
 *
 * Un reporte no se borra: al cerrarlo ("Ya apareció") se le pone la fecha en
 * `cerradoEn` y deja de salir en el mapa, pero queda el historial.
 *
 * Lo edita o lo cierra quien lo publicó o cualquier persona asignada a la
 * mascota del reporte (dueño o invitado), así si la encuentra otro integrante
 * de la familia la saca del mapa. Un reporte sin mascota solo lo gestiona su autor.
 */

import { Router } from 'express';
import { leerCambiosReporte, leerReporteNuevo } from '../cuerpos/reporte';
import {
  MENSAJE_MASCOTA_NO_EXISTE,
  MENSAJE_SIN_PERMISO_MASCOTA,
  mascotasAsignadasA,
  rolEn,
} from '../lib/asignaciones';
import { MENSAJE_ID_INVALIDO, parseId } from '../lib/entrada';
import { esErrorPrisma, responderError, responderErrorInterno } from '../lib/errores';
import { borrarFotoSiHuerfana } from '../lib/fotos';
import { prisma } from '../lib/prisma';
import { aReporte, INCLUIR_ETIQUETAS } from '../respuestas';

export const reportesRouter = Router();

/** Filtro de los reportes activos (los que no se cerraron). */
const ACTIVOS = { cerradoEn: null };

const MENSAJE_REPORTE_NO_EXISTE = 'No encontramos el reporte.';
const MENSAJE_SIN_PERMISO_REPORTE =
  'Solo quien publicó el reporte o quien tiene la mascota en su cuenta puede modificarlo.';
const MENSAJE_REPORTE_CERRADO = 'Este reporte ya está cerrado.';
const MENSAJE_YA_REPORTADA = 'Esta mascota ya está reportada como perdida. No se puede reportar de nuevo.';

/**
 * Arma la escritura anidada que crea las etiquetas de un reporte nuevo.
 * @param etiquetas textos de las etiquetas
 * @returns el `etiquetas` del data de Prisma
 */
function crearEtiquetas(etiquetas: string[]) {
  return { create: etiquetas.map((texto) => ({ texto })) };
}

/**
 * Arma la escritura anidada que reemplaza todas las etiquetas de un reporte:
 * borra las que tenía y crea las nuevas. Prisma la hace dentro de la misma
 * transacción que el update.
 * @param etiquetas textos nuevos
 * @returns el `etiquetas` del data de Prisma
 */
function reemplazarEtiquetas(etiquetas: string[]) {
  return { deleteMany: {}, ...crearEtiquetas(etiquetas) };
}

/**
 * Indica si un usuario puede editar o cerrar un reporte: lo publicó él o está
 * asignado a la mascota del reporte (dueño o invitado).
 * @param reporte autor y mascota del reporte
 * @param usuarioId usuario de la sesión
 * @returns true si puede gestionarlo
 */
async function puedeGestionar(
  reporte: { autorId: number; mascotaId: number | null },
  usuarioId: number,
): Promise<boolean> {
  if (reporte.autorId === usuarioId) return true;
  return reporte.mascotaId !== null && (await rolEn(reporte.mascotaId, usuarioId)) !== null;
}

/**
 * GET /api/reportes: todos los reportes activos (sin cerrar), de cualquier
 * usuario, con sus etiquetas. Los `encontrado` de una mascota asignada al
 * usuario que publicó otra persona traen `contacto` (nombre y teléfono de
 * quien la encontró), para que la familia le pueda avisar. Responde 200 con
 * ReportePerdida[] o 500.
 */
reportesRouter.get('/', async (req, res) => {
  try {
    const [reportes, asignadas] = await Promise.all([
      prisma.reportePerdida.findMany({
        where: ACTIVOS,
        include: { ...INCLUIR_ETIQUETAS, autor: { select: { nombre: true, telefonoEmergencia: true } } },
        orderBy: { id: 'asc' },
      }),
      prisma.mascota.findMany({ where: mascotasAsignadasA(req.usuarioId), select: { id: true } }),
    ]);
    const idsAsignadas = new Set(asignadas.map((m) => m.id));
    res.json(
      reportes.map(({ autor, ...reporte }) => {
        const avisarle =
          reporte.estado === 'encontrado' &&
          reporte.mascotaId !== null &&
          idsAsignadas.has(reporte.mascotaId) &&
          reporte.autorId !== req.usuarioId;
        return aReporte(
          reporte,
          avisarle ? { nombre: autor.nombre, telefono: autor.telefonoEmergencia } : undefined,
        );
      }),
    );
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/reportes');
  }
});

/**
 * POST /api/reportes: publica un reporte. El autor es el usuario de la sesión.
 * - perdido: de una mascota asignada al usuario, con radio de búsqueda; una
 *   mascota tiene como mucho un reporte de pérdida activo.
 * - encontrado: la mascota es opcional (la que identificó el QR, que puede
 *   ser de otra persona).
 * Body: estado, mascotaId, nombre, raza, descripcion, foto, etiquetas, lat,
 * lng, zona, fecha (ISO), radioMetros (opcional), infoAdicional (opcional).
 * Responde 201 con el ReportePerdida, 400 si un dato no es válido, 403 si
 * reporta perdida una mascota que no tiene asignada, 404 si la mascota no
 * existe, 409 si ya tiene un reporte de pérdida activo o 500.
 */
reportesRouter.post('/', async (req, res) => {
  try {
    const leido = leerReporteNuevo(req.body);
    if (!leido.ok) {
      responderError(res, 400, leido.error);
      return;
    }
    const { etiquetas, ...datos } = leido.datos;
    if (datos.mascotaId !== null) {
      const mascota = await prisma.mascota.findUnique({ where: { id: datos.mascotaId } });
      if (!mascota) {
        responderError(res, 404, MENSAJE_MASCOTA_NO_EXISTE);
        return;
      }
    }
    if (datos.estado === 'perdido' && datos.mascotaId !== null) {
      if (!(await rolEn(datos.mascotaId, req.usuarioId))) {
        responderError(res, 403, MENSAJE_SIN_PERMISO_MASCOTA);
        return;
      }
      const activo = await prisma.reportePerdida.findFirst({
        where: { ...ACTIVOS, mascotaId: datos.mascotaId, estado: 'perdido' },
        select: { id: true },
      });
      if (activo) {
        responderError(res, 409, MENSAJE_YA_REPORTADA);
        return;
      }
    }
    const reporte = await prisma.reportePerdida.create({
      data: { ...datos, autorId: req.usuarioId, etiquetas: crearEtiquetas(etiquetas) },
      include: INCLUIR_ETIQUETAS,
    });
    res.status(201).json(aReporte(reporte));
  } catch (error) {
    responderErrorInterno(res, error, 'POST /api/reportes');
  }
});

/**
 * PATCH /api/reportes/:id: modifica un reporte activo o lo cierra. Puede
 * hacerlo el autor o quien esté asignado a la mascota del reporte.
 * Body (todos opcionales): nombre, raza, descripcion, foto, etiquetas (si
 * vienen, reemplazan todas), lat, lng, zona, fecha, radioMetros,
 * infoAdicional (null la borra) y cerrado: true para cerrarlo ("Ya apareció").
 * El estado y la mascota no se cambian.
 * Responde 200 con el ReportePerdida, 400 si el id o un dato no es válido,
 * 403 si no es el autor ni está asignado a la mascota, 404 si no existe, 409 si ya estaba cerrado o 500.
 */
reportesRouter.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    responderError(res, 400, MENSAJE_ID_INVALIDO);
    return;
  }
  try {
    const actual = await prisma.reportePerdida.findUnique({ where: { id } });
    if (!actual) {
      responderError(res, 404, MENSAJE_REPORTE_NO_EXISTE);
      return;
    }
    if (!(await puedeGestionar(actual, req.usuarioId))) {
      responderError(res, 403, MENSAJE_SIN_PERMISO_REPORTE);
      return;
    }
    if (actual.cerradoEn !== null) {
      responderError(res, 409, MENSAJE_REPORTE_CERRADO);
      return;
    }
    const leido = leerCambiosReporte(req.body, actual.estado);
    if (!leido.ok) {
      responderError(res, 400, leido.error);
      return;
    }
    const { etiquetas, cerrado, ...cambios } = leido.datos;
    const reporte = await prisma.reportePerdida.update({
      where: { id },
      data: {
        ...cambios,
        ...(etiquetas && { etiquetas: reemplazarEtiquetas(etiquetas) }),
        ...(cerrado && { cerradoEn: new Date() }),
      },
      include: INCLUIR_ETIQUETAS,
    });
    await borrarFotoSiHuerfana(actual.foto, reporte.foto);
    res.json(aReporte(reporte));
  } catch (error) {
    if (esErrorPrisma(error, 'P2025')) {
      responderError(res, 404, MENSAJE_REPORTE_NO_EXISTE);
    } else {
      responderErrorInterno(res, error, 'PATCH /api/reportes/:id');
    }
  }
});
