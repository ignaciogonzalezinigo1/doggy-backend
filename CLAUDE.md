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
| Mascotas | `GET /api/mascotas`, `GET /api/mascotas/codigo/:codigo`, `POST /api/mascotas`, `PATCH /api/mascotas/:id`, `DELETE /api/mascotas/:id` |
| Registros | `GET /api/registros`, `POST /api/mascotas/:id/registros`, `PATCH /api/registros/:id`, `DELETE /api/registros/:id` |
| Turnos | `GET /api/turnos`, `POST /api/turnos`, `PATCH /api/turnos/:id`, `DELETE /api/turnos/:id` |
| Reportes | `GET /api/reportes`, `POST /api/reportes`, `PATCH /api/reportes/:id` (también para cerrarlo), `POST /api/reportes/:id/perdida` ("Sí, se perdió") |
| Cuidadores | `GET /api/cuidadores`, `DELETE /api/mascotas/:id/cuidadores/me`, `DELETE /api/mascotas/:id/cuidadores/:usuarioId` |
| Invitaciones | `POST /api/mascotas/:id/invitaciones`, `GET /api/invitaciones/:token`, `POST /api/invitaciones/:token/aceptar` |
| Fotos | `POST /api/fotos` (multipart), `GET /uploads/<nombre>` (público) |

Además, `GET /api/health` → `{ ok: true }` para chequear que el servidor está levantado.

