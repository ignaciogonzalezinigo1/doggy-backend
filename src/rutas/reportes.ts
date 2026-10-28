/**
 * Rutas de los reportes de perros perdidos y encontrados (mapa comunitario).
 *
 * Un reporte no se borra: al cerrarlo se le pone la fecha en `cerradoEn` y el
 * resultado en `resultado`, y deja de salir en el mapa, pero queda el historial.
 *
 * Un "perdido" lo publica la familia. Un "encontrado" lo publica alguien que
 * encontró un perro: vinculado a la mascota (con el QR de su chapita, o desde
 * un perdido del mapa con "Encontré a …") o anónimo, sin mascota. Un perdido y
 * un encontrado activos de la misma mascota son un reencuentro: los dos siguen
 * activos hasta que la familia la recupera ("Ya volvió a casa") y ahí se
 * cierran juntos con "devuelta". Un encontrado vinculado sin perdido es el
 * caso dudoso: la familia confirma que se perdió (POST /:id/perdida, que crea
 * el perdido y pasa a reencuentro) o lo descarta ("No, está conmigo", que
 * cierra los encontrados con "descartado"). Un perdido sin encontrado se
 * cierra con "aparecio".
 *
 * Contacto: la familia ve a quien la encontró, y quien publicó un encontrado
 * vinculado ve a la familia (`contacto` en GET). Nadie más.
 *
 * Lo edita o lo cierra quien lo publicó o cualquier persona asignada a la
 * mascota del reporte (dueño o invitado), así si la encuentra otro integrante
 * de la familia la saca del mapa. Un reporte sin mascota solo lo gestiona su autor.
 */

import { Router } from 'express';
import { leerCambiosReporte, leerReporteNuevo, type DatosReporte } from '../cuerpos/reporte';
import type { EstadoReporte, ResultadoReporte } from '../dominio';
import {
  MENSAJE_MASCOTA_NO_EXISTE,
  MENSAJE_SIN_PERMISO_MASCOTA,
  mascotasAsignadasA,
  rolEn,
} from '../lib/asignaciones';
import { MENSAJE_CODIGO_NO_EXISTE } from '../lib/codigos';
import { MENSAJE_ID_INVALIDO, parseId } from '../lib/entrada';
import { esErrorPrisma, responderError, responderErrorInterno } from '../lib/errores';
import { borrarFotoSiHuerfana } from '../lib/fotos';
import { prisma } from '../lib/prisma';
import { aReporte, INCLUIR_ETIQUETAS } from '../respuestas';
import type { ReporteRespuesta } from '../tipos';

export const reportesRouter = Router();

/** Filtro de los reportes activos (los que no se cerraron). */
const ACTIVOS = { cerradoEn: null };

/** Rol de quienes representan a la familia cuando no hay un perdido (`ROLES_MASCOTA`). */
const ROL_DUENO = 'dueno';

const MENSAJE_REPORTE_NO_EXISTE = 'No encontramos el reporte.';
const MENSAJE_SIN_PERMISO_REPORTE =
  'Solo quien publicó el reporte o quien tiene la mascota en su cuenta puede modificarlo.';
const MENSAJE_REPORTE_CERRADO = 'Este reporte ya está cerrado.';
const MENSAJE_YA_REPORTADA = 'Esta mascota ya está reportada como perdida. No se puede reportar de nuevo.';
const MENSAJE_YA_AVISASTE = 'Ya avisaste que encontraste a esta mascota.';
const MENSAJE_ES_DE_TU_FAMILIA = 'Esta mascota está en tu cuenta: no hace falta avisar que la encontraste.';
const MENSAJE_SIN_QR = 'Para avisarle a su familia, escaneá el QR de su chapita.';
const MENSAJE_OTRO_CODIGO = 'El código del QR no es de esa mascota.';
const MENSAJE_NO_ES_HALLAZGO = 'Solo se confirma la pérdida desde el aviso de alguien que la encontró.';
const MENSAJE_SIN_PERMISO_HALLAZGO = 'Solo la familia de la mascota puede confirmar que se perdió.';

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
 * Reporte activo de una mascota con un estado dado.
 * @param mascotaId mascota del reporte
 * @param estado estado buscado
 * @returns el id del reporte, o null si no hay
 */
async function activoDe(mascotaId: number, estado: EstadoReporte): Promise<number | null> {
  const activo = await prisma.reportePerdida.findFirst({
    where: { ...ACTIVOS, mascotaId, estado },
    select: { id: true },
  });
  return activo?.id ?? null;
}

/** A quién avisarle en un reporte (`contacto`). */
type Contacto = NonNullable<ReporteRespuesta['contacto']>;

/** Nombre y teléfono de un usuario, como se leen para armar el contacto. */
type DatosContacto = { nombre: string; telefonoEmergencia: string };

