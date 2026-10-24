/**
 * Ruta para subir fotos.
 *
 * La app sube primero la foto y después manda la ruta que le devolvimos en el
 * campo `foto` (o `fotoEtiqueta`) de la mascota, el perfil, el reporte o el
 * registro. El archivo se lee en memoria con multer (tope de 5 MB), se valida
 * por su firma y recién ahí se escribe en la carpeta de uploads.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { responderError, responderErrorInterno } from '../lib/errores';
import { detectarFormato, guardarFoto, PESO_MAXIMO_FOTO } from '../lib/fotos';

export const fotosRouter = Router();

/** Campo del multipart donde viene el archivo. */
const CAMPO_FOTO = 'foto';

/** Status cuando el archivo pesa más de lo permitido (Payload Too Large). */
const STATUS_MUY_GRANDE = 413;

const MENSAJE_SIN_FOTO = 'No llegó ninguna foto. Elegí una y probá de nuevo.';
const MENSAJE_TIPO_INVALIDO = 'La foto tiene que ser JPG, PNG o WEBP.';
const MENSAJE_MUY_GRANDE = 'La foto puede pesar hasta 5 MB.';

/** Multer en memoria: un solo archivo, con tope de peso. */
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PESO_MAXIMO_FOTO, files: 1 },
}).single(CAMPO_FOTO);

/**
 * Corre multer y traduce sus errores a nuestras respuestas: 413 si pesa
 * demasiado y 400 para cualquier otro problema del multipart.
 * @param req pedido
 * @param res respuesta
 * @param next sigue a la ruta si el archivo se leyó bien
 */
function leerArchivo(req: Request, res: Response, next: NextFunction): void {
  subida(req, res, (error: unknown) => {
    if (!error) {
      next();
    } else if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      responderError(res, STATUS_MUY_GRANDE, MENSAJE_MUY_GRANDE);
    } else if (error instanceof multer.MulterError) {
      responderError(res, 400, MENSAJE_SIN_FOTO);
    } else {
      responderErrorInterno(res, error, 'POST /api/fotos (multer)');
    }
  });
}

/**
 * POST /api/fotos: sube una foto.
 * Body: multipart/form-data con el archivo en el campo "foto".
 * Responde 201 con { foto: "/uploads/<nombre>.<jpg|png|webp>" }, 400 si no
 * vino el archivo o no es JPG, PNG ni WEBP, 401 sin sesión, 413 si pesa más
 * de 5 MB o 500.
 */
fotosRouter.post('/', leerArchivo, async (req, res) => {
  try {
    if (!req.file) {
      responderError(res, 400, MENSAJE_SIN_FOTO);
      return;
    }
    const formato = detectarFormato(req.file.buffer);
    if (!formato) {
      responderError(res, 400, MENSAJE_TIPO_INVALIDO);
      return;
    }
    const foto = await guardarFoto(req.file.buffer, formato);
    res.status(201).json({ foto });
  } catch (error) {
    responderErrorInterno(res, error, 'POST /api/fotos');
  }
});