- Cada función de `doggy/mobile/src/services/` tiene comentado su endpoint, con la ruta y el cuerpo que manda.
- **Las respuestas tienen que tener exactamente la forma de los tipos de `doggy/mobile/src/types/models.ts`:** mismos nombres de campo, ids numéricos, fechas como string ISO, relaciones por id (`mascotaId`, `autorId`), opcionales que se omiten o llegan como `null` según diga el tipo. Si el modelo de Prisma guarda algo distinto (por ejemplo, las etiquetas de un reporte en una tabla aparte), la ruta lo transforma antes de responder.
- Los códigos de asignación son de un solo uso y no vencen: responden 410 si ya se usaron, y 404 si no existen.
- **Perdido, encontrado y reencuentro.** Un `perdido` lo publica la familia (dueño o invitado). Un `encontrado` lo publica alguien que encontró un perro **escaneando el QR de su chapita**: va siempre con el `codigo`, aunque la mascota no esté perdida. La chapita es la única prueba de que lo tiene, así que no hay encontrados sin código, ni desde un perdido del mapa, ni anónimos (decisión de negocio: vincular un perro a un dueño sin prueba física puede traer problemas). Los anónimos que queden en una base vieja se muestran y su autor los cierra, pero no se crean más. Un perdido y uno o más encontrados activos de la misma mascota son un **reencuentro**; un encontrado vinculado sin perdido es el **caso dudoso** ("Alguien encontró a {nombre}. ¿Se perdió {nombre}?"). No hay estados nuevos en la base: los dos se calculan con los reportes activos.
- **Reglas de un encontrado (`POST /api/reportes`):** 400 si no viene el `codigo` ("Escaneá el QR de su chapita para avisar que la encontraste."), también con un `mascotaId` o sin mascota; 403 si la mascota es propia o asignada ("Esta mascota está en tu cuenta…"); 409 si el mismo usuario ya tiene un encontrado activo de esa mascota ("Ya avisaste que encontraste a esta mascota."). Personas distintas sí pueden tener cada una el suyo. El body es solo `codigo`, `lat`, `lng`, `zona`, `fecha` e `infoAdicional` (el comentario opcional de quien la encontró): nombre, raza, foto y descripción (las señas) los pone el servidor desde la mascota e ignora los del body (`LECTORES_ENCONTRADO` en `src/cuerpos/reporte.ts`). En el PATCH de un encontrado solo se cambian el punto, la fecha, el comentario y el cierre. El `codigo` se normaliza como en `GET /api/mascotas/codigo/:codigo` (400 si no tiene el formato, 404 si no es de nadie, 400 si no coincide con el `mascotaId`, si vino) y no vale en un perdido (400).
- **Contacto (`contacto` en `GET /api/reportes`):** solo en los `encontrado` vinculados. A quien está asignado a la mascota, el de quien la encontró (si no lo publicó él). A quien publicó el encontrado (sin estar asignado), el de la familia: quien publicó el perdido activo o, si no hay o no cargó teléfono, un dueño de la mascota (primero quien la dio de alta; `familiasDe` en `src/rutas/reportes.ts`). Los `perdido` no traen contacto, y nadie más lo ve: ver un perdido en el mapa no habilita a escribirle a la familia. Si la persona no tiene teléfono, no va.
- **"Sí, se perdió": `POST /api/reportes/:id/perdida`** (sin body) sobre un encontrado vinculado activo → 201 con el perdido nuevo: autor el usuario, datos de la mascota (nombre, raza, foto, señas), `lat`, `lng`, `zona` y `fecha` del encontrado, sin radio. 400 id inválido, 403 si no está asignado a la mascota (o es un encontrado anónimo de una base vieja), 404, 409 si no es un encontrado, está cerrado o la mascota ya tiene un perdido activo.
- **Quitar a alguien de una mascota:** `DELETE /api/mascotas/:id/cuidadores/:usuarioId` → 204. Solo un dueño, y solo a un invitado: un invitado o alguien sin asignar recibe 403, sacar a otro dueño da 403 ("No podés quitar a otro dueño.") y una persona que no está asignada, 404. Con el propio id vale lo mismo que `/me` (el único dueño: 409). El chequeo y el borrado van en una transacción (`quitarCuidador` en `src/rutas/mascotas.ts`).
- **Borrar una mascota:** `DELETE /api/mascotas/:id` → 204, solo un dueño (403 un invitado o alguien sin asignar; 404 si no existe). En una transacción y en orden: etiquetas de sus reportes, reportes (activos y cerrados, de cualquier autor), registros, turnos, invitaciones, cuidadores y la mascota. Las fotos (de la mascota, de las etiquetas y de los reportes) se borran con `borrarFotoSiHuerfana` recién después de confirmar la transacción; si falla un archivo se loguea y la respuesta sigue siendo 204.
- **Cerrar un reporte ("Ya apareció" o "Ya volvió a casa") es `PATCH /api/reportes/:id` con `{ cerrado: true }`**, no un DELETE: el servidor pone la fecha en `ReportePerdida.cerradoEn` y el resultado en `ReportePerdida.resultado`, y el reporte queda guardado como historial. `GET /api/reportes` devuelve solo los activos (`cerradoEn` null). Un reporte cerrado no se puede editar ni reabrir (409). La respuesta del PATCH que lo cierra trae `cerradoEn` y `resultado` (en los activos no vienen).
- **Publicar un `encontrado` no cierra el `perdido` de la mascota:** los dos siguen activos hasta que la familia la recupera. El resultado lo decide el servidor (`cierreDe` en `src/rutas/reportes.ts`), y los reportes que arrastra se cierran en la misma transacción con la misma fecha: cerrar un `perdido` con encontrados activos ("Ya volvió a casa") cierra también **todos** los encontrados con `resultado: "devuelta"`; un `perdido` sin encontrado queda `"aparecio"`; un `encontrado` cerrado por alguien asignado a la mascota cierra todos los reportes activos de la mascota, con `"devuelta"` si había un perdido (reencuentro) o `"descartado"` si no ("No, está conmigo"); un `encontrado` cerrado por su autor sin estar asignado (o un anónimo de una base vieja) queda sin resultado y cierra solo ese (`RESULTADOS_REPORTE` en `src/dominio.ts`).
- **Quién edita o cierra un reporte:** quien lo publicó o cualquier usuario asignado a la mascota del reporte (dueño o invitado), así si la encuentra otro integrante de la familia la saca del mapa sin esperar a quien la reportó (regla del README de `doggy`, Sprint 1). Un `encontrado` anónimo de una base vieja (sin `mascotaId`) solo lo edita o cierra su autor. Si no, 403.
- **Para borrar un opcional en un PATCH se manda `null`** (`proximaDosis`, `fotoEtiqueta`, `infoAdicional`, `foto`). Un campo que no viene no se toca; ojo que `JSON.stringify` descarta los `undefined`.
- **Permisos:** solo se escribe sobre mascotas a las que el usuario está asignado, como dueño o invitado (403 si no). Generar códigos de asignación es solo para dueños. Excepción: un reporte `encontrado` se vincula a una mascota ajena por el QR de su chapita, y nunca a una propia (ver las reglas del encontrado).
- Una mascota tiene como mucho un reporte `perdido` activo: un segundo `POST /api/reportes` responde 409 con "Esta mascota ya está reportada como perdida. No se puede reportar de nuevo." (la app muestra ese mismo texto). Cada usuario tiene como mucho un `encontrado` activo por mascota: el segundo responde 409 "Ya avisaste que encontraste a esta mascota.".
- **Buscar por el código del QR:** `GET /api/mascotas/codigo/:codigo` (con token) es la única lectura de una mascota ajena, porque quien encuentra un perro casi nunca está asignado a él. Responde 200 con `MascotaPublica` (`id`, `nombre`, `raza`, `edadMeses` (calculada con `fechaNacimiento`, que no se manda), `senas`, `foto`, `codigo` y `dueno: { nombre, telefono? }`; nada de `tutorId`, carnet, email ni ubicación del dueño; la arma `aMascotaPublica`), 400 si no tiene el formato `DOGGY-XXXX-NOMBRE` y 404 si no existe. **Privacidad:** `dueno.telefono` (el `telefonoEmergencia` del tutor) va solo si la mascota tiene un reporte `perdido` activo o si quien busca está asignado a ella; el filtro está en la ruta, no en la app. Acepta el código en minúsculas o con espacios alrededor (`normalizarCodigoMascota` en `src/lib/codigos.ts`). La app la usa en el escáner de "Encontré una mascota" y publica el `encontrado` con el `codigo` leído, que prueba que quien lo publica tiene la chapita. El `dueno.telefono` de esta ruta se revisa en la tarea de teléfonos: la app no ofrece contactar desde la tarjeta del QR, solo después de publicar el encontrado.

