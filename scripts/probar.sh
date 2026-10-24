#!/bin/bash
# Pruebas de la API de Doggy con curl.
#
# Resetea una base aparte (test.db) con los datos del seed, levanta el servidor en el puerto 3001
# con una carpeta de fotos temporal (no ensucia uploads/),
# hace login con usuarios del seed (contraseña doggy1234) y usa sus tokens,
# prueba todos los endpoints (también sus casos de error) y muestra una tabla
# con el endpoint, el caso, el status esperado y el obtenido. Además chequea
# partes del contenido de algunas respuestas. Sale con 1 si algo falla.
#
# Uso: npm test (o bash scripts/probar.sh). Necesita curl y sqlite3.
# Usa su propia base, test.db, y nunca toca la dev.db de la app: cada corrida
# la borra y la vuelve a crear con los datos de ejemplo.

set -u

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ" || exit 1

PUERTO=3001
API="http://localhost:$PUERTO"
# Segundos que se espera a que el servidor responda /api/health.
ESPERA_MAXIMA=30

TMP=$(mktemp -d)
OUT="$TMP/respuesta"
FILAS="$TMP/filas.tsv"
LOG="$TMP/servidor.log"
SERVIDOR=""
SECCION=""
LAST=""
# Token con el que se hacen los pedidos (vacío: sin header Authorization). Se cambia con `como`.
TOKEN=""
# Contraseña de todos los usuarios del seed.
PASSWORD_SEED="doggy1234"

# --- Preparación ---

# Al salir (bien o mal) se baja el servidor y se borran los temporales.
terminar() {
  if [ -n "$SERVIDOR" ]; then
    kill "$SERVIDOR" 2>/dev/null
    wait "$SERVIDOR" 2>/dev/null
  fi
  rm -rf "$TMP"
}
trap terminar EXIT

# Corta las pruebas con un mensaje.
abortar() {
  echo "Error: $1" >&2
  exit 1
}

command -v sqlite3 > /dev/null || abortar "falta sqlite3."
[ -f .env ] || abortar "falta el .env (cp .env.example .env)."
[ -d node_modules ] || abortar "faltan las dependencias (npm install)."

# Base de las pruebas, aparte de la de la app. Se exporta DATABASE_URL para
# que la usen el reset (CLI de Prisma y seed) y el servidor: dotenv no pisa
# una variable que ya está definida, así que el .env no la cambia.
DB="$RAIZ/test.db"
export DATABASE_URL="file:./test.db"

if curl -s -o /dev/null "$API/api/health"; then
  abortar "ya hay algo escuchando en el puerto $PUERTO. Bajalo y volvé a correr las pruebas."
fi

# Las fotos subidas en las pruebas van a una carpeta temporal, que se borra al terminar.
export UPLOADS_DIR="$TMP/uploads"

echo "Reseteando la base de pruebas ($DB)…"
npm run db:reset > "$TMP/reset.log" 2>&1 || { cat "$TMP/reset.log" >&2; abortar "no se pudo resetear la base."; }

echo "Levantando la API en el puerto $PUERTO…"
PORT=$PUERTO node --import tsx src/index.ts > "$LOG" 2>&1 &
SERVIDOR=$!
for _ in $(seq "$ESPERA_MAXIMA"); do
  curl -s -o /dev/null "$API/api/health" && break
  kill -0 "$SERVIDOR" 2>/dev/null || { cat "$LOG" >&2; abortar "el servidor no arrancó."; }
  sleep 1
done
curl -s -o /dev/null "$API/api/health" || { cat "$LOG" >&2; abortar "el servidor no respondió en $ESPERA_MAXIMA segundos."; }
echo "Probando…"

# --- Helpers ---

# Empieza un grupo de casos en la tabla.
seccion() { SECCION="$1"; }

# Agrega una fila a la tabla: tipo, endpoint, caso, esperado, obtenido, respuesta.
fila() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$SECCION" "$1" "$2" "$3" "$4" "$5" "$6" >> "$FILAS"
}

# Primeros caracteres de la última respuesta, en una línea, para la tabla.
resumen() { printf '%s' "$LAST" | head -c 200 | tr '\t\n' '  '; }

# Elige con qué token se hacen los pedidos que siguen: como <token> (vacío: sin sesión).
como() { TOKEN="$1"; }

# Hace un pedido y compara el status: t <caso> <esperado> <método> <ruta> [body]
# Manda `Authorization: Bearer $TOKEN` si hay token elegido con `como`.
# La respuesta queda en $LAST para las verificaciones que siguen.
t() {
  local caso="$1" esperado="$2" metodo="$3" ruta="$4" body="${5:-}" status
  local args=(-s -o "$OUT" -w '%{http_code}' -X "$metodo")
  [ -n "$TOKEN" ] && args+=(-H "Authorization: Bearer $TOKEN")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  status=$(curl "${args[@]}" "$API$ruta")
  # Un 204 tiene que venir sin body.
  if [ "$status" = 204 ] && [ -s "$OUT" ]; then status="204 con body"; fi
  LAST=$(cat "$OUT")
  fila http "$metodo $ruta" "$caso" "$esperado" "$status" "$(resumen)"
}

# Verifica un valor de la última respuesta: v <caso> <esperado> <obtenido>
v() { fila contenido "" "$1" "$2" "$3" "$(resumen)"; }

