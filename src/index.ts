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
import { usuarioActual } from './middlewares/usuarioActual';
import { cuidadoresRouter } from './rutas/cuidadores';
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

// Todas las rutas de abajo necesitan saber quién pide (TODO Etapa 4: sesión real).
app.use('/api', usuarioActual);

app.use('/api/usuarios', usuariosRouter);
app.use('/api/mascotas', mascotasRouter);
app.use('/api/registros', registrosRouter);
app.use('/api/turnos', turnosRouter);
app.use('/api/reportes', reportesRouter);
app.use('/api/cuidadores', cuidadoresRouter);
app.use('/api/invitaciones', invitacionesRouter);

// --- Servidor ---

const puerto = Number(process.env.PORT) || PUERTO_POR_DEFECTO;

app.listen(puerto, '0.0.0.0', () => {
  console.log(`API de Doggy escuchando en http://0.0.0.0:${puerto}`);
});