/**
 * Contacto de un usuario, si cargó su teléfono.
 * @param usuario nombre y teléfono
 * @returns el contacto, o undefined si no tiene teléfono
 */
function contactoDe(usuario: DatosContacto): Contacto | undefined {
  if (usuario.telefonoEmergencia === '') return undefined;
  return { nombre: usuario.nombre, telefono: usuario.telefonoEmergencia };
}

/**
 * Familia a la que le escribe quien encontró cada mascota: quien publicó su
 * perdido activo, y si no hay (o no cargó teléfono), un dueño de la mascota,
 * primero quien la dio de alta.
 * @param mascotaIds mascotas de los encontrados del usuario
 * @param autoresPerdidos autor del perdido activo de cada mascota
 * @returns id de la mascota → contacto de la familia (las que no tienen a quién, no están)
 */
async function familiasDe(
  mascotaIds: number[],
  autoresPerdidos: Map<number, DatosContacto>,
): Promise<Map<number, Contacto>> {
  const familias = new Map<number, Contacto>();
  for (const mascotaId of mascotaIds) {
    const autor = autoresPerdidos.get(mascotaId);
    const contacto = autor && contactoDe(autor);
    if (contacto) familias.set(mascotaId, contacto);
  }
  const faltan = mascotaIds.filter((id) => !familias.has(id));
  if (faltan.length === 0) return familias;
  const mascotas = await prisma.mascota.findMany({
    where: { id: { in: faltan } },
    select: {
      id: true,
      tutorId: true,
      cuidadores: {
        where: { rol: ROL_DUENO },
        orderBy: { id: 'asc' },
        select: { usuarioId: true, usuario: { select: { nombre: true, telefonoEmergencia: true } } },
      },
    },
  });
  for (const mascota of mascotas) {
    // Primero quien la dio de alta; después los demás dueños, en orden.
    const duenos = [...mascota.cuidadores].sort(
      (a, b) => Number(b.usuarioId === mascota.tutorId) - Number(a.usuarioId === mascota.tutorId),
    );
    const contacto = duenos.map((d) => contactoDe(d.usuario)).find((c) => c !== undefined);
    if (contacto) familias.set(mascota.id, contacto);
  }
  return familias;
}

/** Cómo se cierra un reporte: con qué resultado y qué otros reportes de la mascota arrastra. */
type Cierre = { resultado: ResultadoReporte | null; otrosIds: number[] };

/**
 * Decide cómo se cierra un reporte, según los demás reportes activos de la mascota:
 * - un perdido con encontrados (reencuentro, "Ya volvió a casa"): "devuelta",
 *   y se cierran también los encontrados;
 * - un perdido sin encontrado ("Ya apareció"): "aparecio";
 * - un encontrado cerrado por alguien asignado a la mascota: con un perdido
 *   activo es el reencuentro ("devuelta"); sin perdido, la familia dice que
 *   no se perdió ("No, está conmigo": "descartado"). En los dos casos se
 *   cierran todos los reportes activos de la mascota;
 * - un encontrado sin mascota, o cerrado por quien lo publicó sin estar
 *   asignado: sin resultado, y solo ese.
 * @param reporte reporte que se cierra
 * @param usuarioId usuario de la sesión
 * @returns el resultado y los ids de los otros reportes a cerrar
 */
async function cierreDe(
  reporte: { id: number; estado: string; mascotaId: number | null },
  usuarioId: number,
): Promise<Cierre> {
  const { mascotaId } = reporte;
  if (mascotaId === null) return { resultado: null, otrosIds: [] };
  const otros = await prisma.reportePerdida.findMany({
    where: { ...ACTIVOS, mascotaId, id: { not: reporte.id } },
    select: { id: true, estado: true },
  });
  if (reporte.estado === 'perdido') {
    const encontrados = otros.filter((r) => r.estado === 'encontrado').map((r) => r.id);
    return { resultado: encontrados.length > 0 ? 'devuelta' : 'aparecio', otrosIds: encontrados };
  }
  if ((await rolEn(mascotaId, usuarioId)) === null) return { resultado: null, otrosIds: [] };
  const conPerdido = otros.some((r) => r.estado === 'perdido');
  return { resultado: conPerdido ? 'devuelta' : 'descartado', otrosIds: otros.map((r) => r.id) };
}

/** Lo que se usa de la mascota de un reporte nuevo. */
type MascotaReporte = { id: number; nombre: string; raza: string; foto: string | null; senas: string };

/** Mascota a la que se vincula un reporte nuevo (null si no es de ninguna), o el error a responder. */
type MascotaDelReporte =
  | { ok: true; mascota: MascotaReporte | null }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Busca la mascota de un reporte nuevo: por el código del QR si vino (y tiene
 * que coincidir con el `mascotaId`, si también vino) o por su id.
 * @param mascotaId id que vino en el body, o null
 * @param codigo código normalizado del QR, o null
 * @returns la mascota (null si el reporte no es de ninguna) o el error
 */