# Campo de la última respuesta (las listas salen separadas por coma): jget .campo
jget() { node -e 'const r = JSON.parse(process.argv[1]); const x = eval("r" + process.argv[2]); console.log(Array.isArray(x) ? x.join() : x)' "$LAST" "$1" 2>/dev/null; }
# Expresión sobre la última respuesta, que queda en r: jmap 'r.map(...)'
jmap() { node -e 'const r = JSON.parse(process.argv[1]); console.log(eval(process.argv[2]))' "$LAST" "$1" 2>/dev/null; }
# Condición sobre la última respuesta, que queda en r: responde "sí" o "no".
jok() { node -e 'const r = JSON.parse(process.argv[1]); console.log(eval(process.argv[2]) ? "sí" : "no")' "$LAST" "$1" 2>/dev/null || echo "no"; }

# Hace login con un usuario del seed y devuelve el token. Corta las pruebas si falla.
# Uso: TOKEN_X=$(login <email>)
login() {
  curl -s -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PASSWORD_SEED\"}" "$API/api/auth/login" |
    node -e 'let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => { const t = JSON.parse(d).token; if (!t) process.exit(1); console.log(t); })'
}

# Vence en la base la última sesión abierta (para probar un token vencido).
vencer_ultima_sesion() {
  sqlite3 "$DB" "update Sesion set vence = '$(date -u -v-1H +%Y-%m-%dT%H:%M:%S.000+00:00)' where id = (select max(id) from Sesion);"
}

# Sube un archivo a POST /api/fotos: subir <caso> <esperado> <archivo> [campo]
# La respuesta queda en $LAST, como con `t`.
subir() {
  local caso="$1" esperado="$2" archivo="$3" campo="${4:-foto}" status
  local args=(-s -o "$OUT" -w '%{http_code}' -X POST -F "$campo=@$archivo")
  [ -n "$TOKEN" ] && args+=(-H "Authorization: Bearer $TOKEN")
  status=$(curl "${args[@]}" "$API/api/fotos")
  LAST=$(cat "$OUT")
  fila http "POST /api/fotos" "$caso" "$esperado" "$status" "$(resumen)"
}

# Responde "sí" si el archivo de una ruta /uploads/... está en la carpeta de fotos.
hay_archivo() { [ -f "$UPLOADS_DIR/$(basename "$1")" ] && echo sí || echo no; }

# Inserta en la base un reporte activo de otro autor y devuelve su id.
# Uso: reporte_de <autorId> <mascotaId> <estado> <nombre>
reporte_de() {
  local radio=NULL
  [ "$3" = perdido ] && radio=500
  sqlite3 "$DB" "insert into ReportePerdida (mascotaId, autorId, estado, nombre, raza, descripcion, lat, lng, zona, fecha, radioMetros) values ($2, $1, '$3', '$4', 'Mestizo', 'Collar rojo', -34.58, -58.42, 'Palermo, CABA', '$(date -u -v-1H +%Y-%m-%dT%H:%M:%S.000+00:00)', $radio); select last_insert_rowid();"
}

# --- Casos ---

AYER=$(date -v-1d +%Y-%m-%d); HOY=$(date +%Y-%m-%d); MANANA=$(date -v+1d +%Y-%m-%d)
FUT_ISO=$(date -u -v+3d +%Y-%m-%dT13:30:00.000Z); PAS_ISO=$(date -u -v-3d +%Y-%m-%dT13:30:00.000Z)
LEJOS_ISO=$(date -u -v+3y +%Y-%m-%dT13:30:00.000Z); AHORA_ISO=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

# Un registro y un turno de Toby (mascota 4, de Lucía) para probar los 403.
sqlite3 "$DB" "insert into RegistroSanitario (mascotaId,tipo,nombre,fecha,profesional) values (4,'vacuna','Séxtuple','2026-01-10T00:00:00.000+00:00','Vet. Centro');"
TOBY_REG=$(sqlite3 "$DB" "select max(id) from RegistroSanitario;")
sqlite3 "$DB" "insert into Turno (mascotaId,categoria,fecha,motivo,lugar) values (4,'veterinario','$(date -u -v+5d +%Y-%m-%dT15:00:00.000+00:00)','Control','Vet. Centro');"
TOBY_TUR=$(sqlite3 "$DB" "select max(id) from Turno;")

# Archivos para las pruebas de fotos: imágenes mínimas con la firma de cada
# formato, un texto con extensión .jpg y una foto de más de 5 MB.
F_JPG="$TMP/perro.jpg"; F_PNG="$TMP/perro.png"; F_WEBP="$TMP/perro.webp"
F_TXT="$TMP/trucho.jpg"; F_GRANDE="$TMP/grande.jpg"
printf '\xff\xd8\xff\xe0foto' > "$F_JPG"
printf '\x89PNG\r\n\x1a\nfoto' > "$F_PNG"
printf 'RIFF\x10\x00\x00\x00WEBPVP8 ' > "$F_WEBP"
echo "no soy una foto" > "$F_TXT"
{ printf '\xff\xd8\xff\xe0'; head -c $((5 * 1024 * 1024 + 1)) /dev/zero; } > "$F_GRANDE"
# Ruta con el formato correcto pero sin archivo.
RUTA_INEXISTENTE="/uploads/$(printf '0%.0s' $(seq 32)).jpg"

# Sesiones de los usuarios del seed que se usan en las pruebas.
SOFIA=$(login sofia.romero@mail.com) || abortar "no se pudo hacer login con Sofía."
LUCIA=$(login lucia.gomez@mail.com) || abortar "no se pudo hacer login con Lucía."
CARLOS=$(login carlos.romero@mail.com) || abortar "no se pudo hacer login con Carlos."

