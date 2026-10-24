# Doggy Backend — reglas del proyecto

Proyecto de la materia Programación de Aplicaciones Móviles (UCA).

**Doggy** es una app móvil para el cuidado y la seguridad de perros: mascotas de la familia, carnet sanitario, turnos, reportes de perros perdidos o encontrados en un mapa colaborativo y un QR de identificación en la chapita.

**Este repo (`doggy-backend`) es solo la API.** El front (Expo + React Native) está en el repo [`doggy`](https://github.com/ignaciogonzalezinigo1/doggy), clonado al lado de este (`../doggy`), y consume la API por HTTP. Acá nunca va código de la app, y en `doggy` nunca va código del backend.

Material de referencia de la cátedra en `_referencias/` del repo `doggy` (no se versiona). Este archivo sí se versiona: lo compartimos entre los integrantes.

## Arquitectura de la cátedra

```
doggy: pantallas → AppContext → services → HTTP ──► doggy-backend: Express → Prisma → SQLite
```

- **Express recibe, valida y decide:** parsea el request, valida los datos, chequea sesión y permisos, elige el status y arma la respuesta.
- **Prisma define el modelo y consulta:** el modelo está en `prisma/schema.prisma` y las rutas consultan con el cliente de `src/lib/prisma.ts`. Prisma no valida reglas de negocio.
- **SQLite** guarda los datos en `dev.db` (local, no se versiona).
- Prisma 7: la URL de la base va en `prisma.config.ts` (no en el schema) y el cliente se conecta con el adapter `@prisma/adapter-better-sqlite3`. El cliente se genera en `src/generated/prisma` (no se versiona).

## Contrato con el front (doggy)

Lo que sigue lo tienen que respetar los dos repos. **Si algo del contrato cambia, hay que cambiarlo en los dos:** acá (rutas y este archivo) y en `doggy` (services, tipos y su `CLAUDE.md`).

### Endpoints

| Recurso | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/registro`, `POST /api/auth/login`, `POST /api/auth/logout` |
| Usuario | `GET /api/usuarios/me`, `PATCH /api/usuarios/me` |
| Mascotas | `GET /api/mascotas`, `POST /api/mascotas`, `PATCH /api/mascotas/:id` |
| Registros | `GET /api/registros`, `POST /api/mascotas/:id/registros`, `PATCH /api/registros/:id`, `DELETE /api/registros/:id` |
| Turnos | `GET /api/turnos`, `POST /api/turnos`, `PATCH /api/turnos/:id`, `DELETE /api/turnos/:id` |
| Reportes | `GET /api/reportes`, `POST /api/reportes`, `PATCH /api/reportes/:id` (también para cerrarlo) |
| Cuidadores | `GET /api/cuidadores`, `DELETE /api/mascotas/:id/cuidadores/me` |
| Invitaciones | `POST /api/mascotas/:id/invitaciones`, `GET /api/invitaciones/:token`, `POST /api/invitaciones/:token/aceptar` |
| Fotos | `POST /api/fotos` (multipart), `GET /uploads/<nombre>` (público) |

Además, `GET /api/health` → `{ ok: true }` para chequear que el servidor está levantado.

- Cada función de `doggy/mobile/src/services/` tiene comentado su endpoint, con la ruta y el cuerpo que manda.
- **Las respuestas tienen que tener exactamente la forma de los tipos de `doggy/mobile/src/types/models.ts`:** mismos nombres de campo, ids numéricos, fechas como string ISO, relaciones por id (`mascotaId`, `autorId`), opcionales que se omiten o llegan como `null` según diga el tipo. Si el modelo de Prisma guarda algo distinto (por ejemplo, las etiquetas de un reporte en una tabla aparte), la ruta lo transforma antes de responder.
- Los códigos de asignación responden 410 si vencieron o ya se usaron, y 404 si no existen.
- **Cerrar un reporte ("Ya apareció") es `PATCH /api/reportes/:id` con `{ cerrado: true }`**, no un DELETE: el servidor pone la fecha en `ReportePerdida.cerradoEn` y el reporte queda guardado como historial. `GET /api/reportes` devuelve solo los activos (`cerradoEn` null). Un reporte cerrado no se puede editar ni reabrir (409).
- **Quién edita o cierra un reporte:** quien lo publicó o cualquier usuario asignado a la mascota del reporte (dueño o invitado), así si la encuentra otro integrante de la familia la saca del mapa sin esperar a quien la reportó (regla del README de `doggy`, Sprint 1). Un reporte sin `mascotaId` (un `encontrado` de un perro sin identificar) solo lo edita o cierra su autor. Si no, 403.
- **Para borrar un opcional en un PATCH se manda `null`** (`proximaDosis`, `fotoEtiqueta`, `infoAdicional`, `foto`). Un campo que no viene no se toca; ojo que `JSON.stringify` descarta los `undefined`.
- **Permisos:** solo se escribe sobre mascotas a las que el usuario está asignado, como dueño o invitado (403 si no). Generar códigos de asignación es solo para dueños. Excepción: un reporte `encontrado` puede llevar el `mascotaId` de una mascota ajena (la que identificó el QR); solo se chequea que exista.
- Una mascota tiene como mucho un reporte `perdido` activo (409 si ya tiene uno).

### Fotos

- **`POST /api/fotos`** (con token): `multipart/form-data` con el archivo en el campo `foto` → 201 `{ foto: "/uploads/<nombre>.jpg" }`. 400 si no vino el archivo o no es JPG, PNG ni WEBP; 413 si pesa más de 5 MB. El tipo se valida por la firma del archivo (primeros bytes), no por el nombre ni el mimetype. El nombre es aleatorio (32 hex).
- **`GET /uploads/<nombre>`** es público (sin token), con `express.static`, para que `Image` cargue la foto sin headers. Se registra antes de `requiereUsuario`.
- **En la base se guarda la ruta relativa** (`/uploads/abc.jpg`), nunca la URL completa, porque la IP de la PC cambia. La app la convierte en `API_URL + foto` (`fuenteFoto` en `doggy/mobile/src/data/fotos.ts`).
- **Los campos de foto** (`foto` de mascota, usuario y reporte; `fotoEtiqueta` de registro) solo aceptan `null`, una clave del seed (`CLAVES_FOTO_SEED` de `src/dominio.ts`, iguales a `FOTOS_LOCALES` de la app) o una ruta `/uploads/` cuyo archivo exista (`leerFoto`). Una URI del celular (`file://`, `content://`, `blob:`) da 400: la app tiene que subirla antes.
- **Archivos huérfanos:** al reemplazar o borrar una foto (PATCH con otra foto o `null`, `DELETE` de un registro, registro que deja de ser vacuna) se llama a `borrarFotoSiHuerfana` (`src/lib/fotos.ts`) después de escribir: borra el archivo solo si ninguna columna de foto lo usa. Cerrar un reporte no borra su foto (queda como historial). Las fotos subidas que nunca se guardaron en un registro quedan en la carpeta.
- Los archivos van a `uploads/` (ignorada en git salvo `.gitkeep`) o a `UPLOADS_DIR`; `npm test` usa una carpeta temporal.

### Sesión

- `POST /api/auth/registro` `{ nombre, apellido, email, password }` → 201 `{ usuario, token }`; 400 si un dato no es válido (mismas reglas que la pantalla de registro), 409 si el email ya tiene cuenta. El email se guarda en minúsculas. `ubicacion` y `telefonoEmergencia` quedan como `""` hasta que el usuario los complete con `PATCH /api/usuarios/me`.
- `POST /api/auth/login` `{ email, password }` → 200 `{ usuario, token }`; 401 con `"Email o contraseña incorrectos"`, el mismo mensaje si el email no existe o si la contraseña no coincide.
- `POST /api/auth/logout` → 204 sin body; desde ahí ese token responde 401.
- **Todas las demás rutas mandan `Authorization: Bearer <token>`**, salvo `/api/health`. Sin header, con un token que no existe, vencido (30 días) o cerrado, responden **401**: la app borra el token y vuelve al login.
- El token es aleatorio (64 caracteres hex) y se guarda solo su SHA-256 en la tabla `Sesion`. Se eligió esto y no JWT porque el logout tiene que invalidar el token al instante: con la tabla es un `delete`, con JWT habría que llevar una lista negra igual. Tampoco hace falta una clave secreta en el `.env`.
- El middleware `requiereUsuario` (`src/middlewares/requiereUsuario.ts`) lee el token y pone `req.usuarioId`. Las rutas usan siempre `req.usuarioId`; nunca un id fijo ni uno que venga en el body.

### Códigos de estado

No es una lista cerrada: la regla es responder con el status que corresponde a cada caso.

| Status | Cuándo |
| --- | --- |
| 200 | GET o PATCH salió bien (PATCH para cambiar una parte, **nunca PUT**) |
| 201 | POST creó el recurso (se devuelve lo creado) |
| 204 | DELETE salió bien, **sin body** |
| 400 | datos o id inválidos |
| 401 | sin `Authorization: Bearer`, token inválido, vencido o cerrado con logout; login con email o contraseña incorrectos |
| 403 | con sesión, pero sin permiso sobre ese recurso |
| 404 | no existe |
| 409 | conflicto con el estado actual: email ya registrado, ya asignado a la mascota, único dueño que quiere desasignarse |
| 410 | código de asignación vencido o ya usado |
| 413 | la foto subida pesa más de 5 MB |
| 500 | error imprevisto |

- Todo error sale como `{ error: "mensaje en español" }`. La app muestra ese mensaje tal cual, así que tiene que ser claro para el usuario final (rioplatense, sin detalles técnicos).

## Reglas de las rutas

- **Middlewares antes de las rutas:** `cors()` y `express.json()` se registran antes que cualquier ruta en `src/index.ts`.
- **try/catch en toda ruta async.** En el `catch`, se loguea el error en la consola del servidor y se responde 500 con `{ error: "..." }` genérico, sin filtrar detalles internos.
- **Errores siempre como `{ error: "mensaje en español" }`**, con el status de la tabla.
- **Molde de cada ruta:** `parseId` (400) → existe (404) → permiso (403) → leer y validar el body (400) → escribir (P2025 → 404, P2002 → 409) → responder con las funciones de `src/respuestas.ts`. Los helpers están en `src/lib/entrada.ts` (`parseId`, `pick`, lectores de campos), `src/lib/asignaciones.ts` (permisos) y `src/lib/errores.ts`; la lectura del body de cada recurso, en `src/cuerpos/`.
- **Ids de la URL con `parseId`:** convierte `req.params.id` a entero positivo; si no lo es, 400 antes de tocar la base.
- **pick del body:** de `req.body` se toman solo los campos permitidos para esa ruta. Nunca se pasa el body entero a Prisma (así no se puede mandar `id`, `tutorId`, `passwordHash`, etc.).
- **P2025 → 404:** si Prisma tira `P2025` (registro no encontrado en un `update` o `delete`), se responde 404.
- **DELETE responde `res.status(204).end()`**, sin body.
- **PATCH, nunca PUT**, para modificar.
- Antes de modificar o borrar, chequear que el usuario de la sesión tenga permiso sobre ese recurso (403 si no).

## Validación en el servidor

- El servidor valida todo lo que recibe, aunque la app ya lo haya validado: nunca se confía en el cliente.
- **Las reglas son las mismas que `doggy/mobile/src/utils/validaciones.ts`:** los largos máximos de `LIMITES`, los caracteres permitidos por tipo de campo (nombres de persona solo con letras; nombres de mascota y etiquetas con letras y números; textos libres con letras, números y puntuación común), el `limpiarTexto` antes de validar y guardar, el formato de email, la contraseña nueva (8 a 64 caracteres, sin espacios, con al menos una letra y un número), el teléfono (8 a 15 dígitos), la edad (entero de 0 a 30) y los rangos de fechas (aplicación no futura ni más vieja que 30 años, refuerzo posterior a la aplicación y a no más de 5 años, turno a no más de 2 años).
- Las reglas están en `src/validaciones.ts`, que es el espejo de `validaciones.ts` del front (más las opciones de cada campo que usan los formularios). Los valores fijos se validan contra `src/dominio.ts` (incluidos `RADIOS_BUSQUEDA` y `MAXIMO_ETIQUETAS`).
- Si una regla cambia en un repo, cambia en el otro. Los mensajes de error son los mismos que usa la app; los genéricos de largo y caracteres llevan el campo adelante ("Nombre: puede tener hasta 30 caracteres."), porque la app los muestra en un Alert y no debajo del input.
- **Fechas:** las sin hora llegan como `AAAA-MM-DD` (se rechaza otro formato) y las de turnos y reportes como ISO con hora. "Hoy" se calcula en la zona de Argentina, aunque el servidor esté en UTC. Al editar un turno, "a futuro" solo se exige si cambió la fecha (se puede corregir el motivo de uno que ya pasó).

## Datos sensibles

- **Nunca devolver `passwordHash`** (ni en login, ni en `/me`, ni dentro de una relación incluida). Usar `select` u omitir el campo antes de responder.
- Las contraseñas se guardan hasheadas con bcrypt, nunca en texto plano. Los tokens de sesión, como SHA-256 (`Sesion.tokenHash`).
- El login no dice si el email existe: mismo mensaje y, cuando no hay cuenta, igual compara contra un hash de relleno para tardar lo mismo.
- Nada de secretos en el código: van en el `.env`, que no se versiona (`.env.example` sí).

## Prisma

- **Después de cambiar `prisma/schema.prisma`, correr `npx prisma generate`** (o `npm run db:init`, que aplica el schema con `db push` y genera el cliente). En Prisma 7, `db push` no genera el cliente solo.
- Los modelos siguen los tipos de `models.ts` (mismos nombres de campo). Las enumeraciones (`tipo`, `categoria`, `estado`, `rol`) se guardan como `String` y se validan en Express contra las listas de `src/dominio.ts` (con `esValorDe`).
- Los datos de ejemplo van en `prisma/seed.ts`, con los mismos datos e ids que `doggy/mobile/src/data/mock.ts`. Contraseña de todos los usuarios de prueba: `doggy1234`.

### Del modelo a la respuesta

Algunos campos no se guardan con la misma forma con la que viajan. La ruta los transforma antes de responder, para que la app reciba exactamente los tipos de `models.ts`:

- **Etiquetas de un reporte:** tabla `Etiqueta` aparte; se devuelven como `etiquetas: string[]`.
- **Nombre y foto del cuidador:** no se guardan en `Cuidador`, salen del `Usuario` relacionado (`nombre` = nombre y apellido unidos, `foto` = la del usuario). Así no quedan datos viejos cuando alguien edita su perfil.
- **`mascota` de una invitación:** sale de la relación (`nombre`, `raza`, `foto`).
- **Fechas sin hora** (`fecha` y `proximaDosis` de `RegistroSanitario`): se guardan a medianoche UTC y se devuelven como `AAAA-MM-DD`. El front interpreta ese formato como fecha local (`parsearFecha` en `doggy/mobile/src/utils/fechas.ts`); un ISO completo con `Z` se vería un día antes en Argentina.
- Los opcionales que son `?` en `models.ts` (`proximaDosis`, `fotoEtiqueta`, `radioMetros`, `infoAdicional`) se omiten si son `null`.

## Código y estilo

- TypeScript estricto, sin `any`.
- Código, nombres y comentarios en español, con JSDoc:
  - encabezado `/** ... */` en cada archivo explicando qué es y qué rol cumple;
  - JSDoc en cada función y ruta, con qué hace, qué recibe y qué devuelve (en las rutas: método, path, body esperado y status posibles).
- Tono de los comentarios: natural y directo, sin relleno ni emojis.
- Nada de valores sueltos repetidos: constantes con nombre.

## Git

- Commits chicos, uno por unidad lógica, con mensajes en español, cortos, en imperativo, variados y descriptivos. Nada de mensajes genéricos repetidos. Sin trailers `Co-Authored-By`.
- No cambiar `git config` ni hacer push salvo que se pida.
- Se ignoran `node_modules/`, `.env`, la base (`*.db`), el cliente generado (`src/generated/`) y las fotos subidas (`uploads/*`, salvo `.gitkeep`).

## Antes de dar algo por terminado

1. `npx tsc --noEmit` sin errores.
2. Si se tocó el schema, `npx prisma generate` (o `npm run db:init`).
3. Levantar la API (`npm run dev`) y probar los endpoints tocados. `npm test` corre todas las pruebas con curl contra una base aparte (`test.db`), sin tocar `dev.db`.
4. Si se tocó el contrato, revisar que `doggy` quede igual (services, tipos y su `CLAUDE.md`).
5. Hacer los commits y dar un resumen corto: qué se hizo, qué decisiones se tomaron, qué hay que probar y los commits que quedaron.
