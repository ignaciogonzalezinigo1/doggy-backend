/**
 * Rutas de las mascotas del usuario, y de lo que se crea colgado de una
 * mascota: registros del carnet, códigos de asignación y la desasignación
 * del propio usuario. También la búsqueda por el código del QR, que es la
 * única que deja ver (solo los datos públicos de) una mascota ajena.
 */

import { Router } from 'express';
import { leerCambiosMascota, leerMascotaNueva } from '../cuerpos/mascota';
import { leerRegistroNuevo } from '../cuerpos/registro';
import { esValorDe, ROLES_MASCOTA } from '../dominio';
import {
  chequearMascota,
  MENSAJE_MASCOTA_NO_EXISTE,
  MENSAJE_SIN_PERMISO_MASCOTA,
  mascotasAsignadasA,
  rolEn,
} from '../lib/asignaciones';
import { generarCodigoMascota, generarToken, normalizarCodigoMascota } from '../lib/codigos';
import { DatoInvalido, leerCuerpo, MENSAJE_ID_INVALIDO, parseId, pick } from '../lib/entrada';
import { esErrorPrisma, responderError, responderErrorInterno } from '../lib/errores';
import { borrarFotoSiHuerfana } from '../lib/fotos';
import { prisma } from '../lib/prisma';
import {
  aInvitacion,
  aMascota,
  aMascotaPublica,
  aRegistro,
  INCLUIR_MASCOTA_INVITACION,
  INCLUIR_TUTOR,
} from '../respuestas';

export const mascotasRouter = Router();

/** Cómo queda asignado quien da de alta una mascota (igual que `asignarCreador` en la app). */
const ASIGNACION_CREADOR = { rol: 'dueno', detalle: 'Tutor/a', tipo: 'familia' } as const;

const MENSAJE_NO_ASIGNADO = 'No estás asignado a esta mascota.';
const MENSAJE_UNICO_DUENO = 'Sos el único dueño. Asigná a otra persona como dueña antes de irte.';
const MENSAJE_CODIGO_INVALIDO = 'Ese código no es de una chapita Doggy (DOGGY-XXXX-NOMBRE).';
const MENSAJE_CODIGO_NO_EXISTE = 'No hay ninguna mascota registrada con ese código.';

/**
 * GET /api/mascotas: mascotas a las que está asignado el usuario (como dueño o
 * invitado), en orden de alta. Responde 200 con Mascota[] o 500.
 */
mascotasRouter.get('/', async (req, res) => {
  try {
    const mascotas = await prisma.mascota.findMany({
      where: mascotasAsignadasA(req.usuarioId),
      orderBy: { id: 'asc' },
    });
    res.json(mascotas.map(aMascota));
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/mascotas');
  }
});

/**
 * GET /api/mascotas/codigo/:codigo: busca una mascota por el código del QR de
 * su chapita. La usa quien encontró un perro, que casi nunca está asignado a
 * él, así que no se chequea la asignación pero se responden solo los datos
 * públicos para identificarla y el nombre del tutor (`aMascotaPublica`). El
 * teléfono del tutor va solo si la mascota tiene un reporte `perdido` activo
 * o si quien la busca está asignado a ella: el filtro es acá, no en la app.
 * Acepta el código en minúsculas o con espacios alrededor.
 * Responde 200 con MascotaPublica, 400 si no tiene el formato
 * DOGGY-XXXX-NOMBRE, 404 si no existe o 500.
 */
mascotasRouter.get('/codigo/:codigo', async (req, res) => {
  const codigo = normalizarCodigoMascota(req.params.codigo);
  if (codigo === null) {
    responderError(res, 400, MENSAJE_CODIGO_INVALIDO);
    return;
  }
  try {
    const mascota = await prisma.mascota.findUnique({ where: { codigo }, include: INCLUIR_TUTOR });
    if (!mascota) {
      responderError(res, 404, MENSAJE_CODIGO_NO_EXISTE);
      return;
    }
    const [rol, perdido] = await Promise.all([
      rolEn(mascota.id, req.usuarioId),
      prisma.reportePerdida.findFirst({
        where: { mascotaId: mascota.id, estado: 'perdido', cerradoEn: null },
        select: { id: true },
      }),
    ]);
    res.json(aMascotaPublica(mascota, rol !== null || perdido !== null));
  } catch (error) {
    responderErrorInterno(res, error, 'GET /api/mascotas/codigo/:codigo');
  }
});

