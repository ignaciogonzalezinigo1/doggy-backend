# Doggy Backend

API de **Doggy**, la app móvil para el cuidado y la seguridad de tu perro: mascotas de la familia, carnet sanitario, turnos y reportes de perros perdidos o encontrados.

Proyecto de la materia Programación de Aplicaciones Móviles (UCA). Sprint 2: backend.

La app (Expo + React Native) está en otro repositorio: **[doggy](https://github.com/ignaciogonzalezinigo1/doggy)**. Le habla a esta API por HTTP.

## Integrantes

- Ignacio Gonzalez Iñigo y Juan Federico Rosenfeld

## Stack

- Node + Express 5 con TypeScript estricto (se corre con `tsx`)
- Prisma 7 con SQLite (adapter `@prisma/adapter-better-sqlite3`)
- `cors` para que la app pueda llamar a la API

```
doggy (app) ──HTTP──► Express → Prisma → SQLite
```

## Cómo correrlo

Requisitos: Node LTS.

```bash
npm install
cp .env.example .env
npm run db:init
npm run db:seed
npm run dev
```

La API queda en `http://localhost:3000`. Para probar que anda: `http://localhost:3000/api/health` responde `{ "ok": true }`.

Escucha en `0.0.0.0`, así que el celular la alcanza por la IP local de la PC (misma red Wi-Fi). En la app, configurá `EXPO_PUBLIC_API_URL` con esa IP (por ejemplo `http://192.168.0.10:3000`); los detalles están en el README de `doggy`.

Conviene clonar los dos repos uno al lado del otro:

```
carpeta-de-trabajo/
├── doggy/            la app
└── doggy-backend/    este repo (la API)
```

### Variables de entorno

| Variable | Default | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | Archivo de la base SQLite |
| `PORT` | `3000` | Puerto de la API |

### Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Levanta la API y la reinicia al guardar cambios |
| `npm run db:init` | Aplica el schema a la base (`prisma db push`) y genera el cliente |
| `npm run db:seed` | Carga los datos de ejemplo |
| `npm run db:reset` | Borra la base, la vuelve a crear y carga los datos de ejemplo |
| `npm run studio` | Abre Prisma Studio para ver y editar la base |

## Endpoints

| Método | Ruta | Respuesta |
| --- | --- | --- |
| GET | `/api/health` | `200 { "ok": true }` |

Los errores llegan siempre como `{ "error": "mensaje en español" }`. El contrato completo con la app (endpoints previstos y códigos de estado) está en `CLAUDE.md`.

## Estructura

```
doggy-backend/
├── prisma/
│   ├── schema.prisma     modelo de datos
│   └── seed.ts           datos de ejemplo
├── prisma.config.ts      configuración de la CLI de Prisma (URL de la base, seed)
└── src/
    ├── index.ts          app de Express y rutas
    ├── lib/prisma.ts     cliente de Prisma con el adapter de SQLite
    └── generated/        cliente generado por Prisma (no se versiona)
```