seccion "Auth: registro"
como ""
t "API levantada (pública)" 200 GET /api/health
v "responde { ok: true }" true "$(jget .ok)"
t "registro válido" 201 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":" Ana.Ruiz@MAIL.com ","password":"perro1234","passwordHash":"x","id":1}'
NUEVO_TOKEN=$(jget .token); NUEVO_ID=$(jget .usuario.id)
v "devuelve un token" sí "$(jok 'typeof r.token === "string" && r.token.length >= 32')"
v "email limpio y en minúsculas" ana.ruiz@mail.com "$(jget .usuario.email)"
v "no devuelve passwordHash" sí "$(jok '!("passwordHash" in r.usuario)')"
v "id nuevo (no el del body)" sí "$(jok 'r.usuario.id > 20')"
v "la contraseña se guarda hasheada" 1 "$(sqlite3 "$DB" "select passwordHash like '\$2%' from Usuario where id = $NUEVO_ID;")"
t "email ya registrado (otras mayúsculas)" 409 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ANA.RUIZ@mail.com","password":"perro1234"}'
t "email de una cuenta del seed" 409 POST /api/auth/registro '{"nombre":"Sofía","apellido":"Romero","email":"sofia.romero@mail.com","password":"perro1234"}'
t "contraseña de 7 caracteres" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana2@mail.com","password":"perro12"}'
t "contraseña sin números" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana2@mail.com","password":"perroperro"}'
v "mensaje de la app" "Usá al menos una letra y un número." "$(jget .error)"
t "contraseña con espacios" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana2@mail.com","password":"perro 1234"}'
t "contraseña de 65 caracteres" 400 POST /api/auth/registro "{\"nombre\":\"Ana\",\"apellido\":\"Ruiz\",\"email\":\"ana2@mail.com\",\"password\":\"a1$(printf 'x%.0s' $(seq 63))\"}"
t "contraseña que no es texto" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana2@mail.com","password":12345678}'
t "nombre con números" 400 POST /api/auth/registro '{"nombre":"Ana2","apellido":"Ruiz","email":"ana2@mail.com","password":"perro1234"}'
t "apellido vacío" 400 POST /api/auth/registro '{"nombre":"Ana","email":"ana2@mail.com","password":"perro1234"}'
t "email inválido" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana@mail","password":"perro1234"}'
como "$NUEVO_TOKEN"
t "el token del registro sirve" 200 GET /api/usuarios/me
v "es la cuenta nueva" "$NUEVO_ID" "$(jget .id)"
t "la cuenta nueva no ve mascotas ajenas" 200 GET /api/mascotas
v "lista vacía" 0 "$(jget .length)"
t "la cuenta nueva no ve registros ajenos" 200 GET /api/registros
v "lista vacía" 0 "$(jget .length)"
t "no puede editar a Luna" 403 PATCH /api/mascotas/1 '{"nombre":"Pampa"}'

seccion "Auth: login y logout"
como ""
t "login válido" 200 POST /api/auth/login '{"email":"sofia.romero@mail.com","password":"doggy1234"}'
v "es Sofía" 1 "$(jget .usuario.id)"
v "no devuelve passwordHash" sí "$(jok '!("passwordHash" in r.usuario)')"
t "login con email en mayúsculas" 200 POST /api/auth/login '{"email":" SOFIA.ROMERO@mail.com","password":"doggy1234"}'
t "login con la cuenta nueva" 200 POST /api/auth/login '{"email":"ana.ruiz@mail.com","password":"perro1234"}'
t "contraseña incorrecta" 401 POST /api/auth/login '{"email":"sofia.romero@mail.com","password":"doggy12345"}'
MSG_PASSWORD=$(jget .error)
v "mensaje genérico" "Email o contraseña incorrectos" "$MSG_PASSWORD"
t "email sin cuenta" 401 POST /api/auth/login '{"email":"nadie@mail.com","password":"doggy1234"}'
v "mismo mensaje que con contraseña incorrecta" "$MSG_PASSWORD" "$(jget .error)"
t "sin contraseña" 400 POST /api/auth/login '{"email":"sofia.romero@mail.com"}'
t "body no JSON objeto" 400 POST /api/auth/login '[1,2]'
t "sin token" 401 GET /api/mascotas
v "error en español" sí "$(jok 'typeof r.error === "string" && r.error.length > 0')"
como "token-que-no-existe"
t "token inválido" 401 GET /api/mascotas
t "token inválido en un DELETE" 401 DELETE /api/turnos/1
VENCE=$(login sofia.romero@mail.com) || abortar "no se pudo hacer login con Sofía."
VENCE_ID=$(sqlite3 "$DB" "select max(id) from Sesion;")
vencer_ultima_sesion
como "$VENCE"
t "token vencido" 401 GET /api/usuarios/me
v "la sesión vencida se borra" 0 "$(sqlite3 "$DB" "select count(*) from Sesion where id = $VENCE_ID;")"
code=$(curl -s -o "$OUT" -w '%{http_code}' -H "Authorization: Token $SOFIA" "$API/api/usuarios/me"); LAST=$(cat "$OUT")
fila http "GET /api/usuarios/me" "header sin 'Bearer'" 401 "$code" "$(resumen)"
SALIR=$(login sofia.romero@mail.com) || abortar "no se pudo hacer login con Sofía."
como "$SALIR"
t "antes del logout el token sirve" 200 GET /api/usuarios/me
t "logout" 204 POST /api/auth/logout
t "el token del logout ya no sirve" 401 GET /api/usuarios/me
t "logout otra vez con el mismo token" 401 POST /api/auth/logout
como ""
t "logout sin token" 401 POST /api/auth/logout
como "$SOFIA"
t "las otras sesiones de Sofía siguen" 200 GET /api/usuarios/me