### Fotos

- **`POST /api/fotos`** (con token): `multipart/form-data` con el archivo en el campo `foto` → 201 `{ foto: "/uploads/<nombre>.jpg" }`. 400 si no vino el archivo o no es JPG, PNG ni WEBP; 413 si pesa más de 5 MB. El tipo se valida por la firma del archivo (primeros bytes), no por el nombre ni el mimetype. El nombre es aleatorio (32 hex).
- **`GET /uploads/<nombre>`** es público (sin token), con `express.static`, para que `Image` cargue la foto sin headers. Se registra antes de `requiereUsuario`.
- **En la base se guarda la ruta relativa** (`/uploads/abc.jpg`), nunca la URL completa, porque la IP de la PC cambia. La app la convierte en `API_URL + foto` (`fuenteFoto` en `doggy/mobile/src/data/fotos.ts`).
- **Los campos de foto** (`foto` de mascota, usuario y reporte; `fotoEtiqueta` de registro) solo aceptan `null`, una clave del seed (`CLAVES_FOTO_SEED` de `src/dominio.ts`, iguales a `FOTOS_LOCALES` de la app) o una ruta `/uploads/` cuyo archivo exista (`leerFoto`). Una URI del celular (`file://`, `content://`, `blob:`) da 400: la app tiene que subirla antes.
- **Archivos huérfanos:** al reemplazar o borrar una foto (PATCH con otra foto o `null`, `DELETE` de un registro, registro que deja de ser vacuna) se llama a `borrarFotoSiHuerfana` (`src/lib/fotos.ts`) después de escribir: borra el archivo solo si ninguna columna de foto lo usa. Cerrar un reporte no borra su foto (queda como historial). Las fotos subidas que nunca se guardaron en un registro quedan en la carpeta.
- Los archivos van a `uploads/` (ignorada en git salvo `.gitkeep`) o a `UPLOADS_DIR`; `npm test` usa una carpeta temporal.

