# Doggy Backend

API de **Doggy**, la app móvil para el cuidado y la seguridad de tu perro: mascotas de la familia, carnet sanitario, turnos, reportes de perros perdidos o encontrados en un mapa colaborativo y un QR de identificación en la chapita.

Proyecto de la materia Programación de Aplicaciones Móviles (UCA), Sprint 2. Guarda los datos de la app, maneja las cuentas y las sesiones, controla quién puede ver y modificar cada cosa y recibe las fotos.

La app (Expo + React Native) está en otro repositorio: **[doggy](https://github.com/ignaciogonzalezinigo1/doggy)**. Le habla a esta API por HTTP. En el README de `doggy` está cómo levantar todo junto, de punta a punta.

## Integrantes

- Ignacio Gonzalez Iñigo y Juan Federico Rosenfeld

## Stack

- Node + **Express 5** con TypeScript estricto (se corre con `tsx`, sin compilar)
- **Prisma 7** con **SQLite** (adapter `@prisma/adapter-better-sqlite3`)
- `bcryptjs` para las contraseñas, `node:crypto` para los tokens de sesión
- `multer` para recibir las fotos (`multipart/form-data`)
- `cors` para que la app pueda llamar a la API

```
doggy (app) ──HTTP/JSON──► Express ──► Prisma ──► SQLite (dev.db)
                           recibe,     modelo y    guarda
                           valida y    consultas
                           decide
```

- **Express** recibe el pedido, valida los datos, chequea la sesión y los permisos, elige el status y arma la respuesta.
- **Prisma** define el modelo (`prisma/schema.prisma`) y hace las consultas con el cliente de `src/lib/prisma.ts`. No valida reglas de negocio.
- **SQLite** guarda todo en un archivo, `dev.db`, que no se versiona.

## Cómo correrlo

Requisitos: Node LTS. Para las pruebas, además, `bash` y `curl` (vienen con macOS y, en Windows, con Git Bash).

```bash
cp .env.example .env # primero: el postinstall de npm ci lo necesita
npm ci               # también genera el cliente de Prisma (postinstall)
npm run db:reset     # crea dev.db con el schema y carga los datos de ejemplo
npm run dev
```

Se usa `npm ci` y no `npm install` porque instala exactamente las versiones del `package-lock.json` sin reescribirlo: todos tienen las mismas dependencias y no aparecen cambios de lockfile por la versión de npm de cada PC. Después de cada pull que cambie dependencias, otra vez `npm ci`.

El `.env` va antes de `npm ci` porque el `postinstall` corre `prisma generate`, y Prisma 7 lee `DATABASE_URL` de `prisma.config.ts` aunque solo vaya a generar el cliente. Sin el `.env` falla con `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`; se arregla copiando el `.env` y corriendo `npx prisma generate` (o `npm ci` de nuevo).

La API queda en `http://localhost:3000`. Para probar que anda: `http://localhost:3000/api/health` responde `{ "ok": true }`.

Escucha en `0.0.0.0`, así que el celular la alcanza por la IP local de la PC (misma red Wi-Fi). En la app, poné esa IP en `EXPO_PUBLIC_API_URL` (por ejemplo `http://192.168.0.10:3000`); los detalles, y los errores comunes de conexión, están en el README de `doggy`.

Conviene clonar los dos repos uno al lado del otro:

```
carpeta-de-trabajo/
├── doggy/            la app
└── doggy-backend/    este repo (la API)
```

### Usuarios de prueba

El seed (`prisma/seed.ts`) carga los datos de la demo; es la única fuente de esos datos, porque la app no tiene datos propios. Las fotos usan las claves de las imágenes empaquetadas en la app (`luna`, `sofia`, …). **Todos los usuarios tienen la contraseña `doggy1234`.**

| Usuario | Email | Para qué sirve |
| --- | --- | --- |
| Sofía Romero | `sofia.romero@mail.com` | La usuaria principal de la demo: tutora de Luna, Roco y Milo |
| Lucía Gómez | `lucia.gomez@mail.com` | Tutora de Toby; generó el código de asignación `TOBY2026` para Sofía |
| Carlos Romero | `carlos.romero@mail.com` | Co-tutor (dueño) de Luna |
| Sol Romero | `sol.romero@mail.com` | Dueña de Milo (hogar secundario) |
| Marcos Díaz | `marcos.diaz@mail.com` | Paseador de Roco (invitado) |
| Vet. San Roque | `contacto@vetsanroque.com` | Clínica asignada a Luna (invitada) |
| Martín López | `martin.lopez@mail.com` | Autor del reporte de Simba (perdido) |
| Valentina Pérez | `valentina.perez@mail.com` | Autora del reporte del perro encontrado en Belgrano y del de Milo, que encontró escaneando su chapita (Sofía ve "¡Encontraron a Milo!" con su contacto) |
| Julián Fernández | `julian.fernandez@mail.com` | Autor del reporte de Nieve (perdida) |

Las fechas de los reportes y los turnos se calculan desde el momento en que corre el seed, así "hace 2 h" siempre tiene sentido y los turnos no quedan viejos; los registros del carnet tienen fechas fijas.

### Variables de entorno

| Variable | Default | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | Archivo de la base SQLite. Sin ella la API no arranca ("Falta DATABASE_URL en el .env") |
| `PORT` | `3000` | Puerto de la API |
| `UPLOADS_DIR` | `uploads` | Carpeta de las fotos subidas (las pruebas usan una temporal) |

No hay claves secretas: el token de sesión es aleatorio y se valida contra la base, así que no hace falta un secreto para firmarlo.

### Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Levanta la API y la reinicia al guardar cambios (`tsx watch`) |
| `npm run db:init` | Aplica el schema a la base (`prisma db push`) y genera el cliente |
| `npm run db:seed` | Borra los datos y vuelve a cargar los de ejemplo, sin tocar las tablas |
| `npm run db:reset` | Borra la base, la vuelve a crear con el schema actual, genera el cliente y carga el seed |
| `npm run db:migrar-fecha-nacimiento` | Pasa una base vieja de `edad` a `fechaNacimiento` sin perder filas (ver abajo) |
| `npm run db:normalizar-telefonos` | Pasa a E.164 los teléfonos que ya están en la base; los que no entiende los deja como están |
| `npm run studio` | Abre Prisma Studio para ver y editar la base (ver [Prisma Studio](#prisma-studio)) |
| `npm test` | Prueba todos los endpoints contra una base aparte (`test.db`) y la API en el puerto 3001, sin tocar `dev.db` (ver [Pruebas](#pruebas)) |

`db:reset` sirve para volver a la demo limpia o después de cambiar el schema de forma incompatible. En Prisma 7, `db push` no genera el cliente solo: por eso los scripts encadenan `prisma generate`.

**Si ya tenías una `dev.db` de antes de que los códigos de asignación dejaran de vencer** (se sacó la columna `Invitacion.vence`), después del pull corré:

```bash
npx prisma db push --accept-data-loss   # borra solo la columna Invitacion.vence; el resto de los datos queda
npx prisma generate
```

`npm run db:init` no alcanza: corre `db push` sin `--accept-data-loss` y Prisma se frena porque la columna tiene datos. La otra opción es `npm run db:reset`, que vuelve a la demo limpia (y suma los datos nuevos del seed, como el reporte "encontrado" de Milo).

**Si ya tenías una `dev.db` de antes de la fecha de nacimiento y los teléfonos en E.164**, después del pull (y de `npm ci`, que suma libphonenumber-js) corré, en este orden:

```bash
cp dev.db dev.db.respaldo                # por las dudas
npm run db:migrar-fecha-nacimiento       # suma fechaNacimiento (hoy menos la edad), saca edad y Invitacion.vence si quedaba
npm run db:normalizar-telefonos          # pasa los teléfonos a E.164 y muestra el antes y el después
```

Conservan todas las filas. Con `db push` solo no alcanza: no puede crear `fechaNacimiento` obligatoria sin valor para las mascotas que ya están. Si preferís empezar de cero, `npm run db:reset` deja la demo limpia, pero **borra tus datos locales**.

### Prisma Studio

```bash
npm run studio
```

Abre Prisma Studio en `http://localhost:5555` con la base del `.env`. Se puede cambiar el puerto con `npm run studio -- --port 5556`.

No se usa `npx prisma studio` directo: con Prisma 7.10 responde *"Prisma Studio is not supported for the file:./dev.db protocol"*. Studio sí soporta SQLite, pero la CLI saca el protocolo cortando la URL en `://`, y `file:./dev.db` no lo tiene. Con una ruta absoluta (`file:///…/dev.db`) funciona, pero esa ruta cambia en cada PC y no puede ir en el `.env`. Por eso `npm run studio` corre `scripts/studio.ts`, que arma la URL absoluta a partir de `DATABASE_URL` y se la pasa a `prisma studio --url`. Probado en macOS; en Windows la ruta con `C:\` podría no pasar el mismo parseo.

### Prisma 7: qué cambia respecto de los ejemplos clásicos

- La URL de la base **no va en el `schema.prisma`**: va en `prisma.config.ts`, que lee `DATABASE_URL` del `.env` (importa `dotenv/config`, porque la CLI ya no lo carga sola).
- El generador es `prisma-client` (no `prisma-client-js`) y escribe el cliente en `src/generated/prisma`, que no se versiona. Se importa de ahí, no de `@prisma/client`.
- El cliente se conecta con un **driver adapter**: `new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })` (`src/lib/prisma.ts`).
- `db push` no genera el cliente; hay que correr `prisma generate` (lo hacen `db:init`, `db:reset` y el `postinstall`).
- El seed se configura en `prisma.config.ts` (`migrations.seed`), no en el `package.json`.

## Endpoints

Todas las rutas responden JSON. Los errores llegan siempre como `{ "error": "mensaje en español" }`, que la app muestra tal cual. Cualquier ruta puede responder **500** si algo falla en el servidor (el detalle queda en la consola, al cliente le llega un mensaje genérico). Los DELETE responden **204 sin body**. Para modificar se usa **PATCH, nunca PUT**: un campo que no viene no se toca, y para borrar un opcional se manda `null`.

**Sesión:** registro y login devuelven `{ "usuario": Usuario, "token": "..." }`. Las rutas marcadas con "Sí" piden ese token:

```
Authorization: Bearer <token>
```

Sin el header, con un token que no existe, vencido (duran 30 días) o cerrado con el logout, responden **401** y la app vuelve al login. "Asignado" quiere decir que el usuario de la sesión es dueño o invitado de esa mascota.

| Verbo | Ruta | Body | Status posibles | Sesión |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | — | 200 `{ "ok": true }` | No |
| POST | `/api/auth/registro` | `nombre`, `apellido`, `email`, `telefonoEmergencia` (obligatorio; se guarda en E.164), `password` | 201 `{ usuario, token }` · 400 (también sin teléfono o con uno inválido) · 409 email ya registrado | No |
| POST | `/api/auth/login` | `email`, `password` | 200 `{ usuario, token }` · 400 · 401 "Email o contraseña incorrectos" | No |
| POST | `/api/auth/logout` | — | 204 · 401 | Sí |
| GET | `/api/usuarios/me` | — | 200 Usuario · 401 · 404 | Sí |
| PATCH | `/api/usuarios/me` | opcionales: `nombre`, `apellido`, `email`, `ubicacion`, `telefonoEmergencia` (cualquier formato habitual; se guarda en E.164), `foto` | 200 Usuario · 400 · 401 · 404 · 409 email de otra cuenta | Sí |
| POST | `/api/fotos` | `multipart/form-data`, archivo en el campo `foto` (JPG, PNG o WEBP, hasta 5 MB) | 201 `{ "foto": "/uploads/<nombre>.jpg" }` · 400 no vino o no es una imagen válida · 401 · 413 más de 5 MB | Sí |
| GET | `/uploads/<nombre>` | — | 200 la imagen · 404 | No |
| GET | `/api/mascotas` | — | 200 Mascota[] (las asignadas) · 401 | Sí |
| GET | `/api/mascotas/codigo/:codigo` | — (acepta minúsculas y espacios alrededor) | 200 `{ id, nombre, raza, edadMeses, senas, foto, codigo, dueno: { nombre, telefono? } }` (`edadMeses` calculada con la fecha de nacimiento, que no se manda; `telefono` en E.164) (`telefono` solo si la mascota tiene un `perdido` activo o el usuario está asignado) · 400 no es `DOGGY-XXXX-NOMBRE` · 401 · 404 | Sí |
| POST | `/api/mascotas` | `nombre`, `raza`, `fechaNacimiento` (AAAA-MM-DD, no futura ni de hace más de 30 años), `senas`, `foto` (opcional) | 201 Mascota (con código `DOGGY-XXXX-NOMBRE`; el usuario queda como dueño) · 400 · 401 | Sí |
| PATCH | `/api/mascotas/:id` | los mismos, opcionales (el código no cambia) | 200 Mascota · 400 · 401 · 403 no asignado · 404 | Sí |
| GET | `/api/registros` | — | 200 RegistroSanitario[] · 401 | Sí |
| POST | `/api/mascotas/:id/registros` | `tipo`, `nombre`, `fecha` (AAAA-MM-DD), `profesional`, `proximaDosis` (opcional), `fotoEtiqueta` (opcional, solo vacunas) | 201 RegistroSanitario · 400 · 401 · 403 · 404 | Sí |
| PATCH | `/api/registros/:id` | los mismos, opcionales (`null` borra `proximaDosis` y `fotoEtiqueta`) | 200 RegistroSanitario · 400 · 401 · 403 · 404 | Sí |
| DELETE | `/api/registros/:id` | — | 204 · 400 · 401 · 403 · 404 | Sí |
| GET | `/api/turnos` | — | 200 Turno[] · 401 | Sí |
| POST | `/api/turnos` | `mascotaId`, `categoria`, `fecha` (ISO con hora, a futuro), `motivo`, `lugar` | 201 Turno · 400 · 401 · 403 · 404 | Sí |
| PATCH | `/api/turnos/:id` | los mismos, opcionales ("a futuro" solo si cambia la fecha) | 200 Turno · 400 · 401 · 403 · 404 | Sí |
| DELETE | `/api/turnos/:id` | — | 204 · 400 · 401 · 403 · 404 | Sí |
| GET | `/api/reportes` | — | 200 ReportePerdida[] (solo los activos, de todos los usuarios; los `encontrado` de una mascota asignada al usuario que publicó otra persona suman `contacto: { nombre, telefono }`) · 401 | Sí |
| POST | `/api/reportes` | `estado`, `mascotaId`, `nombre`, `raza`, `descripcion`, `foto`, `etiquetas`, `lat`, `lng`, `zona`, `fecha`, `radioMetros` (solo perdidos), `infoAdicional` (opcional) | 201 ReportePerdida · 400 · 401 · 403 perdido de una mascota no asignada · 404 · 409 ya tiene uno activo del mismo estado (perdido: "Esta mascota ya está reportada como perdida…"; encontrado: "Ya le avisaron a su familia."). Con `mascotaId`, `nombre` y `raza` se toman de la mascota | Sí |
| PATCH | `/api/reportes/:id` | contenido opcional (las `etiquetas` se reemplazan todas) o `{ "cerrado": true }` para cerrarlo | 200 ReportePerdida · 400 · 401 · 403 no es el autor ni está asignado · 404 · 409 ya cerrado | Sí |
| GET | `/api/cuidadores` | — | 200 Cuidador[] · 401 | Sí |
| DELETE | `/api/mascotas/:id/cuidadores/me` | — | 204 · 400 · 401 · 403 · 404 · 409 único dueño | Sí |
| POST | `/api/mascotas/:id/invitaciones` | `rol` (`dueno` o `invitado`) | 201 Invitacion (8 caracteres, de un solo uso) · 400 · 401 · 403 no es dueño · 404 | Sí |
| GET | `/api/invitaciones/:token` | — | 200 Invitacion · 400 · 401 · 404 · 410 ya usado | Sí |
| POST | `/api/invitaciones/:token/aceptar` | — | 200 Cuidador · 400 · 401 · 404 · 409 ya asignado · 410 | Sí |

Las respuestas tienen exactamente la forma de los tipos de `doggy/mobile/src/types/models.ts`: ids numéricos, fechas como string ISO (las del carnet, `AAAA-MM-DD`) y relaciones por id. Las reglas completas (permisos, validaciones y el contrato con la app) están en `CLAUDE.md`.

### Códigos de estado

| Status | Cuándo |
| --- | --- |
| 200 | GET o PATCH salió bien |
| 201 | POST creó el recurso (se devuelve lo creado) |
| 204 | DELETE o logout salió bien, sin body |
| 400 | datos, id o código con formato inválido |
| 401 | sin sesión válida; login con email o contraseña incorrectos |
| 403 | con sesión, pero sin permiso sobre ese recurso |
| 404 | no existe |
| 409 | conflicto con el estado actual: email ya registrado, ya asignado, único dueño, reporte ya cerrado o mascota ya reportada |
| 410 | código de asignación ya usado |
| 413 | la foto pesa más de 5 MB, o el body JSON más de 100 KB |
| 500 | error imprevisto |

### Fotos

Las fotos se suben aparte: la app primero hace `POST /api/fotos` y después manda la ruta que le devolvió en el campo `foto` (o `fotoEtiqueta`) de la mascota, el perfil, el reporte o el registro.

- El archivo se guarda en `uploads/` con un nombre aleatorio (32 caracteres hex) y se sirve público en `/uploads/<nombre>`, así el componente `Image` de la app lo carga sin header. La carpeta está ignorada en git (se versiona solo el `.gitkeep`).
- En la base se guarda la ruta relativa (`/uploads/abc.jpg`), nunca la URL completa: la IP de la PC cambia, y la app arma la URL con su `API_URL`.
- Los campos de foto solo aceptan `null`, una clave de las fotos del seed (`luna`, `roco`, `milo`, `simba`, `sin-collar`, `sofia`, `carlos`) o una ruta `/uploads/` cuyo archivo exista. Una URI del celular (`file://`, `content://`, `blob:`) da 400.
- Cuando una foto se reemplaza o se borra (también al borrar un registro o cuando deja de ser vacuna), se borra su archivo si ningún otro registro lo usa. Cerrar un reporte no borra su foto: queda como historial.

### Probar a mano

Primero hacé login y después usá el token:

```bash
curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"sofia.romero@mail.com","password":"doggy1234"}'

curl -X POST http://localhost:3000/api/mascotas -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"nombre":"Pampa","raza":"Mestizo","fechaNacimiento":"2024-05-10","senas":"Mancha blanca en el pecho"}'

curl -X POST http://localhost:3000/api/fotos -H 'Authorization: Bearer <token>' -F 'foto=@perro.jpg'
```

## Modelo de datos

El modelo está en `prisma/schema.prisma`. Los nombres de modelos y campos son los mismos que los tipos de la app.

```
                 ┌──────────── Sesion (tokenHash, vence)
                 │
Usuario ─────────┼──< Cuidador >──────────┐            (tabla intermedia: rol dueno/invitado)
  │  │           │                         │
  │  │           └──< Invitacion >─────────┤            (código de asignación)
  │  │                                     │
  │  └──(tutorId)──< Mascota ──────────────┘
  │                    │
  │                    ├──< RegistroSanitario           (carnet)
  │                    ├──< Turno
  │                    └──< ReportePerdida (mascotaId opcional)
  │                              │
  └──(autorId)──────────────────<┘──< Etiqueta

──<  "uno a muchos"
```

| Tabla | Qué guarda | Relaciones |
| --- | --- | --- |
| `Usuario` | Cuenta: nombre, apellido, email (único), ubicación, foto, teléfono de emergencia, `passwordHash` | Tiene muchas sesiones, asignaciones (`Cuidador`), mascotas dadas de alta, reportes e invitaciones generadas |
| `Sesion` | `tokenHash` (SHA-256 del token, único), `vence` | Pertenece a un usuario (se borra con él) |
| `Mascota` | Nombre, raza, `fechaNacimiento` (sin hora; la edad se calcula), `codigo` (único, el del QR), señas, foto | Pertenece a su tutor (`tutorId`); tiene registros, turnos, cuidadores, reportes e invitaciones |
| `Cuidador` | `rol` (`dueno` / `invitado`), detalle y tipo del vínculo | Une `Usuario` y `Mascota` (muchos a muchos). `@@unique([mascotaId, usuarioId])`: una persona no se asigna dos veces |
| `Invitacion` | `token` (8 caracteres, clave primaria), `rol` ofrecido, `usada` (es de un solo uso: no vence) | Pertenece a una mascota y al dueño que la generó |
| `RegistroSanitario` | Tipo (vacuna, desparasitación, otro), nombre, fecha, profesional, próxima dosis, foto de la etiqueta | Pertenece a una mascota (se borra con ella) |
| `Turno` | Categoría, fecha y hora, motivo, lugar | Pertenece a una mascota (se borra con ella) |
| `ReportePerdida` | Estado (perdido / encontrado), nombre, raza, descripción, foto, `lat`/`lng`, zona, fecha, radio, info adicional, `cerradoEn` | Pertenece a su autor; la mascota es opcional (un encontrado puede ser de un perro sin identificar) |
| `Etiqueta` | Texto de una etiqueta ("Collar rojo") | Pertenece a un reporte. Tabla aparte porque SQLite no guarda listas; la API la devuelve como `etiquetas: string[]` |

- **Los valores fijos** (`tipo`, `categoria`, `estado`, `rol`) se guardan como `String`, porque SQLite no hace cumplir los enums, y se validan en Express contra las listas de `src/dominio.ts`.
- **Los reportes no se borran:** cerrarlo pone la fecha en `cerradoEn` y `GET /api/reportes` devuelve solo los que la tienen en `null`.
- **Del modelo a la respuesta:** el nombre y la foto de un cuidador salen del `Usuario` (no se duplican), la `mascota` de una invitación sale de la relación y las fechas sin hora del carnet se guardan a medianoche UTC y se devuelven como `AAAA-MM-DD`. Las conversiones están en `src/respuestas.ts`.

## Seguridad

- **Contraseñas con bcrypt** (10 rondas, `src/lib/sesiones.ts`), nunca en texto plano. `passwordHash` no sale en ninguna respuesta: `aUsuario` (`src/respuestas.ts`) arma el JSON campo por campo.
- **Login que no delata cuentas:** el mismo 401 "Email o contraseña incorrectos" si el email no existe o si la contraseña no coincide, y cuando no hay cuenta igual compara contra un hash de relleno para tardar lo mismo.
- **Token de sesión hasheado:** el token son 32 bytes aleatorios (64 caracteres hex) que se le dan al cliente una sola vez. En la tabla `Sesion` queda solo su SHA-256, así una copia de la base no sirve para entrar. Dura 30 días y el logout borra la fila, por lo que el token deja de servir al instante. Se eligió esto y no JWT justamente por el logout: con JWT habría que llevar igual una lista negra.
- **El usuario sale del token, nunca del body:** el middleware `requiereUsuario` (`src/middlewares/requiereUsuario.ts`) pone `req.usuarioId` y las rutas usan solo ese valor.
- **Permisos por recurso** (`src/lib/asignaciones.ts`): solo se lee y se escribe sobre mascotas asignadas al usuario (403 si no). Generar códigos de asignación es solo para dueños. Un reporte lo edita o cierra su autor o alguien asignado a la mascota. La única lectura de una mascota ajena es la búsqueda por código del QR, que devuelve solo los datos públicos (`aMascotaPublica`).
- **Validación en el servidor**, aunque la app ya haya validado: de cada body se toman solo los campos permitidos (`pick` en `src/lib/entrada.ts`, así no se puede mandar `id`, `tutorId` ni `passwordHash`), los ids de la URL pasan por `parseId` (400 si no son enteros positivos) y los datos por `src/validaciones.ts`, espejo de las reglas de la app (largos, caracteres permitidos, formatos y rangos de fechas, con "hoy" calculado en la zona de Argentina).
- **Fotos verificadas por firma:** multer lee el archivo en memoria con tope de 5 MB (413 si se pasa) y `detectarFormato` (`src/lib/fotos.ts`) mira los primeros bytes: solo pasan JPG (`FF D8 FF`), PNG (`89 50 4E 47…`) y WEBP (`RIFF…WEBP`). El nombre y el mimetype que manda el cliente no se usan; el archivo se guarda con un nombre aleatorio y se sirve con `X-Content-Type-Options: nosniff`.
- **Errores sin detalles internos:** cada ruta tiene su `try/catch`; en un error imprevisto se loguea en la consola y al cliente le llega un 500 genérico.
- **Sin secretos en el código:** la configuración va en el `.env`, que no se versiona (`.env.example` sí).

## Pruebas

```bash
npm test
```

Corre `scripts/probar.sh`, que prueba la API con `curl` (más de 250 chequeos):

1. Resetea su propia base, `test.db`, con `npm run db:reset`. El script exporta `DATABASE_URL=file:./test.db` antes del reset y del servidor, así que **`dev.db` no se toca nunca**: los datos con los que probás la app quedan como estaban. Si el script lo corre un agente de IA (por ejemplo, Claude Code), Prisma 7 frena el `--force-reset` y pide que una persona lo confirme: el agente tiene que preguntar y volver a correrlo con `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. Corrido a mano no pide nada.
2. Levanta la API en el puerto 3001, así no choca con `npm run dev` en el 3000 (si el 3001 está ocupado, avisa y no corre). Las fotos que sube van a una carpeta temporal (`UPLOADS_DIR`), no a `uploads/`.
3. Hace login con Sofía, Lucía y Carlos y usa sus tokens. Prueba el registro, el login, el logout y los 401 (sin token, token inválido, vencido o cerrado), y los permisos entre usuarios distintos (Sofía no toca lo de Toby, Lucía no toca lo de Sofía, una cuenta nueva no ve nada).
4. Prueba todos los endpoints con sus casos de error: datos inválidos, ids inválidos, mascotas ajenas, recursos que no existen, conflictos y códigos ya usados. También chequea partes del contenido (que no salga `passwordHash`, que el código de la mascota no cambie, que un reporte cerrado no aparezca, etc.). Las fotos se prueban con archivos mínimos que arma el script: cada formato válido, un texto con extensión `.jpg`, uno de más de 5 MB, sin token, rutas inválidas en los PATCH y que el archivo viejo se borre solo cuando nadie más lo usa.
5. Muestra una tabla con el endpoint, el caso, el status esperado y el obtenido, marca en rojo los que fallan y al final lista cada falla con la respuesta del servidor. Sale con código 1 si algo falla.
6. Baja el servidor al terminar.

Algunos casos se preparan insertando filas directo en la base con el helper `sql`, que usa `better-sqlite3` (por ejemplo, una sesión vencida o un reporte publicado por otro usuario); las fechas relativas salen del helper `fecha`. Así el script no depende del CLI de `sqlite3` ni del `date` de macOS, y corre igual en Windows. Para sumar un caso: `t "<caso>" <status esperado> <método> <ruta> '<body JSON>'`; el pedido sale con el token elegido antes con `como "$SOFIA"` (o `como ""` para probar sin sesión), y para chequear un valor de esa respuesta, `v "<caso>" <esperado> "$(jget .campo)"`. Para subir un archivo: `subir "<caso>" <status esperado> <archivo>`.

## Estructura

```
doggy-backend/
├── prisma/
│   ├── schema.prisma     modelo de datos
│   └── seed.ts           datos de ejemplo
├── prisma.config.ts      configuración de la CLI de Prisma 7 (URL de la base, seed)
├── uploads/              fotos subidas (no se versionan, salvo el .gitkeep)
├── scripts/
│   ├── probar.sh         pruebas de todos los endpoints con curl (npm test)
│   └── studio.ts         abre Prisma Studio con la ruta absoluta de la base
└── src/
    ├── index.ts          app de Express, middlewares y montaje de las rutas
    ├── rutas/            una por recurso (auth, usuarios, mascotas, registros, turnos, reportes…)
    ├── cuerpos/          lectura y validación del body de cada recurso
    ├── validaciones.ts   reglas de validación, las mismas que la app
    ├── respuestas.ts     conversión de los modelos al JSON que espera la app
    ├── dominio.ts        valores válidos de los campos fijos (roles, estados, categorías, radios)
    ├── lib/              Prisma, sesiones, permisos, fotos, lectura del request, errores y códigos
    ├── middlewares/      requiereUsuario: lee el token y pone el usuario de la sesión (401 si no hay)
    └── generated/        cliente generado por Prisma (no se versiona)
```