seccion "Permisos entre usuarios"
como "$LUCIA"
t "perfil con el token de Lucía" 200 GET /api/usuarios/me
v "es Lucía" 20 "$(jget .id)"
t "Lucía ve sus mascotas" 200 GET /api/mascotas
v "solo Toby" 4 "$(jmap 'r.map((m) => m.id).join()')"
t "Lucía edita el registro de Toby" 200 PATCH /api/registros/$TOBY_REG '{"profesional":"Vet. Norte"}'
t "Lucía no edita a Luna (de Sofía)" 403 PATCH /api/mascotas/1 '{"nombre":"Pampa"}'
t "Lucía no genera códigos de Roco" 403 POST /api/mascotas/2/invitaciones '{"rol":"invitado"}'
t "Lucía da turno a Toby" 201 POST /api/turnos "{\"mascotaId\":4,\"categoria\":\"peluqueria\",\"fecha\":\"$FUT_ISO\",\"motivo\":\"Baño\",\"lugar\":\"Peluquería Canina\"}"
TUR_LUCIA=$(jget .id)
como "$CARLOS"
t "Carlos (co-dueño) ve a Luna" 200 GET /api/mascotas
v "Luna está en su lista" sí "$(jok 'r.some((m) => m.id === 1) && !r.some((m) => m.id === 4)')"
t "Carlos edita a Luna" 200 PATCH /api/mascotas/1 '{"senas":"Mancha blanca en la pata"}'
t "Carlos no toca el turno de Toby" 403 PATCH /api/turnos/$TUR_LUCIA '{"lugar":"Otro lugar"}'
como "$SOFIA"
t "Sofía no borra el turno de Lucía" 403 DELETE /api/turnos/$TUR_LUCIA
t "Sofía no edita el registro de Toby" 403 PATCH /api/registros/$TOBY_REG '{"nombre":"Quíntuple"}'

seccion "Lecturas"
como "$SOFIA"
t "perfil de la sesión (Sofía)" 200 GET /api/usuarios/me
v "es Sofía" 1 "$(jget .id)"
v "no devuelve passwordHash" sí "$(jok '!("passwordHash" in r)')"
t "mascotas asignadas" 200 GET /api/mascotas
v "solo Luna, Roco y Milo (no Toby)" 1,2,3 "$(jmap 'r.map((m) => m.id).join()')"
t "registros de las mascotas asignadas" 200 GET /api/registros
v "ninguno de Toby" sí "$(jok 'r.length > 0 && r.every((x) => x.mascotaId !== 4)')"
v "fechas sin hora (AAAA-MM-DD)" sí "$(jok 'r.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.fecha))')"
t "turnos de las mascotas asignadas" 200 GET /api/turnos
v "ninguno de Toby" sí "$(jok 'r.length > 0 && r.every((x) => x.mascotaId !== 4)')"
t "reportes activos" 200 GET /api/reportes
v "los 3 del seed, con etiquetas como lista" sí "$(jok 'r.length === 3 && r.every((x) => Array.isArray(x.etiquetas))')"
t "cuidadores de las mascotas asignadas" 200 GET /api/cuidadores
v "con nombre armado desde el usuario" sí "$(jok 'r.some((c) => c.nombre === "Sofía Romero")')"

seccion "Fotos"
como ""
subir "sin token" 401 "$F_JPG"
como "$SOFIA"
subir "JPG válido" 201 "$F_JPG"
FOTO_A=$(jget .foto)
v "devuelve una ruta /uploads/ con nombre aleatorio" sí "$(jok '/^\/uploads\/[0-9a-f]{32}\.jpg$/.test(r.foto)')"
v "el archivo quedó guardado" sí "$(hay_archivo "$FOTO_A")"
subir "PNG válido" 201 "$F_PNG"
FOTO_B=$(jget .foto)
v "se guarda como .png" sí "$(jok 'r.foto.endsWith(".png")')"
subir "WEBP válido" 201 "$F_WEBP"
FOTO_C=$(jget .foto)
subir "texto con extensión .jpg" 400 "$F_TXT"
v "mensaje en español" "La foto tiene que ser JPG, PNG o WEBP." "$(jget .error)"
subir "más de 5 MB" 413 "$F_GRANDE"
v "mensaje en español" "La foto puede pesar hasta 5 MB." "$(jget .error)"
subir "en otro campo del multipart" 400 "$F_JPG" imagen
t "sin archivo" 400 POST /api/fotos
como ""
t "la foto se ve sin token" 200 GET "$FOTO_A"
t "foto que no existe" 404 GET "$RUTA_INEXISTENTE"
como "$SOFIA"

seccion "Usuario"
t "datos válidos" 200 PATCH /api/usuarios/me '{"ubicacion":"Palermo, CABA","telefonoEmergencia":"+54 11 5555-1234","passwordHash":"x"}'
t "email en mayúsculas" 200 PATCH /api/usuarios/me '{"email":" Sofia.Romero@MAIL.com "}'
v "se guarda limpio y en minúsculas" sofia.romero@mail.com "$(jget .email)"
t "nombre con números" 400 PATCH /api/usuarios/me '{"nombre":"Sofi4"}'
t "teléfono corto" 400 PATCH /api/usuarios/me '{"telefonoEmergencia":"123"}'
t "body vacío" 400 PATCH /api/usuarios/me '{}'
t "email de otra cuenta" 409 PATCH /api/usuarios/me '{"email":"lucia.gomez@mail.com"}'
t "foto con URI del celular" 400 PATCH /api/usuarios/me '{"foto":"file:///var/mobile/perro.jpg"}'
t "foto con ruta que no existe" 400 PATCH /api/usuarios/me "{\"foto\":\"$RUTA_INEXISTENTE\"}"
t "foto con ruta fuera de /uploads/" 400 PATCH /api/usuarios/me '{"foto":"/uploads/../.env"}'
t "foto subida" 200 PATCH /api/usuarios/me "{\"foto\":\"$FOTO_A\"}"
v "guarda la ruta relativa" "$FOTO_A" "$(jget .foto)"
t "reemplaza la foto" 200 PATCH /api/usuarios/me "{\"foto\":\"$FOTO_B\"}"
v "se borró el archivo viejo" no "$(hay_archivo "$FOTO_A")"
t "vuelve a la foto del seed" 200 PATCH /api/usuarios/me '{"foto":"sofia"}'
v "se borró la foto subida" no "$(hay_archivo "$FOTO_B")"