async function mascotaDelReporte(
  mascotaId: number | null,
  codigo: string | null,
): Promise<MascotaDelReporte> {
  let mascota: MascotaReporte | null = null;
  if (codigo !== null) {
    mascota = await prisma.mascota.findUnique({ where: { codigo } });
    if (!mascota) return { ok: false, status: 404, error: MENSAJE_CODIGO_NO_EXISTE };
    if (mascotaId !== null && mascotaId !== mascota.id) {
      return { ok: false, status: 400, error: MENSAJE_OTRO_CODIGO };
    }
  } else if (mascotaId !== null) {
    mascota = await prisma.mascota.findUnique({ where: { id: mascotaId } });
    if (!mascota) return { ok: false, status: 404, error: MENSAJE_MASCOTA_NO_EXISTE };
  }
  return { ok: true, mascota };
}

/**
 * GET /api/reportes: todos los reportes activos (sin cerrar), de cualquier
 * usuario, con sus etiquetas. Solo los `encontrado` vinculados a una mascota
 * pueden traer `contacto`: a quien está asignado a la mascota, el de quien la
 * encontró (si lo publicó otra persona); a quien lo publicó sin estar
 * asignado, el de la familia (ver `familiasDe`). Los demás no traen contacto:
 * ver un perdido en el mapa no habilita a escribirle a la familia.
 * Responde 200 con ReportePerdida[] o 500.
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
    const autoresPerdidos = new Map<number, DatosContacto>();
    const encontradasPorMi = new Set<number>();
    for (const r of reportes) {
      if (r.mascotaId === null) continue;
      if (r.estado === 'perdido') autoresPerdidos.set(r.mascotaId, r.autor);
      if (r.estado === 'encontrado' && r.autorId === req.usuarioId && !idsAsignadas.has(r.mascotaId)) {
        encontradasPorMi.add(r.mascotaId);
      }
    }
    const familias = await familiasDe([...encontradasPorMi], autoresPerdidos);
    res.json(
      reportes.map(({ autor, ...reporte }) => {
        let contacto: Contacto | undefined;
        if (reporte.estado === 'encontrado' && reporte.mascotaId !== null) {
          const propio = reporte.autorId === req.usuarioId;
          const asignada = idsAsignadas.has(reporte.mascotaId);
          // A la familia: quién la encontró. A quien la encontró: la familia.
          if (!propio && asignada) contacto = contactoDe(autor);
          if (propio && !asignada) contacto = familias.get(reporte.mascotaId);
        }
        return aReporte(reporte, contacto);
      }),
    );
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/reportes');
  }
});

/**
 * POST /api/reportes: publica un reporte. El autor es el usuario de la sesión.
 * - perdido: de una mascota asignada al usuario (`mascotaId`), con radio de
 *   búsqueda; una mascota tiene como mucho un perdido activo.
 * - encontrado vinculado: de una mascota ajena, con el `codigo` del QR de su
 *   chapita (aunque no esté perdida: puede que la familia todavía no sepa que
 *   se escapó) o con su `mascotaId` si tiene un perdido activo ("Encontré a
 *   …" desde el mapa). Sin el QR ni un perdido, cualquiera podría vincularse a
 *   cualquier mascota y ver el contacto de la familia. No se puede sobre una
 *   mascota propia o asignada, y cada usuario tiene como mucho un encontrado
 *   activo por mascota. No cierra el perdido: los dos quedan como reencuentro.
 * - encontrado anónimo: sin `mascotaId` ni `codigo`.
 * Si el reporte es de una mascota, el nombre y la raza salen de ella y no del
 * body. La foto también, salvo que quien la encontró mande una del momento; en
 * un perdido, la descripción son las señas de la mascota.
 * Body: estado, mascotaId o codigo, nombre y raza (sin mascota), descripcion,
 * foto, etiquetas, lat, lng, zona, fecha (ISO), radioMetros (opcional),
 * infoAdicional (opcional).
 * Responde 201 con el ReportePerdida, 400 si un dato no es válido (o el código
 * no es de esa mascota), 403 si reporta perdida una mascota que no tiene
 * asignada, si avisa que encontró una mascota propia o asignada, o si la
 * vincula sin QR a una mascota que no está perdida, 404 si la mascota no
 * existe, 409 si ya hay un perdido activo o ya avisó que la encontró, o 500.
 */
