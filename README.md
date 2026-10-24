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

### Usuarios de prueba

El seed carga los mismos datos que la app tiene de ejemplo (`doggy/mobile/src/data/mock.ts`), con los mismos ids. **Todos los usuarios tienen la contraseña `doggy1234`.**

| Usuario | Email | Para qué sirve |
| --- | --- | --- |
| Sofía Romero | `sofia.romero@mail.com` | La usuaria principal de la demo: tutora de Luna, Roco y Milo |
| Lucía Gómez | `lucia.gomez@mail.com` | Tutora de Toby; generó el código de asignación `TOBY2026` para Sofía |
| Carlos Romero | `carlos.romero@mail.com` | Co-tutor (dueño) de Luna |
| Sol Romero | `sol.romero@mail.com` | Dueña de Milo (hogar secundario) |
| Marcos Díaz | `marcos.diaz@mail.com` | Paseador de Roco (invitado) |
| Vet. San Roque | `contacto@vetsanroque.com` | Clínica asignada a Luna (invitada) |
| Martín López | `martin.lopez@mail.com` | Autor del reporte de Simba (perdido) |
| Valentina Pérez | `valentina.perez@mail.com` | Autora del reporte del perro encontrado en Belgrano |
| Julián Fernández | `julian.fernandez@mail.com` | Autor del reporte de Nieve (perdida) |

Las fechas de los reportes se calculan desde el momento en que corre el seed, así "hace 2 h" siempre tiene sentido; turnos, registros y la invitación tienen fechas fijas, como en la app.

### Resetear la base

```bash
npm run db:reset
```

Borra `dev.db`, la vuelve a crear con el schema actual, regenera el cliente y carga el seed. Sirve para volver a la demo limpia o después de cambiar el schema de forma incompatible. Para recargar solo los datos sin tocar las tablas: `npm run db:seed` (borra los datos y los vuelve a cargar).

### Variables de entorno

| Variable | Default | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | Archivo de la base SQLite |
| `PORT` | `3000` | Puerto de la API |
| `UPLOADS_DIR` | `uploads` | Carpeta de las fotos subidas (las pruebas usan una temporal) |

### Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Levanta la API y la reinicia al guardar cambios |
| `npm run db:init` | Aplica el schema a la base (`prisma db push`) y genera el cliente |
| `npm run db:seed` | Carga los datos de ejemplo |
| `npm run db:reset` | Borra la base, la vuelve a crear y carga los datos de ejemplo |
| `npm run studio` | Abre Prisma Studio para ver y editar la base |
| `npm test` | Prueba todos los endpoints contra una base aparte (`test.db`) y la API en el puerto 3001, sin tocar `dev.db` (ver [Pruebas](#pruebas)) |

## Endpoints

### Sesión

Registro y login devuelven `{ "usuario": Usuario, "token": "..." }`. Todas las demás rutas (salvo `/api/health`) piden ese token en el header:

```
Authorization: Bearer <token>
```

Sin el header, con un token que no existe, vencido (duran 30 días) o cerrado con el logout, responden **401** y la app vuelve al login. El token es aleatorio y el servidor guarda solo su hash en la tabla `Sesion`; el logout borra esa fila.

| Método | Ruta | Body | Respuestas |
| --- | --- | --- | --- |
| POST | `/api/auth/registro` | `nombre`, `apellido`, `email`, `password` | 201 `{ usuario, token }` · 400 · 409 email ya registrado |
| POST | `/api/auth/login` | `email`, `password` | 200 `{ usuario, token }` · 400 · 401 "Email o contraseña incorrectos" |
| POST | `/api/auth/logout` | — (con el header) | 204 · 401 |

La contraseña nueva tiene de 8 a 64 caracteres, sin espacios, con al menos una letra y un número; nombre y apellido, solo letras. El email se guarda en minúsculas. La cuenta nueva queda con `ubicacion` y `telefonoEmergencia` vacíos, para completar desde Editar perfil (`PATCH /api/usuarios/me`).

### Recursos

Todas piden `Authorization: Bearer <token>` y pueden responder 401. "Asignado" quiere decir que el usuario de la sesión es dueño o invitado de esa mascota.

| Método | Ruta | Body | Respuestas |
| --- | --- | --- | --- |
| GET | `/api/health` | — (pública) | 200 `{ "ok": true }` |
| GET | `/api/usuarios/me` | — | 200 Usuario · 404 |
| POST | `/api/fotos` | multipart/form-data con el archivo en el campo `foto` (JPG, PNG o WEBP, hasta 5 MB) | 201 `{ "foto": "/uploads/<nombre>.jpg" }` · 400 no vino o no es una imagen válida · 413 pesa más de 5 MB |
| GET | `/uploads/<nombre>` | — (pública, sin token) | 200 la imagen · 404 |
| PATCH | `/api/usuarios/me` | `nombre`, `apellido`, `email`, `ubicacion`, `telefonoEmergencia`, `foto` | 200 Usuario · 400 · 404 · 409 email de otra cuenta |
| GET | `/api/mascotas` | — | 200 Mascota[] (las asignadas) |
| POST | `/api/mascotas` | `nombre`, `raza`, `edad`, `senas`, `foto` | 201 Mascota (con código `DOGGY-XXXX-NOMBRE`; el usuario queda como dueño) · 400 |
| PATCH | `/api/mascotas/:id` | los mismos, opcionales (el código no cambia) | 200 Mascota · 400 · 403 · 404 |
| GET | `/api/registros` | — | 200 RegistroSanitario[] |
| POST | `/api/mascotas/:id/registros` | `tipo`, `nombre`, `fecha` (AAAA-MM-DD), `profesional`, `proximaDosis`, `fotoEtiqueta` | 201 RegistroSanitario · 400 · 403 · 404 |
| PATCH | `/api/registros/:id` | los mismos, opcionales (`null` borra los opcionales) | 200 RegistroSanitario · 400 · 403 · 404 |
| DELETE | `/api/registros/:id` | — | 204 · 400 · 403 · 404 |
| GET | `/api/turnos` | — | 200 Turno[] |
| POST | `/api/turnos` | `mascotaId`, `categoria`, `fecha` (ISO con hora, a futuro), `motivo`, `lugar` | 201 Turno · 400 · 403 · 404 |
| PATCH | `/api/turnos/:id` | los mismos, opcionales ("a futuro" solo si cambia la fecha) | 200 Turno · 400 · 403 · 404 |
| DELETE | `/api/turnos/:id` | — | 204 · 400 · 403 · 404 |
| GET | `/api/reportes` | — | 200 ReportePerdida[] (solo los activos) |
| POST | `/api/reportes` | `estado`, `mascotaId`, `nombre`, `raza`, `descripcion`, `foto`, `etiquetas`, `lat`, `lng`, `zona`, `fecha`, `radioMetros`, `infoAdicional` | 201 ReportePerdida · 400 · 403 · 404 · 409 ya tiene uno de pérdida activo |
| PATCH | `/api/reportes/:id` | contenido opcional (las `etiquetas` se reemplazan todas) o `{ "cerrado": true }` para cerrarlo | 200 ReportePerdida · 400 · 403 no es el autor ni está asignado a la mascota · 404 · 409 ya cerrado |
| GET | `/api/cuidadores` | — | 200 Cuidador[] |
| DELETE | `/api/mascotas/:id/cuidadores/me` | — | 204 · 400 · 403 · 404 · 409 único dueño |
| POST | `/api/mascotas/:id/invitaciones` | `rol` | 201 Invitacion (8 caracteres, vence a 7 días) · 400 · 403 no es dueño · 404 |
| GET | `/api/invitaciones/:token` | — | 200 Invitacion · 400 · 404 · 410 usado o vencido |
| POST | `/api/invitaciones/:token/aceptar` | — | 200 Cuidador · 400 · 404 · 409 ya asignado · 410 |

Los errores llegan siempre como `{ "error": "mensaje en español" }` y cualquier ruta puede responder 500 si algo falla en el servidor. Los DELETE responden 204 sin body. Las reglas completas (permisos, validaciones y el contrato con la app) están en `CLAUDE.md`.

### Fotos

Las fotos se suben aparte: la app primero hace `POST /api/fotos` y después manda la ruta que le devolvió en el campo `foto` (o `fotoEtiqueta`) de la mascota, el perfil, el reporte o el registro.

- El archivo se guarda en `uploads/` con un nombre aleatorio (32 caracteres hex) y se sirve público en `/uploads/<nombre>`, así el componente `Image` de la app lo carga sin header. La carpeta está ignorada en git (se versiona solo el `.gitkeep`).
- El tipo se valida por los primeros bytes del archivo (la firma de JPG, PNG o WEBP), no por el nombre ni el tipo que manda el cliente.
- En la base se guarda la ruta relativa (`/uploads/abc.jpg`), nunca la URL completa: la IP de la PC cambia, y la app arma la URL con su `API_URL`.
- Los campos de foto solo aceptan `null`, una clave de las fotos del seed (`luna`, `roco`, `milo`, `simba`, `sin-collar`, `sofia`, `carlos`) o una ruta `/uploads/` cuyo archivo exista. Una URI del celular (`file://`, `content://`, `blob:`) da 400.
- Cuando una foto se reemplaza o se borra (también al borrar un registro o cuando deja de ser vacuna), se borra su archivo si ningún otro registro lo usa. Cerrar un reporte no borra su foto: queda como historial.

Para probar a mano, primero hacé login y después usá el token:

```bash
curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"sofia.romero@mail.com","password":"doggy1234"}'

curl -X POST http://localhost:3000/api/mascotas -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"nombre":"Pampa","raza":"Mestizo","edad":2,"senas":"Mancha blanca en el pecho"}'

curl -X POST http://localhost:3000/api/fotos -H 'Authorization: Bearer <token>' -F 'foto=@perro.jpg'
```

## Pruebas

```bash
npm test
```

Corre `scripts/probar.sh`, que prueba la API con `curl`:

1. Resetea su propia base, `test.db`, con `npm run db:reset` (la borra, la vuelve a crear y carga los datos del seed). El script exporta `DATABASE_URL=file:./test.db` antes del reset y del servidor, así que **`dev.db` no se toca nunca**: los datos con los que probás la app quedan como estaban. `test.db` está ignorada en git, como todas las `*.db`.
2. Levanta la API en el puerto 3001, así no choca con `npm run dev` en el 3000 (si el 3001 está ocupado, avisa y no corre). Las fotos que sube van a una carpeta temporal (`UPLOADS_DIR`), no a `uploads/`.
3. Hace login con Sofía, Lucía y Carlos (contraseña `doggy1234`) y usa sus tokens. Prueba el registro, el login, el logout y los 401 (sin token, token inválido, vencido o cerrado), y los permisos entre usuarios distintos (Sofía no toca lo de Toby, Lucía no toca lo de Sofía, una cuenta nueva no ve nada).
4. Prueba todos los endpoints con sus casos de error: datos inválidos, ids inválidos, mascotas ajenas, recursos que no existen, conflictos y códigos vencidos o usados. También chequea partes del contenido de algunas respuestas (que no salga `passwordHash`, que el código de la mascota no cambie, que un reporte cerrado no aparezca, etc.). Las fotos se prueban con archivos mínimos que arma el script: subida válida de cada formato, un texto con extensión `.jpg`, una de más de 5 MB, sin token, rutas inválidas en los PATCH y que el archivo viejo se borre solo cuando nadie más lo usa.
5. Muestra una tabla con el endpoint, el caso, el status esperado y el obtenido, marca en rojo los que fallan y al final lista cada falla con la respuesta del servidor. Sale con código 1 si algo falla.
6. Baja el servidor al terminar.

Necesita `curl` y `sqlite3` (vienen con macOS), el `.env` y las dependencias instaladas. Algunos casos se preparan insertando filas directo en la base con `sqlite3` (por ejemplo, un código de asignación vencido o un reporte publicado por otro usuario). Para sumar un caso: `t "<caso>" <status esperado> <método> <ruta> '<body JSON>'`; el pedido sale con el token elegido antes con `como "$SOFIA"` (o `como ""` para probar sin sesión), y para chequear un valor de esa respuesta, `v "<caso>" <esperado> "$(jget .campo)"`. Para subir un archivo: `subir "<caso>" <status esperado> <archivo>`.

## Estructura

```
doggy-backend/
├── prisma/
│   ├── schema.prisma     modelo de datos
│   └── seed.ts           datos de ejemplo
├── prisma.config.ts      configuración de la CLI de Prisma (URL de la base, seed)
├── uploads/              fotos subidas (no se versionan, salvo el .gitkeep)
├── scripts/
│   └── probar.sh         pruebas de todos los endpoints con curl (npm test)
└── src/
    ├── index.ts          app de Express y montaje de las rutas
    ├── rutas/            una por recurso (mascotas, registros, turnos, reportes, invitaciones, fotos…)
    ├── cuerpos/          lectura y validación del body de cada recurso
    ├── validaciones.ts   reglas de validación, las mismas que la app
    ├── respuestas.ts     conversión de los modelos al JSON que espera la app
    ├── dominio.ts        valores válidos de los campos fijos (roles, estados, categorías, radios)
    ├── lib/              Prisma, sesiones, permisos, fotos, lectura del request, errores y códigos generados
    ├── middlewares/      requiereUsuario: lee el token y pone el usuario de la sesión (401 si no hay)
    └── generated/        cliente generado por Prisma (no se versiona)
```