seccion "Mascotas"
t "alta válida" 201 POST /api/mascotas '{"nombre":"Ñandú","raza":"Mestizo","edad":2,"senas":"Mancha blanca en el pecho","foto":null,"codigo":"HACK","tutorId":99}'
NUEVA=$(jget .id); CODIGO=$(jget .codigo)
v "el código lo genera el servidor" sí "$(jok '/^DOGGY-[A-Z0-9]{4}-/.test(r.codigo)')"
v "el tutor es el de la sesión" 1 "$(jget .tutorId)"
t "la mascota nueva tiene cuidadores" 200 GET /api/cuidadores
v "quien la dio de alta quedó como dueño" dueno "$(jmap "r.filter((c) => c.mascotaId === $NUEVA && c.usuarioId === 1).map((c) => c.rol).join()")"
t "edad 31" 400 POST /api/mascotas '{"nombre":"Toto","raza":"Mestizo","edad":31,"senas":"Orejas largas"}'
t "nombre vacío" 400 POST /api/mascotas '{"raza":"Mestizo","edad":3,"senas":"Orejas largas"}'
t "señas con emoji" 400 POST /api/mascotas '{"nombre":"Toto","raza":"Mestizo","edad":3,"senas":"Muy bueno 🐶"}'
t "cambia el nombre" 200 PATCH /api/mascotas/$NUEVA '{"nombre":"Pampa"}'
v "nombre nuevo" Pampa "$(jget .nombre)"
v "el código no cambia" "$CODIGO" "$(jget .codigo)"
t "id inválido" 400 PATCH /api/mascotas/abc '{"nombre":"Pampa"}'
t "mascota ajena (Toby)" 403 PATCH /api/mascotas/4 '{"nombre":"Pampa"}'
t "no existe" 404 PATCH /api/mascotas/9999 '{"nombre":"Pampa"}'
t "foto con URI de Android" 400 PATCH /api/mascotas/$NUEVA '{"foto":"content://media/1"}'
t "foto subida" 200 PATCH /api/mascotas/$NUEVA "{\"foto\":\"$FOTO_C\"}"
t "otra mascota con la misma foto" 200 PATCH /api/mascotas/3 "{\"foto\":\"$FOTO_C\"}"
t "le saca la foto a la primera" 200 PATCH /api/mascotas/$NUEVA '{"foto":null}'
v "el archivo sigue (lo usa la otra)" sí "$(hay_archivo "$FOTO_C")"
t "se la saca a la otra" 200 PATCH /api/mascotas/3 '{"foto":null}'
v "ahora sí se borró" no "$(hay_archivo "$FOTO_C")"

seccion "Mascotas: buscar por código del QR"
como "$SOFIA"
t "mascota ajena (Toby, de Lucía)" 200 GET /api/mascotas/codigo/DOGGY-7741-TOBY
v "es Toby" "4 Toby" "$(jmap 'r.id + " " + r.nombre')"
v "solo los datos públicos" "codigo,foto,id,nombre,raza,senas" "$(jmap 'Object.keys(r).sort().join()')"
t "mascota propia (Luna)" 200 GET /api/mascotas/codigo/DOGGY-8492-LUNA
v "es Luna" 1 "$(jget .id)"
v "tampoco trae tutorId" sí "$(jok '!("tutorId" in r) && !("edad" in r)')"
t "en minúsculas y con espacios" 200 GET "/api/mascotas/codigo/%20doggy-7741-toby%20"
v "lo normaliza" DOGGY-7741-TOBY "$(jget .codigo)"
t "formato inválido" 400 GET /api/mascotas/codigo/PERRO-12-TOBY
v "mensaje en español" sí "$(jok 'r.error.includes("DOGGY-XXXX-NOMBRE")')"
t "código que no existe" 404 GET /api/mascotas/codigo/DOGGY-0000-NADIE
como ""
t "sin token" 401 GET /api/mascotas/codigo/DOGGY-7741-TOBY
como "$SOFIA"