/**
 * POST /api/mascotas: da de alta una mascota. El servidor le genera el código
 * único del QR (DOGGY-XXXX-NOMBRE) y, en la misma transacción, asigna al
 * usuario como dueño.
 * Body: nombre, raza, edad, senas, foto (opcional).
 * Responde 201 con la Mascota, 400 si un dato no es válido o 500.
 */
mascotasRouter.post('/', async (req, res) => {
  try {
    const datos = leerMascotaNueva(req.body);
    if (!datos.ok) {
      responderError(res, 400, datos.error);
      return;
    }
    const codigo = await generarCodigoMascota(datos.datos.nombre);
    const mascota = await prisma.$transaction(async (tx) => {
      const creada = await tx.mascota.create({
        data: { ...datos.datos, codigo, tutorId: req.usuarioId },
      });
      await tx.cuidador.create({
        data: { ...ASIGNACION_CREADOR, mascotaId: creada.id, usuarioId: req.usuarioId },
      });
      return creada;
    });
    res.status(201).json(aMascota(mascota));
  } catch (error) {
    responderErrorInterno(res, error, 'POST /api/mascotas');
  }
});

/**
 * PATCH /api/mascotas/:id: cambia datos de una mascota asignada al usuario.
 * El código del QR no cambia aunque cambie el nombre (ya está impreso en la chapita).
 * Body (todos opcionales): nombre, raza, edad, senas, foto (null la borra).
 * Responde 200 con la Mascota, 400 si el id o un dato no es válido, 403 si
 * no está asignado, 404 si no existe o 500.
 */
mascotasRouter.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    responderError(res, 400, MENSAJE_ID_INVALIDO);
    return;
  }
  try {
    const permiso = await chequearMascota(id, req.usuarioId);
    if (permiso) {
      responderError(res, permiso.status, permiso.error);
      return;
    }
    const cambios = leerCambiosMascota(req.body);
    if (!cambios.ok) {
      responderError(res, 400, cambios.error);
      return;
    }
    const anterior = await prisma.mascota.findUnique({ where: { id }, select: { foto: true } });
    const mascota = await prisma.mascota.update({ where: { id }, data: cambios.datos });
    await borrarFotoSiHuerfana(anterior?.foto, mascota.foto);
    res.json(aMascota(mascota));
  } catch (error) {
    if (esErrorPrisma(error, 'P2025')) {
      responderError(res, 404, MENSAJE_MASCOTA_NO_EXISTE);
    } else {
      responderErrorInterno(res, error, 'PATCH /api/mascotas/:id');
    }
  }
});

/**
 * POST /api/mascotas/:id/registros: agrega un registro al carnet de la mascota.
 * Body: tipo, nombre, fecha (AAAA-MM-DD), profesional, proximaDosis
 * (AAAA-MM-DD, opcional), fotoEtiqueta (opcional, solo vacunas). El
 * `mascotaId` sale de la URL.
 * Responde 201 con el RegistroSanitario, 400 si el id o un dato no es
 * válido, 403 si no está asignado, 404 si la mascota no existe o 500.
 */
mascotasRouter.post('/:id/registros', async (req, res) => {
  const mascotaId = parseId(req.params.id);
  if (mascotaId === null) {
    responderError(res, 400, MENSAJE_ID_INVALIDO);
    return;
  }
  try {
    const permiso = await chequearMascota(mascotaId, req.usuarioId);
    if (permiso) {
      responderError(res, permiso.status, permiso.error);
      return;
    }
    const datos = leerRegistroNuevo(req.body);
    if (!datos.ok) {
      responderError(res, 400, datos.error);
      return;
    }
    const registro = await prisma.registroSanitario.create({ data: { ...datos.datos, mascotaId } });
    res.status(201).json(aRegistro(registro));
  } catch (error) {
    responderErrorInterno(res, error, 'POST /api/mascotas/:id/registros');
  }
});