### Sesión

- `POST /api/auth/registro` `{ nombre, apellido, email, telefonoEmergencia, telefonoFijo?, password }` → 201 `{ usuario, token }`; 400 si un dato no es válido (también si falta el teléfono, no es un número real o es de otro país: "Solo se aceptan teléfonos de Argentina."; se guarda en E.164) (mismas reglas que la pantalla de registro), 409 si el email ya tiene cuenta. El email se guarda en minúsculas. `ubicacion` y `telefonoEmergencia` quedan como `""` hasta que el usuario los complete con `PATCH /api/usuarios/me`.
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
| 409 | conflicto con el estado actual: email ya registrado, ya asignado a la mascota, único dueño que quiere desasignarse, reporte ya cerrado, mascota ya reportada |
| 410 | código de asignación ya usado |
| 413 | la foto subida pesa más de 5 MB, o el body JSON más de 100 KB |
| 500 | error imprevisto |

- Todo error sale como `{ error: "mensaje en español" }`. La app muestra ese mensaje tal cual, así que tiene que ser claro para el usuario final (rioplatense, sin detalles técnicos).

## Reglas de las rutas

- **Middlewares antes de las rutas:** `cors()` y `express.json()` se registran antes que cualquier ruta en `src/index.ts`.
- **try/catch en toda ruta async.** En el `catch`, se loguea el error en la consola del servidor y se responde 500 con `{ error: "..." }` genérico, sin filtrar detalles internos.
- **Errores siempre como `{ error: "mensaje en español" }`**, con el status de la tabla.
- **404 para rutas inexistentes** (`rutaInexistente` en `src/middlewares/manejarErrores.ts`), después de todas las rutas y antes del middleware de errores: responde 404 `{ error: "No existe esa ruta." }` a una ruta que no existe, a un método que no corresponde (por ejemplo, PUT) y a un archivo de `/uploads` que no está. Una ruta inexistente bajo `/api` sin token responde 401 antes, porque `requiereUsuario` va primero.
- **Middleware de errores al final** (`src/middlewares/manejarErrores.ts`, después de todas las rutas): atrapa lo que no pasa por el try/catch de una ruta, como un JSON mal formado (400) o un body de más de 100 KB (413) de `express.json()`, y el resto lo responde 500 genérico. Así nunca sale la página HTML de Express con el stack.
- Si el puerto está ocupado, `app.listen` avisa y termina el proceso (`EADDRINUSE`), en vez de seguir como si escuchara.
- **Molde de cada ruta:** `parseId` (400) → existe (404) → permiso (403) → leer y validar el body (400) → escribir (P2025 → 404, P2002 → 409) → responder con las funciones de `src/respuestas.ts`. Los helpers están en `src/lib/entrada.ts` (`parseId`, `pick`, lectores de campos), `src/lib/asignaciones.ts` (permisos) y `src/lib/errores.ts`; la lectura del body de cada recurso, en `src/cuerpos/`.
- **Ids de la URL con `parseId`:** convierte `req.params.id` a entero positivo; si no lo es, 400 antes de tocar la base.
- **pick del body:** de `req.body` se toman solo los campos permitidos para esa ruta. Nunca se pasa el body entero a Prisma (así no se puede mandar `id`, `tutorId`, `passwordHash`, etc.).
- **P2025 → 404:** si Prisma tira `P2025` (registro no encontrado en un `update` o `delete`), se responde 404.
- **DELETE responde `res.status(204).end()`**, sin body.
- **PATCH, nunca PUT**, para modificar.
- Antes de modificar o borrar, chequear que el usuario de la sesión tenga permiso sobre ese recurso (403 si no).

## Validación en el servidor