seccion "Registros"
subir "foto de la etiqueta" 201 "$F_JPG"
FOTO_ETIQUETA=$(jget .foto)
t "alta válida con refuerzo" 201 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\",\"proximaDosis\":\"$(date -v+1y +%Y-%m-%d)\",\"fotoEtiqueta\":\"$FOTO_ETIQUETA\",\"mascotaId\":4}"
REG=$(jget .id)
v "guarda la foto de la etiqueta" "$FOTO_ETIQUETA" "$(jget .fotoEtiqueta)"
v "fecha como AAAA-MM-DD" "$HOY" "$(jget .fecha)"
v "mascota de la URL, no la del body" 1 "$(jget .mascotaId)"
t "etiqueta con URI del navegador" 400 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\",\"fotoEtiqueta\":\"blob:http://localhost:8081/abc\"}"
t "fecha futura" 400 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$MANANA\",\"profesional\":\"Vet. San Roque\"}"
t "fecha de hace 31 años" 400 POST /api/mascotas/1/registros '{"tipo":"vacuna","nombre":"Antirrábica","fecha":"1990-01-01","profesional":"Vet. San Roque"}'
t "día inexistente" 400 POST /api/mascotas/1/registros '{"tipo":"vacuna","nombre":"Antirrábica","fecha":"2026-02-31","profesional":"Vet. San Roque"}'
t "refuerzo anterior" 400 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\",\"proximaDosis\":\"$AYER\"}"
t "refuerzo a 6 años" 400 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\",\"proximaDosis\":\"$(date -v+6y +%Y-%m-%d)\"}"
t "tipo inválido" 400 POST /api/mascotas/1/registros "{\"tipo\":\"cirugia\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\"}"
t "mascota ajena" 403 POST /api/mascotas/4/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\"}"
t "mascota no existe" 404 POST /api/mascotas/9999/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\"}"
t "saca el refuerzo con null" 200 PATCH /api/registros/$REG '{"proximaDosis":null}'
v "proximaDosis se omite" sí "$(jok '!("proximaDosis" in r)')"
t "pasa a 'otro'" 200 PATCH /api/registros/$REG '{"tipo":"otro"}'
v "se borra la foto de la etiqueta" sí "$(jok '!("fotoEtiqueta" in r)')"
v "y su archivo" no "$(hay_archivo "$FOTO_ETIQUETA")"
subir "otra foto de etiqueta" 201 "$F_PNG"
FOTO_ETIQUETA=$(jget .foto)
t "foto de etiqueta en 'otro'" 400 PATCH /api/registros/$REG "{\"fotoEtiqueta\":\"$FOTO_ETIQUETA\"}"
t "vuelve a vacuna con foto" 200 PATCH /api/registros/$REG "{\"tipo\":\"vacuna\",\"fotoEtiqueta\":\"$FOTO_ETIQUETA\"}"
t "id inválido" 400 PATCH /api/registros/0 '{"nombre":"Quíntuple"}'
t "registro de mascota ajena" 403 PATCH /api/registros/$TOBY_REG '{"nombre":"Quíntuple"}'
t "no existe" 404 PATCH /api/registros/9999 '{"nombre":"Quíntuple"}'
t "borrar de mascota ajena" 403 DELETE /api/registros/$TOBY_REG
t "borrar" 204 DELETE /api/registros/$REG
v "se borró el archivo de la etiqueta" no "$(hay_archivo "$FOTO_ETIQUETA")"
t "borrar otra vez" 404 DELETE /api/registros/$REG

seccion "Turnos"
t "alta válida" 201 POST /api/turnos "{\"mascotaId\":1,\"categoria\":\"veterinario\",\"fecha\":\"$FUT_ISO\",\"motivo\":\"Control anual\",\"lugar\":\"Vet. San Roque\"}"
TUR=$(jget .id)
t "en el pasado" 400 POST /api/turnos "{\"mascotaId\":1,\"categoria\":\"veterinario\",\"fecha\":\"$PAS_ISO\",\"motivo\":\"Control anual\",\"lugar\":\"Vet. San Roque\"}"
t "a más de 2 años" 400 POST /api/turnos "{\"mascotaId\":1,\"categoria\":\"veterinario\",\"fecha\":\"$LEJOS_ISO\",\"motivo\":\"Control anual\",\"lugar\":\"Vet. San Roque\"}"
t "sin hora" 400 POST /api/turnos "{\"mascotaId\":1,\"categoria\":\"veterinario\",\"fecha\":\"$MANANA\",\"motivo\":\"Control anual\",\"lugar\":\"Vet. San Roque\"}"
t "categoría inválida" 400 POST /api/turnos "{\"mascotaId\":1,\"categoria\":\"spa\",\"fecha\":\"$FUT_ISO\",\"motivo\":\"Control anual\",\"lugar\":\"Vet. San Roque\"}"
t "mascota ajena" 403 POST /api/turnos "{\"mascotaId\":4,\"categoria\":\"veterinario\",\"fecha\":\"$FUT_ISO\",\"motivo\":\"Control anual\",\"lugar\":\"Vet. San Roque\"}"
t "mascota no existe" 404 POST /api/turnos "{\"mascotaId\":9999,\"categoria\":\"veterinario\",\"fecha\":\"$FUT_ISO\",\"motivo\":\"Control anual\",\"lugar\":\"Vet. San Roque\"}"
sqlite3 "$DB" "insert into Turno (mascotaId,categoria,fecha,motivo,lugar) values (1,'peluqueria','$(date -u -v-2d +%Y-%m-%dT15:00:00.000+00:00)','Baño','Peluquería Canina');"
PASADO=$(sqlite3 "$DB" "select max(id) from Turno;")
t "turno pasado: cambia el lugar sin tocar la fecha" 200 PATCH /api/turnos/$PASADO '{"lugar":"Peluquería del barrio"}'
t "turno pasado: mueve a otra fecha pasada" 400 PATCH /api/turnos/$PASADO "{\"fecha\":\"$PAS_ISO\"}"
t "mueve a otra mascota asignada" 200 PATCH /api/turnos/$TUR '{"mascotaId":2}'
t "mueve a mascota ajena" 403 PATCH /api/turnos/$TUR '{"mascotaId":4}'
t "turno de mascota ajena" 403 PATCH /api/turnos/$TOBY_TUR '{"lugar":"Otro lugar"}'
t "no existe" 404 PATCH /api/turnos/9999 '{"lugar":"Otro lugar"}'
t "borrar de mascota ajena" 403 DELETE /api/turnos/$TOBY_TUR
t "borrar" 204 DELETE /api/turnos/$TUR
t "borrar otra vez" 404 DELETE /api/turnos/$TUR
t "id inválido" 400 DELETE /api/turnos/-1

