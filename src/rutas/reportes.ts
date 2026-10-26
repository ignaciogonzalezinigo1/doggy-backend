/**
 * Rutas de los reportes de perros perdidos y encontrados (mapa comunitario).
 *
 * Un reporte no se borra: al cerrarlo se le pone la fecha en `cerradoEn` y el
 * resultado en `resultado`, y deja de salir en el mapa, pero queda el historial.
 * Publicar un "encontrado" no cierra el "perdido" de la mascota: los dos siguen
 * activos hasta que la familia la recupera. Ahí, cerrar cualquiera de los dos
 * cierra los dos con "devuelta". Un perdido sin encontrado se cierra con "aparecio".
 *
 * Lo edita o lo cierra quien lo publicó o cualquier persona asignada a la
 * mascota del reporte (dueño o invitado), así si la encuentra otro integrante
 * de la familia la saca del mapa. Un reporte sin mascota solo lo gestiona su autor.
 */

import { Router } from 'express';
import { leerCambiosReporte, leerReporteNuevo } from '../cuerpos/reporte';
import type { EstadoReporte, ResultadoReporte } from '../dominio';
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
const MENSAJE_YA_AVISARON = 'Ya le avisaron a su familia.';

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

/** Cómo se cierra un reporte: con qué resultado y si arrastra a otro de la misma mascota. */
type Cierre = { resultado: ResultadoReporte | null; otroId: number | null };

/**
 * Reporte activo de una mascota con un estado dado.
 * @param mascotaId mascota del reporte (null si no tiene)
 * @param estado estado buscado
 * @returns el id del reporte, o null si no hay
 */
async function activoDe(mascotaId: number | null, estado: EstadoReporte): Promise<number | null> {
  if (mascotaId === null) return null;
  const activo = await prisma.reportePerdida.findFirst({
    where: { ...ACTIVOS, mascotaId, estado },
    select: { id: true },
  });
  return activo?.id ?? null;
}

/**
 * Decide cómo se cierra un reporte:
 * - un perdido con un encontrado activo de la misma mascota: "devuelta", y se
 *   cierra también el encontrado;
 * - un perdido sin encontrado: "aparecio";
 * - un encontrado de una mascota, cerrado por alguien asignado a ella ("Ya
 *   volvió a casa"): "devuelta", y se cierra también el perdido activo, si hay;
 * - un encontrado sin mascota, o cerrado por su autor sin estar asignado: sin resultado.
 * @param reporte reporte que se cierra
 * @param usuarioId usuario de la sesión
 * @returns el resultado y el id del otro reporte a cerrar (o null)
 */
async function cierreDe(
  reporte: { estado: string; mascotaId: number | null },
  usuarioId: number,
): Promise<Cierre> {
  const { mascotaId } = reporte;
  if (reporte.estado === 'perdido') {
    const encontrado = await activoDe(mascotaId, 'encontrado');
    return { resultado: encontrado === null ? 'aparecio' : 'devuelta', otroId: encontrado };
  }
  if (mascotaId !== null && (await rolEn(mascotaId, usuarioId)) !== null) {
    return { resultado: 'devuelta', otroId: await activoDe(mascotaId, 'perdido') };
  }
  return { resultado: null, otroId: null };
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
 *   ser de otra persona). Se permite aunque la mascota no esté perdida: puede
 *   que la familia todavía no sepa que se escapó. Una mascota tiene como
 *   mucho un encontrado activo. Publicarlo no cierra el perdido de la mascota:
 *   los dos siguen activos hasta que la familia la recupera.
 * Si viene `mascotaId`, el nombre y la raza salen de la mascota y no del body.
 * La foto también, salvo que quien la encontró mande una del momento; en un
 * perdido, la descripción son las señas de la mascota.
 * Body: estado, mascotaId, nombre y raza (sin mascota), descripcion, foto,
 * etiquetas, lat, lng, zona, fecha (ISO), radioMetros (opcional),
 * infoAdicional (opcional).
 * Responde 201 con el ReportePerdida, 400 si un dato no es válido, 403 si
 * reporta perdida una mascota que no tiene asignada, 404 si la mascota no
 * existe, 409 si ya tiene un reporte activo del mismo estado o 500.
 */
reportesRouter.post('/', async (req, res) => {
  try {
    const leido = leerReporteNuevo(req.body);
    if (!leido.ok) {
      responderError(res, 400, leido.error);
      return;
    }
    const { etiquetas, ...leidos } = leido.datos;
    let datos = leidos;
    if (leidos.mascotaId !== null) {
      const mascota = await prisma.mascota.findUnique({ where: { id: leidos.mascotaId } });
      if (!mascota) {
        responderError(res, 404, MENSAJE_MASCOTA_NO_EXISTE);
        return;
      }
      if (leidos.estado === 'perdido' && !(await rolEn(mascota.id, req.usuarioId))) {
        responderError(res, 403, MENSAJE_SIN_PERMISO_MASCOTA);
        return;
      }
      const activo = await prisma.reportePerdida.findFirst({
        where: { ...ACTIVOS, mascotaId: mascota.id, estado: leidos.estado },
        select: { id: true },
      });
      if (activo) {
        responderError(res, 409, leidos.estado === 'perdido' ? MENSAJE_YA_REPORTADA : MENSAJE_YA_AVISARON);
        return;
      }
      const perdido = leidos.estado === 'perdido';
      datos = {
        ...leidos,
        nombre: mascota.nombre,
        raza: mascota.raza,
        foto: perdido ? mascota.foto : (leidos.foto ?? mascota.foto),
        descripcion: perdido ? mascota.senas : leidos.descripcion,
      };
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
 * infoAdicional (null la borra) y cerrado: true para cerrarlo ("Ya apareció" o
 * "Ya volvió a casa"). El servidor guarda el resultado (ver `cierreDe`) y, si
 * la mascota volvió con su familia, cierra en la misma transacción el otro
 * reporte activo (el perdido o el encontrado). El estado y la mascota no se cambian.
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
    const leido = leerCambiosReporte(req.body, actual.estado, actual.mascotaId !== null);
    if (!leido.ok) {
      responderError(res, 400, leido.error);
      return;
    }
    const { etiquetas, cerrado, ...cambios } = leido.datos;
    const cierre = cerrado ? await cierreDe(actual, req.usuarioId) : null;
    const cerradoEn = new Date();
    const reporte = await prisma.$transaction(async (tx) => {
      if (cierre?.otroId) {
        await tx.reportePerdida.updateMany({
          where: { ...ACTIVOS, id: cierre.otroId },
          data: { cerradoEn, resultado: cierre.resultado },
        });
      }
      return tx.reportePerdida.update({
        where: { id },
        data: {
          ...cambios,
          ...(etiquetas && { etiquetas: reemplazarEtiquetas(etiquetas) }),
          ...(cierre && { cerradoEn, resultado: cierre.resultado }),
        },
        include: INCLUIR_ETIQUETAS,
      });
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