- El servidor valida todo lo que recibe, aunque la app ya lo haya validado: nunca se confía en el cliente.
- **Las reglas son las mismas que `doggy/mobile/src/utils/validaciones.ts`:** los largos máximos de `LIMITES`, los caracteres permitidos por tipo de campo (nombres de persona solo con letras; nombres de mascota y etiquetas con letras y números; textos libres con letras, números y puntuación común), el `limpiarTexto` antes de validar y guardar, el formato de email, la contraseña nueva (8 a 64 caracteres, sin espacios, con al menos una letra y un número), el teléfono (solo de la Argentina y un número válido según libphonenumber-js, región AR; se guarda en E.164; la regla es `src/lib/telefonos.ts`, **el mismo archivo** que `doggy/mobile/src/utils/telefonos.ts`, y `npm test` falla si las dos copias difieren), la fecha de nacimiento (no futura ni de hace más de 30 años) y los rangos de fechas (aplicación no futura ni más vieja que 30 años, refuerzo posterior a la aplicación y a no más de 5 años, turno a no más de 2 años).
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
- Los datos de ejemplo van en `prisma/seed.ts`, que es su única fuente (la app no tiene datos propios). Las fotos del seed usan las claves de `CLAVES_FOTO_SEED`. Contraseña de todos los usuarios de prueba: `doggy1234`.

### Del modelo a la respuesta

Algunos campos no se guardan con la misma forma con la que viajan. La ruta los transforma antes de responder, para que la app reciba exactamente los tipos de `models.ts`:

- **Etiquetas de un reporte:** tabla `Etiqueta` aparte; se devuelven como `etiquetas: string[]`.
- **Nombre y foto del cuidador:** no se guardan en `Cuidador`, salen del `Usuario` relacionado (`nombre` = nombre y apellido unidos, `foto` = la del usuario). Así no quedan datos viejos cuando alguien edita su perfil.
- **`mascota` de una invitación:** sale de la relación (`nombre`, `raza`, `foto`).
- **Fechas sin hora** (`fecha` y `proximaDosis` de `RegistroSanitario`): se guardan a medianoche UTC y se devuelven como `AAAA-MM-DD`. El front interpreta ese formato como fecha local (`parsearFecha` en `doggy/mobile/src/utils/fechas.ts`); un ISO completo con `Z` se vería un día antes en Argentina.
- Los opcionales que son `?` en `models.ts` (`proximaDosis`, `fotoEtiqueta`, `radioMetros`, `infoAdicional`) se omiten si son `null`.

## Decisiones