seccion "Reportes"
t "perdido de mascota propia" 201 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":2,\"nombre\":\"Roco\",\"raza\":\"Beagle\",\"descripcion\":\"Collar azul con chapita\",\"foto\":null,\"etiquetas\":[\"Collar azul\",\"Asustadizo\"],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500,\"autorId\":99}"
REP=$(jget .id)
v "el autor es el de la sesión" 1 "$(jget .autorId)"
v "etiquetas como lista" "Collar azul,Asustadizo" "$(jget .etiquetas)"
t "segundo perdido de la misma mascota" 409 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":2,\"nombre\":\"Roco\",\"raza\":\"Beagle\",\"descripcion\":\"Collar azul con chapita\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"
t "perdido de mascota ajena" 403 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":4,\"nombre\":\"Toby\",\"raza\":\"Caniche\",\"descripcion\":\"Pelo blanco con rulos\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"
t "encontrado de mascota ajena (QR)" 201 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":4,\"nombre\":\"Toby\",\"raza\":\"Caniche\",\"descripcion\":\"Pelo blanco con rulos\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
QR_PROPIO=$(jget .id)
t "encontrado con mascota que no existe" 404 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":9999,\"nombre\":\"Sin identificar\",\"raza\":\"Sin especificar\",\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
t "encontrado con radio" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":null,\"nombre\":\"Sin identificar\",\"raza\":\"Sin especificar\",\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"
t "etiquetas repetidas" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":null,\"nombre\":\"Sin identificar\",\"raza\":\"Sin especificar\",\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[\"Collar\",\"collar\"],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
t "6 etiquetas" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":null,\"nombre\":\"Sin identificar\",\"raza\":\"Sin especificar\",\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[\"Uno\",\"Dos\",\"Tres\",\"Cuatro\",\"Cinco\",\"Seis\"],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
t "latitud fuera de rango" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":null,\"nombre\":\"Sin identificar\",\"raza\":\"Sin especificar\",\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[],\"lat\":-134.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
t "fecha futura" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":null,\"nombre\":\"Sin identificar\",\"raza\":\"Sin especificar\",\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$FUT_ISO\"}"
t "foto con URI del celular" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":null,\"nombre\":\"Sin identificar\",\"raza\":\"Sin especificar\",\"descripcion\":\"Perro marrón chico\",\"foto\":\"file:///tmp/perro.jpg\",\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
t "reemplaza etiquetas y radio, borra info" 200 PATCH /api/reportes/$REP '{"etiquetas":["Arnés rojo"],"radioMetros":1000,"infoAdicional":null,"estado":"encontrado"}'
v "el estado no cambia" perdido "$(jget .estado)"
v "etiquetas reemplazadas" "Arnés rojo" "$(jget .etiquetas)"
v "radio nuevo" 1000 "$(jget .radioMetros)"
v "infoAdicional se omite" sí "$(jok '!("infoAdicional" in r)')"
t "radio que no ofrece la app" 400 PATCH /api/reportes/$REP '{"radioMetros":750}'
t "cerrado distinto de true" 400 PATCH /api/reportes/$REP '{"cerrado":false}'
t "reporte de otro autor" 403 PATCH /api/reportes/1 '{"cerrado":true}'
t "no existe" 404 PATCH /api/reportes/9999 '{"cerrado":true}'
t "id inválido" 400 PATCH /api/reportes/1.5 '{"cerrado":true}'
t "cerrar (Ya apareció)" 200 PATCH /api/reportes/$REP '{"cerrado":true}'
v "cerradoEn quedó guardado en la base" 1 "$(sqlite3 "$DB" "select cerradoEn is not null from ReportePerdida where id = $REP;")"
t "cerrar otra vez" 409 PATCH /api/reportes/$REP '{"cerrado":true}'
t "reportes activos después de cerrar" 200 GET /api/reportes
v "el cerrado ya no sale" sí "$(jok "!r.some((x) => x.id === $REP)")"
t "nuevo perdido de Roco tras cerrar" 201 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":2,\"nombre\":\"Roco\",\"raza\":\"Beagle\",\"descripcion\":\"Collar azul con chapita\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"


# Quién edita o cierra un reporte: el autor o alguien asignado a la mascota.
R_CARLOS=$(reporte_de 11 1 perdido Luna)   # Carlos, co-dueño de Luna
R_QR=$(reporte_de 3 1 encontrado Luna)     # Valentina encontró a Luna por el QR
R_TOBY=$(reporte_de 20 4 perdido Toby)     # Lucía, dueña de Toby
t "perdido de Luna publicado por Carlos: lo edita la dueña" 200 PATCH /api/reportes/$R_CARLOS '{"zona":"Villa Crespo, CABA"}'
v "el autor sigue siendo Carlos" 11 "$(jget .autorId)"
t "perdido de Luna publicado por Carlos: lo cierra la dueña" 200 PATCH /api/reportes/$R_CARLOS '{"cerrado":true}'
t "encontrado de Luna (QR) de otra persona: lo cierra la dueña" 200 PATCH /api/reportes/$R_QR '{"cerrado":true}'
t "encontrado sin mascota de otro autor: cerrar" 403 PATCH /api/reportes/2 '{"cerrado":true}'
t "encontrado sin mascota de otro autor: editar" 403 PATCH /api/reportes/2 '{"zona":"Palermo, CABA"}'
t "perdido de Toby sin tenerlo asignado" 403 PATCH /api/reportes/$R_TOBY '{"zona":"Palermo, CABA"}'
t "encontrado propio de mascota ajena: lo edita el autor" 200 PATCH /api/reportes/$QR_PROPIO '{"descripcion":"Pelo blanco con rulos, sin collar"}'