reportesRouter.post('/', async (req, res) => {
  try {
    const leido = leerReporteNuevo(req.body);
    if (!leido.ok) {
      responderError(res, 400, leido.error);
      return;
    }
    const { etiquetas, codigo, ...leidos } = leido.datos;
    const buscada = await mascotaDelReporte(leidos.mascotaId, codigo);
    if (!buscada.ok) {
      responderError(res, buscada.status, buscada.error);
      return;
    }
    let datos: Omit<DatosReporte, 'etiquetas'> = leidos;
    const { mascota } = buscada;
    if (mascota) {
      const [rol, perdidoActivo] = await Promise.all([
        rolEn(mascota.id, req.usuarioId),
        activoDe(mascota.id, 'perdido'),
      ]);
      const perdido = leidos.estado === 'perdido';
      if (perdido) {
        if (rol === null) {
          responderError(res, 403, MENSAJE_SIN_PERMISO_MASCOTA);
          return;
        }
        if (perdidoActivo !== null) {
          responderError(res, 409, MENSAJE_YA_REPORTADA);
          return;
        }
      } else {
        if (rol !== null) {
          responderError(res, 403, MENSAJE_ES_DE_TU_FAMILIA);
          return;
        }
        if (codigo === null && perdidoActivo === null) {
          responderError(res, 403, MENSAJE_SIN_QR);
          return;
        }
        const yaAviso = await prisma.reportePerdida.findFirst({
          where: { ...ACTIVOS, mascotaId: mascota.id, estado: 'encontrado', autorId: req.usuarioId },
          select: { id: true },
        });
        if (yaAviso) {
          responderError(res, 409, MENSAJE_YA_AVISASTE);
          return;
        }
      }
      datos = {
        ...leidos,
        mascotaId: mascota.id,
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
 * POST /api/reportes/:id/perdida: "Sí, se perdió". Alguien avisó que encontró
 * a la mascota (el encontrado `:id`) y no tenía un perdido activo: la familia
 * confirma que se perdió. Crea el perdido con los datos de la mascota (nombre,
 * raza, foto y señas) y el lugar y la hora del encontrado, sin radio, y la
 * mascota pasa a reencuentro. Sin body.
 * Responde 201 con el perdido creado, 400 si el id no es válido, 403 si el
 * usuario no está asignado a la mascota (o el encontrado es anónimo), 404 si
 * no existe, 409 si no es un encontrado, ya se cerró o la mascota ya tiene un
 * perdido activo, o 500.
 */
reportesRouter.post('/:id/perdida', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    responderError(res, 400, MENSAJE_ID_INVALIDO);
    return;
  }
  try {
    const encontrado = await prisma.reportePerdida.findUnique({ where: { id }, include: { mascota: true } });
    if (!encontrado) {
      responderError(res, 404, MENSAJE_REPORTE_NO_EXISTE);
      return;
    }
    const { mascota } = encontrado;
    if (!mascota || (await rolEn(mascota.id, req.usuarioId)) === null) {
      responderError(res, 403, MENSAJE_SIN_PERMISO_HALLAZGO);
      return;
    }
    if (encontrado.estado !== 'encontrado') {
      responderError(res, 409, MENSAJE_NO_ES_HALLAZGO);
      return;
    }
    if (encontrado.cerradoEn !== null) {
      responderError(res, 409, MENSAJE_REPORTE_CERRADO);
      return;
    }
    if ((await activoDe(mascota.id, 'perdido')) !== null) {
      responderError(res, 409, MENSAJE_YA_REPORTADA);
      return;
    }
    const perdido = await prisma.reportePerdida.create({
      data: {
        mascotaId: mascota.id,
        autorId: req.usuarioId,
        estado: 'perdido',
        nombre: mascota.nombre,
        raza: mascota.raza,
        descripcion: mascota.senas,
        foto: mascota.foto,
        lat: encontrado.lat,
        lng: encontrado.lng,
        zona: encontrado.zona,
        fecha: encontrado.fecha,
      },
      include: INCLUIR_ETIQUETAS,
    });
    res.status(201).json(aReporte(perdido));
  } catch (error) {
    responderErrorInterno(res, error, 'POST /api/reportes/:id/perdida');
  }
});

/**
 * PATCH /api/reportes/:id: modifica un reporte activo o lo cierra. Puede
 * hacerlo el autor o quien esté asignado a la mascota del reporte.
 * Body (todos opcionales): nombre, raza, descripcion, foto, etiquetas (si
 * vienen, reemplazan todas), lat, lng, zona, fecha, radioMetros,
 * infoAdicional (null la borra) y cerrado: true para cerrarlo ("Ya apareció",
 * "Ya volvió a casa" o "No, está conmigo"). El servidor guarda el resultado
 * (ver `cierreDe`) y, si corresponde, cierra en la misma transacción los
 * otros reportes activos de la mascota. El estado y la mascota no se cambian.
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
      if (cierre && cierre.otrosIds.length > 0) {
        await tx.reportePerdida.updateMany({
          where: { ...ACTIVOS, id: { in: cierre.otrosIds } },
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