- **Resuelta: el seed es una demo completa.** 9 usuarios con foto y dirección en CABA (celulares con 9 en E.164, la clínica con fijo), 8 mascotas con foto de su raza (Pipa, de Julián, Simba, de Martín, y Nieve, de Sol, están perdidas sin encontrar; Rocky, de Marcos, está perdido y Martín ya lo encontró, sin recuperar todavía: es un reencuentro; Milo, de Sofía, tiene un encontrado de Valentina por QR sin estar perdido: es el caso dudoso), carnets con refuerzos próximos y vencidos y registros "Otro", turnos pasados y próximos, y 6 reportes en 6 barrios, todos de mascotas registradas: no hay encontrados anónimos ni perdidos sin mascota (Simba y Nieve eran perdidos sin mascota y pasaron a ser mascotas del seed). Los encontrados llevan los datos de la mascota y el comentario en `infoAdicional`. Las fechas se calculan desde hoy. Las fotos son de Unsplash (créditos en `doggy/CREDITOS.md`); las claves válidas están en `CLAVES_FOTO_SEED`. Al terminar, el seed imprime qué mostrar con cada usuario.
- **Resuelta: `npm run studio` en Windows.** `scripts/studio.ts` lanza el JS de la CLI de Prisma con `process.execPath` (sin shell ni `prisma.cmd`) y arma la URL con barras `/`. Es igual en macOS.
- **Resuelta: "Otro" del carnet se describe con `nombre`.** En los registros de tipo `otro`, la app llama "Descripción" al campo `nombre` y lo muestra como título. El servidor ya lo exigía (`validarNombreRegistro`: obligatorio, de 3 a 60 caracteres), así que no hizo falta un campo nuevo ni migrar; las pruebas cubren un `otro` sin descripción (400) y con descripción (201).
- **Resuelta: el teléfono se pide en el registro.** Antes el registro no lo pedía y la cuenta quedaba con `telefonoEmergencia` vacío hasta completar el perfil, así que si la mascota se perdía antes, nadie podía llamar. Ahora es obligatorio en `POST /api/auth/registro` (400 si falta o no es un número válido) y se guarda en E.164, igual que en el perfil (en el servidor las dos rutas usan `leerTelefono`). En la app, el registro y el perfil usan el mismo `InputTelefono` (placeholder "Ej: 11 4589-2310", filtro y la casilla "Es un teléfono fijo").
- **Resuelta: teléfonos en E.164, celular por defecto.** Se validan y normalizan con libphonenumber-js (metadata `/max`, región AR) en el servidor (`src/lib/telefonos.ts`, `aE164`) y en la app (`utils/telefonos.ts`, la misma regla). En la Argentina **todo número es celular salvo que se marque "Es un teléfono fijo"**: "2994554060", "299 455-4060", "0299 15 455-4060", "+54 299 455 4060" y "5492994554060" dan `+5492994554060`. Motivo: libphonenumber, sin el 9 ni el 15, toma el número como fijo, y casi todos cargan su celular así; con la regla vieja no se podía cargar "2994554060" como celular (quedaba `+542994554060`, sin WhatsApp). Con la casilla marcada se guarda sin el 9 (`+542994554060`); el servidor la recibe como `telefonoFijo` en el mismo body del registro o del perfil y no la guarda aparte, porque el E.164 ya dice cuál es (al editar, la casilla aparece marcada si el teléfono guardado es fijo). Si no es un número real, 400. Las pantallas lo muestran legible ("+54 9 299 455-4060") y los links `tel:` y de WhatsApp usan E.164. El único campo de teléfono es `Usuario.telefonoEmergencia` (las clínicas también son usuarios). Los datos viejos se pasan con `npm run db:normalizar-telefonos` (un E.164 que ya era fijo sigue fijo).
- **Resuelta: solo teléfonos de Argentina, con una sola regla para la app y la API.** Reemplaza a "los números de otros países quedan como son": un número de otro país da 400 "Solo se aceptan teléfonos de Argentina.". La regla vive en un archivo, `telefonos.ts`, idéntico en `src/lib/` y en `doggy/mobile/src/utils/` (no importa nada de ninguno de los dos repos); `npm test` compara las dos copias. Tiene `interpretarTelefono` (E.164 o el error), `aE164`, `sacarCodigoPais`/`quitarCodigoPais` (saca +54, 54, 0054 o 549 adelante), `formatearTelefono` (la única forma de mostrarlo: "+54 9 299 455-4060", "+54 9 11 4589-2310", "+54 11 4777-3020"), `telefonoParaEditar` ("299 455-4060", para el input con el +54 fijo) y `esCelular`. Celular por defecto con cualquier característica (11, 299, 351, 3543, 2944…): "2994554060", "299 455-4060", "0299 15 455-4060", "299 15 4554060", "+54 299 455 4060" y "54 9 299 455-4060" dan `+5492994554060`. "351 123-4567" da 400 a propósito: en la Argentina ningún número local empieza con 1 después de la característica (metadata `/max`). `LIMITES.telefono` pasó de 20 a 25 para que entre "0054 9 299 15 455-4060".
- **Resuelta: el perdido sigue activo hasta que la familia la recupera.** Antes, publicar un `encontrado` ya no cerraba el `perdido`, pero en el mapa se veían dos pines de la misma mascota y "Ya volvió a casa" cerraba los dos con dos PATCH desde la app, sin guardar cómo terminó. Ahora el resultado se guarda en `ReportePerdida.resultado` (opcional: `devuelta` o `aparecio`) y lo decide el servidor al cerrar, en una transacción que cierra los dos reportes (ver Contrato). La columna se sumó con `prisma db push` sin `--accept-data-loss` (es opcional; los cerrados de antes quedan sin resultado). En la app, el perdido muestra "¡La encontraron! Esperando que su familia la recupere" y el encontrado vinculado no se dibuja aparte. No hay pantalla de historial: `GET /api/reportes` sigue devolviendo solo los activos, así que el resultado se ve en la respuesta del cierre (el aviso "Quedó como …").
- **Resuelta: fecha de nacimiento en lugar de edad.** `Mascota.edad` (años) se reemplazó por `Mascota.fechaNacimiento` (sin hora, AAAA-MM-DD), no futura y de hace como mucho 30 años. Motivo: una edad guardada queda vieja al año; la fecha no. La edad se calcula en meses cumplidos y se muestra con una sola función, `textoEdad` (`utils/etiquetas.ts`): "3 años", "5 meses" o "Menos de 1 mes". `GET /api/mascotas/codigo/:codigo` no manda la fecha: manda `edadMeses`, calculada en el servidor. Las bases viejas se migran con `npm run db:migrar-fecha-nacimiento` (suma la columna, la completa con hoy menos la edad y recién después saca `edad`).
- **Resuelta: se puede avisar que encontraron una mascota que no está perdida.** Quien escanea el QR puede publicar el `encontrado` aunque la mascota no tenga un `perdido` activo, a propósito: la familia puede no saber todavía que se escapó. La familia ve "Alguien encontró a {nombre}. ¿Se perdió {nombre}?" y decide (ver "Reencuentros"). Quien la encontró y la familia se ven el contacto mutuamente, y la app lo dice antes de publicar ("Le vamos a mostrar tu nombre y teléfono para que te contacte").
- **Resuelta: los datos de la mascota de un reporte salen de la mascota.** Si el reporte trae `mascotaId`, el servidor ignora el `nombre` y la `raza` del body y usa los de la mascota (y también la foto y las señas, en perdidos y encontrados: quien la encontró ya no manda foto). En el PATCH de esos reportes, `nombre` y `raza` no son campos editables. Antes, quien escaneaba el QR podía cambiarlos en el formulario: no tocaba la mascota (un PATCH a una mascota ajena da 403), pero el reporte mostraba lo que tipeó.