seccion "Invitaciones y cuidadores"
t "genera código (dueña de Luna)" 201 POST /api/mascotas/1/invitaciones '{"rol":"invitado"}'
CODIGO_LUNA=$(jget .token)
v "código de 8 caracteres" 8 "${#CODIGO_LUNA}"
v "trae la mascota" Luna "$(jget .mascota.nombre)"
t "rol inválido" 400 POST /api/mascotas/1/invitaciones '{"rol":"admin"}'
t "mascota no asignada (Toby)" 403 POST /api/mascotas/4/invitaciones '{"rol":"invitado"}'
t "mascota no existe" 404 POST /api/mascotas/9999/invitaciones '{"rol":"invitado"}'
t "ver código propio" 200 GET /api/invitaciones/$CODIGO_LUNA
t "aceptar código de mascota propia" 409 POST /api/invitaciones/$CODIGO_LUNA/aceptar
t "ver TOBY2026 (en minúsculas)" 200 GET /api/invitaciones/toby2026
t "aceptar TOBY2026" 200 POST /api/invitaciones/TOBY2026/aceptar
v "queda como invitada" invitado "$(jget .rol)"
t "perdido de Toby siendo invitada: lo edita" 200 PATCH /api/reportes/$R_TOBY '{"infoAdicional":"Lo vimos cerca de la plaza."}'
t "perdido de Toby siendo invitada: lo cierra" 200 PATCH /api/reportes/$R_TOBY '{"cerrado":true}'
t "aceptar TOBY2026 otra vez" 410 POST /api/invitaciones/TOBY2026/aceptar
t "ver TOBY2026 usado" 410 GET /api/invitaciones/TOBY2026
t "invitada de Toby genera código" 403 POST /api/mascotas/4/invitaciones '{"rol":"invitado"}'
sqlite3 "$DB" "insert into Invitacion (token,mascotaId,rol,creadaPorId,vence,usada) values ('VENCIDO1',3,'invitado',1,'$(date -u -v-1d +%Y-%m-%dT12:00:00.000+00:00)',0);"
t "ver código vencido" 410 GET /api/invitaciones/VENCIDO1
t "aceptar código vencido" 410 POST /api/invitaciones/VENCIDO1/aceptar
t "código que no existe" 404 GET /api/invitaciones/NOEXISTE
t "aceptar código que no existe" 404 POST /api/invitaciones/NOEXISTE/aceptar
t "código con símbolos" 400 GET /api/invitaciones/AB-CD
t "desasignarse de Toby (invitada)" 204 DELETE /api/mascotas/4/cuidadores/me
t "reporte de Toby después de desasignarse" 403 PATCH /api/reportes/$R_TOBY '{"cerrado":true}'
t "desasignarse otra vez" 403 DELETE /api/mascotas/4/cuidadores/me
t "única dueña de Roco" 409 DELETE /api/mascotas/2/cuidadores/me
t "mascota no existe" 404 DELETE /api/mascotas/9999/cuidadores/me
t "id inválido" 400 DELETE /api/mascotas/abc/cuidadores/me
t "Luna tiene otro dueño: se puede ir" 204 DELETE /api/mascotas/1/cuidadores/me
t "body no JSON objeto" 400 PATCH /api/mascotas/3 '[1,2]'

# --- Tabla de resultados ---

node - "$FILAS" <<'JS'
const fs = require('node:fs');

const ANCHO_ENDPOINT = 42;
const ANCHO_CASO = 58;
const ANCHO_VALOR = 22;
const conColor = process.stdout.isTTY;
const rojo = (s) => (conColor ? `\x1b[31m${s}\x1b[0m` : s);
const verde = (s) => (conColor ? `\x1b[32m${s}\x1b[0m` : s);
const negrita = (s) => (conColor ? `\x1b[1m${s}\x1b[0m` : s);
const ajustar = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).padEnd(n);

const filas = fs.readFileSync(process.argv[2], 'utf8').trimEnd().split('\n').map((linea) => {
  const [seccion, tipo, endpoint, caso, esperado, obtenido, respuesta] = linea.split('\t');
  return { seccion, tipo, endpoint, caso, esperado, obtenido, respuesta, ok: esperado === obtenido };
});

const columnas = (endpoint, caso, esperado, obtenido, marca) =>
  [ajustar(endpoint, ANCHO_ENDPOINT), ajustar(caso, ANCHO_CASO), ajustar(esperado, ANCHO_VALOR), ajustar(obtenido, ANCHO_VALOR), marca].join(' │ ');

const encabezado = columnas('Endpoint', 'Caso', 'Esperado', 'Obtenido', '');
const separador = '─'.repeat(encabezado.length + 4);
console.log(`\n${negrita(encabezado)}\n${separador}`);
let seccionActual = null;
for (const f of filas) {
  if (f.seccion !== seccionActual) {
    seccionActual = f.seccion;
    console.log(negrita(`── ${f.seccion}`));
  }
  const endpoint = f.tipo === 'http' ? f.endpoint : '  ↳ contenido';
  const texto = columnas(endpoint, f.caso, f.esperado, f.obtenido, f.ok ? verde('OK') : 'FALLA');
  console.log(f.ok ? texto : rojo(texto));
}
console.log(separador);

const pedidos = filas.filter((f) => f.tipo === 'http');
const contenido = filas.filter((f) => f.tipo === 'contenido');
const fallas = filas.filter((f) => !f.ok);
const fallan = (lista) => lista.filter((f) => !f.ok).length;
console.log(`${pedidos.length} casos de endpoints (${fallan(pedidos)} fallan) y ${contenido.length} verificaciones de contenido (${fallan(contenido)} fallan).`);

if (fallas.length > 0) {
  console.log(rojo(negrita(`\nFallan ${fallas.length}:`)));
  for (const f of fallas) {
    console.log(rojo(`- [${f.seccion}] ${f.endpoint || 'contenido'} · ${f.caso}: esperado ${f.esperado}, obtenido ${f.obtenido}`));
    if (f.respuesta) console.log(`  respuesta: ${f.respuesta}`);
  }
  process.exit(1);
}
console.log(verde(negrita('Todo OK.')));
JS
