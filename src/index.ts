/**
 * Punto de entrada de la API de Doggy.
 *
 * Arma la app de Express, registra los middlewares globales y las rutas, y
 * escucha en 0.0.0.0 para que la app pueda llegar desde el celular por la IP
 * local de la PC.
 */

import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { manejarErrores, rutaInexistente } from './middlewares/manejarErrores';
import { requiereUsuario } from './middlewares/requiereUsuario';
import { authRouter } from './rutas/auth';
import { CARPETA_UPLOADS } from './lib/fotos';
import { cuidadoresRouter } from './rutas/cuidadores';
import { fotosRouter } from './rutas/fotos';
import { invitacionesRouter } from './rutas/invitaciones';
import { mascotasRouter } from './rutas/mascotas';
import { registrosRouter } from './rutas/registros';
import { reportesRouter } from './rutas/reportes';
import { turnosRouter } from './rutas/turnos';
import { usuariosRouter } from './rutas/usuarios';

/** Puerto por defecto si el .env no define PORT. */
const PUERTO_POR_DEFECTO = 3000;

const app = express();

// --- Middlewares (siempre antes de las rutas) ---

// Permite que la app (Expo en el celular o en el navegador) llame a la API.
app.use(cors());
// Parsea el body JSON; sin esto, req.body llega undefined.
app.use(express.json());

// --- Rutas ---

/**
 * GET /api/health: chequeo rápido de que el servidor está levantado.
 * Responde 200 con { ok: true }.
 */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

/**
 * GET /uploads/<nombre>: fotos subidas. Son públicas (sin token) para que el
 * componente Image de la app las pueda cargar sin headers. `nosniff` evita
 * que el navegador interprete un archivo como otra cosa que una imagen.
 */
app.use(
  '/uploads',
  express.static(CARPETA_UPLOADS, {
    index: false,
    dotfiles: 'ignore',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }),
);

// Registro y login son públicos; logout pide sesión adentro del router.
app.use('/api/auth', authRouter);

// Todas las rutas de abajo exigen `Authorization: Bearer <token>` (401 si no).
app.use('/api', requiereUsuario);

app.use('/api/usuarios', usuariosRouter);
app.use('/api/mascotas', mascotasRouter);
app.use('/api/registros', registrosRouter);
app.use('/api/turnos', turnosRouter);
app.use('/api/reportes', reportesRouter);
app.use('/api/cuidadores', cuidadoresRouter);
app.use('/api/invitaciones', invitacionesRouter);
app.use('/api/fotos', fotosRouter);

// --- Errores (siempre después de las rutas) ---

// Ninguna ruta respondió: una ruta que no existe, un método que no corresponde
// (por ejemplo, PUT) o un archivo de /uploads que no está (express.static deja
// pasar los que no encuentra). Las de /api sin token ya respondieron 401.
app.use(rutaInexistente);

// JSON mal formado, body demasiado grande o cualquier error sin atrapar:
// responde { error } en español en vez de la página HTML de Express.
app.use(manejarErrores);

// --- Servidor ---

const puerto = Number(process.env.PORT) || PUERTO_POR_DEFECTO;

/**
 * Express 5 llama a este callback también cuando no pudo escuchar, con el
 * error como argumento. Si el puerto está ocupado (casi siempre otro
 * `npm run dev` abierto), avisa y termina en vez de quedar sin escuchar.
 */
app.listen(puerto, '0.0.0.0', (error?: Error) => {
  if (!error) {
    console.log(`API de Doggy escuchando en http://0.0.0.0:${puerto}`);
    return;
  }
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(
      `El puerto ${puerto} ya está en uso: seguramente hay otra API de Doggy (u otro programa) corriendo. ` +
        'Cerrala o cambiá PORT en el .env (y el puerto de EXPO_PUBLIC_API_URL en la app).',
    );
  } else {
    console.error('No se pudo levantar la API:', error);
  }
  process.exit(1);
});