- **Resuelta: quitar invitados.** Antes solo existía `DELETE …/cuidadores/me`: nadie podía sacar a otro. Se sumó `DELETE /api/mascotas/:id/cuidadores/:usuarioId` y las dos rutas comparten `quitarCuidador`, así la regla de irse (el último dueño no puede) es una sola. Un dueño no saca a otro dueño: tienen los mismos permisos y ninguno manda sobre el otro. La app ya no le ofrece a un dueño irse por su cuenta (su salida es borrar la mascota), pero `/me` lo sigue permitiendo si queda otro dueño, para no romper el contrato.
- **Resuelta: borrar una mascota sin cambiar el schema.** `ReportePerdida.mascota` es `onDelete: SetNull` (un reporte de un perro sin identificar no tiene mascota), así que borrar la mascota sola dejaba sus reportes huérfanos en el mapa. En vez de cambiar la relación, `DELETE /api/mascotas/:id` borra todo explícitamente y en orden dentro de una transacción; los reportes de la mascota (también un `encontrado` que publicó otra persona y los cerrados del historial) se borran, porque hablan de una mascota que ya no existe. Las fotos se borran después del commit para no perder archivos si la transacción falla.
- **Resuelta: reencuentros (reemplaza "contacto de la familia en los perdidos" y "un encontrado por mascota").** Antes, cualquiera que veía un perdido en el mapa recibía el teléfono de la familia; ahora solo quien publicó un encontrado vinculado a la mascota (por QR), porque es quien dice tenerla. La familia sigue viendo a quien la encontró. El tope pasó de un encontrado activo por mascota a uno **por usuario y mascota**: si dos personas la ven, las dos pueden avisar y la familia ve a las dos. Para que el `mascotaId` no alcance para vincularse a cualquier mascota hace falta el `codigo` del QR. Nadie avisa que encontró su propia mascota (403). Se sumó `POST /api/reportes/:id/perdida` ("Sí, se perdió") para que la familia pase el caso dudoso a reencuentro sin cargar el perdido a mano, con el lugar del encontrado, y `resultado: "descartado"` para "No, está conmigo". No hizo falta cambiar el schema ni resetear la base: el reencuentro y el caso dudoso se calculan con los reportes activos y `resultado` ya era un String. "Ya volvió a casa" (texto neutro) cierra el reencuentro completo.
- **Resuelta: encontrar una mascota es solo escanear el QR (reemplaza "Encontré a…" desde el mapa y el encontrado anónimo).** Decisión de negocio: vincular un perro encontrado a un dueño sin prueba física puede traer problemas, y la única prueba es la chapita. `POST /api/reportes` con `estado: "encontrado"` exige el `codigo` (400 si no viene, aunque venga un `mascotaId` o sea anónimo) y toma de la mascota el nombre, la raza, la foto y las señas; el comentario de quien la encontró va en `infoAdicional`. Se mantienen el 403 (mascota propia o asignada) y el 409 (segundo encontrado del mismo usuario). El seed ya no tiene encontrados anónimos (se sacaron el mestizo de Belgrano, el caniche de Almagro, el labrador de Villa Urquiza y el salchicha de la veterinaria) y Simba y Nieve pasaron a ser mascotas, porque un perdido sin mascota tampoco cumple las reglas. Las fotos de esos perros siguen en `CLAVES_FOTO_SEED` y en la app, sin uso en la demo. No hace falta cambiar el schema; una base vieja conserva sus anónimos hasta `npm run db:reset`.