/**
 * POST /api/mascotas/:id/invitaciones: genera un código de asignación de 8
 * caracteres, de un solo uso. Solo lo puede hacer un dueño.
 * Body: rol ('dueno' o 'invitado'), el rol con que queda quien lo acepte.
 * Responde 201 con la Invitacion, 400 si el id o el rol no es válido, 403 si
 * no es dueño, 404 si la mascota no existe o 500.
 */
mascotasRouter.post('/:id/invitaciones', async (req, res) => {
  const mascotaId = parseId(req.params.id);
  if (mascotaId === null) {
    responderError(res, 400, MENSAJE_ID_INVALIDO);
    return;
  }
  try {
    const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId } });
    if (!mascota) {
      responderError(res, 404, MENSAJE_MASCOTA_NO_EXISTE);
      return;
    }
    const rolPropio = await rolEn(mascotaId, req.usuarioId);
    if (rolPropio !== 'dueno') {
      const mensaje = rolPropio
        ? `Solo un dueño de ${mascota.nombre} puede asignar a otras personas.`
        : MENSAJE_SIN_PERMISO_MASCOTA;
      responderError(res, 403, mensaje);
      return;
    }
    const rol = leerCuerpo(() => {
      const { rol: valor } = pick(req.body, ['rol']);
      if (!esValorDe(ROLES_MASCOTA, valor)) throw new DatoInvalido('Elegí el rol de la persona.');
      return valor;
    });
    if (!rol.ok) {
      responderError(res, 400, rol.error);
      return;
    }
    const invitacion = await prisma.invitacion.create({
      data: {
        token: await generarToken(),
        mascotaId,
        rol: rol.datos,
        creadaPorId: req.usuarioId,
      },
      include: INCLUIR_MASCOTA_INVITACION,
    });
    res.status(201).json(aInvitacion(invitacion));
  } catch (error) {
    responderErrorInterno(res, error, 'POST /api/mascotas/:id/invitaciones');
  }
});

/**
 * DELETE /api/mascotas/:id/cuidadores/me: desasigna al usuario de la mascota.
 * El último dueño no se puede ir: la mascota no puede quedar sin nadie que la
 * administre. El chequeo y el borrado van en una transacción.
 * Responde 204 sin body, 400 si el id no es válido, 403 si no está asignado,
 * 404 si la mascota no existe, 409 si es el único dueño o 500.
 */
mascotasRouter.delete('/:id/cuidadores/me', async (req, res) => {
  const mascotaId = parseId(req.params.id);
  if (mascotaId === null) {
    responderError(res, 400, MENSAJE_ID_INVALIDO);
    return;
  }
  try {
    const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId }, select: { id: true } });
    if (!mascota) {
      responderError(res, 404, MENSAJE_MASCOTA_NO_EXISTE);
      return;
    }
    const resultado = await prisma.$transaction(async (tx) => {
      const rol = await rolEn(mascotaId, req.usuarioId, tx);
      if (!rol) return 'no-asignado';
      if (rol === 'dueno') {
        const duenos = await tx.cuidador.count({ where: { mascotaId, rol: 'dueno' } });
        if (duenos === 1) return 'unico-dueno';
      }
      await tx.cuidador.delete({
        where: { mascotaId_usuarioId: { mascotaId, usuarioId: req.usuarioId } },
      });
      return 'desasignado';
    });
    if (resultado === 'no-asignado') {
      responderError(res, 403, MENSAJE_NO_ASIGNADO);
    } else if (resultado === 'unico-dueno') {
      responderError(res, 409, MENSAJE_UNICO_DUENO);
    } else {
      res.status(204).end();
    }
  } catch (error) {
    responderErrorInterno(res, error, 'DELETE /api/mascotas/:id/cuidadores/me');
  }
});