## Código y estilo

- TypeScript estricto, sin `any`.
- Código, nombres y comentarios en español, con JSDoc:
  - encabezado `/** ... */` en cada archivo explicando qué es y qué rol cumple;
  - JSDoc en cada función y ruta, con qué hace, qué recibe y qué devuelve (en las rutas: método, path, body esperado y status posibles).
- Tono de los comentarios: natural y directo, sin relleno ni emojis.
- Nada de valores sueltos repetidos: constantes con nombre.

## Git

- **Dependencias: `npm ci`, no `npm install`.** Para instalar o actualizar `node_modules` después de un pull se indica siempre `npm ci`: instala exactamente lo que dice el `package-lock.json` y no lo reescribe, así no aparecen cambios de lockfile que dependen de la versión de npm de cada PC. `npm install <paquete>` (o `npx expo install` en el front) es solo para sumar una dependencia, y el lockfile tiene que sumar solo eso.
- Commits chicos, uno por unidad lógica, con mensajes en español, cortos, en imperativo, variados y descriptivos. Nada de mensajes genéricos repetidos. Sin trailers `Co-Authored-By`.
- No cambiar `git config` ni hacer push salvo que se pida.
- Se ignoran `node_modules/`, `.env`, la base (`*.db`), el cliente generado (`src/generated/`) y las fotos subidas (`uploads/*`, salvo `.gitkeep`).

## Antes de dar algo por terminado

1. `npx tsc --noEmit` sin errores.
2. Si se tocó el schema, `npx prisma generate` (o `npm run db:init`).
3. Levantar la API (`npm run dev`) y probar los endpoints tocados. `npm test` corre todas las pruebas con curl contra una base aparte (`test.db`), sin tocar `dev.db`.
4. Si se tocó el contrato, revisar que `doggy` quede igual (services, tipos y su `CLAUDE.md`).
5. Hacer los commits y dar un resumen corto: qué se hizo, qué decisiones se tomaron, qué hay que probar y los commits que quedaron.
