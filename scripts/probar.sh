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
# Uso: npm test (o bash scripts/probar.sh). Necesita bash, curl y node: la base
# se consulta con better-sqlite3 y las fechas se calculan con node, así corre
# igual en macOS, Linux y Windows (Git Bash).
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

command -v curl > /dev/null || abortar "falta curl."
[ -f .env ] || abortar "falta el .env (cp .env.example .env)."
[ -d node_modules ] || abortar "faltan las dependencias (npm install)."

# Base de las pruebas, aparte de la de la app. Se exporta DATABASE_URL para
# que la usen el reset (CLI de Prisma y seed) y el servidor: dotenv no pisa
# una variable que ya está definida, así que el .env no la cambia.
DB="$RAIZ/test.db"
export DATABASE_URL="file:./test.db"
# El seed usa un teléfono inventado para Sofía, aunque el .env tenga el real de la demo.
export TELEFONO_DEMO_SOFIA=""

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

# Corre SQL sobre la base de pruebas, como el CLI de sqlite3: sql "<sentencias>"
# Las sentencias van separadas por ";" (ninguna lleva ";" adentro). Las que
# devuelven filas las imprimen una por línea, con las columnas separadas por "|".
sql() {
  node -e '
    const db = require("better-sqlite3")(process.argv[1]);
    for (const sentencia of process.argv[2].split(";").map((s) => s.trim()).filter(Boolean)) {
      const st = db.prepare(sentencia);
      if (!st.reader) { st.run(); continue; }
      for (const fila of st.raw().all()) console.log(fila.map((x) => x ?? "").join("|"));
    }' "$DB" "$1"
}

# Fecha corrida desde ahora, como `date -v` de macOS: fecha [-u] [ajuste] +formato
# El ajuste es un número con signo y una unidad (H horas, d días, y años), por
# ejemplo -1H o +3d. -u usa UTC; si no, la hora local. El formato acepta %Y %m %d %H %M %S.
fecha() {
  node -e '
    const args = process.argv.slice(1);
    const u = args[0] === "-u" ? "UTC" : "";
    const formato = args.at(-1);
    const m = /^([+-]\d+)([Hdy])$/.exec(args.find((x) => /^[+-]\d/.test(x)) ?? "");
    const f = new Date();
    if (m) {
      const n = Number(m[1]);
      if (m[2] === "H") f.setTime(f.getTime() + n * 3600000);
      if (m[2] === "d") f["set" + u + "Date"](f["get" + u + "Date"]() + n);
      if (m[2] === "y") f["set" + u + "FullYear"](f["get" + u + "FullYear"]() + n);
    }
    const dos = (x) => String(x).padStart(2, "0");
    const partes = {
      Y: f["get" + u + "FullYear"](), m: dos(f["get" + u + "Month"]() + 1), d: dos(f["get" + u + "Date"]()),
      H: dos(f["get" + u + "Hours"]()), M: dos(f["get" + u + "Minutes"]()), S: dos(f["get" + u + "Seconds"]()),
    };
    console.log(formato.slice(1).replace(/%([YmdHMS])/g, (_, k) => partes[k]));' -- "$@"
}

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
# El body viaja desde un archivo: en Windows, curl recibe los argumentos en la
# página de códigos del sistema (rompe las tildes) y con un límite de ~32 KB.
t() {
  local caso="$1" esperado="$2" metodo="$3" ruta="$4" body="${5:-}" status
  local args=(-s -o "$OUT" -w '%{http_code}' -X "$metodo")
  [ -n "$TOKEN" ] && args+=(-H "Authorization: Bearer $TOKEN")
  if [ -n "$body" ]; then
    printf '%s' "$body" > "$TMP/body"
    args+=(-H 'Content-Type: application/json' --data-binary "@$TMP/body")
  fi
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

# Registra un usuario por la API (contraseña del seed) y devuelve su token. Corta las pruebas si falla.
# El body va desde un archivo, como en `t`, para que no se rompan las tildes en Windows.
# Uso: TOKEN_X=$(registrar <nombre> <apellido> <email> <telefono> [fijo])
registrar() {
  local fijo=false
  [ "${5:-}" = fijo ] && fijo=true
  printf '%s' "{\"nombre\":\"$1\",\"apellido\":\"$2\",\"email\":\"$3\",\"telefonoEmergencia\":\"$4\",\"telefonoFijo\":$fijo,\"password\":\"$PASSWORD_SEED\"}" > "$TMP/registro"
  curl -s -X POST -H 'Content-Type: application/json' --data-binary "@$TMP/registro" "$API/api/auth/registro" |
    node -e 'let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => { const t = JSON.parse(d).token; if (!t) process.exit(1); console.log(t); })'
}

# Id de un usuario por su email.
id_de() { sql "select id from Usuario where email = '$1';"; }

# Vence en la base la última sesión abierta (para probar un token vencido).
vencer_ultima_sesion() {
  sql "update Sesion set vence = '$(fecha -u -1H +%Y-%m-%dT%H:%M:%S.000+00:00)' where id = (select max(id) from Sesion);"
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
  sql "insert into ReportePerdida (mascotaId, autorId, estado, nombre, raza, descripcion, lat, lng, zona, fecha, radioMetros) values ($2, $1, '$3', '$4', 'Mestizo', 'Collar rojo', -34.58, -58.42, 'Palermo, CABA', '$(fecha -u -1H +%Y-%m-%dT%H:%M:%S.000+00:00)', $radio); select last_insert_rowid();"
}

# --- Casos ---

AYER=$(fecha -1d +%Y-%m-%d); HOY=$(fecha +%Y-%m-%d); MANANA=$(fecha +1d +%Y-%m-%d)
FUT_ISO=$(fecha -u +3d +%Y-%m-%dT13:30:00.000Z); PAS_ISO=$(fecha -u -3d +%Y-%m-%dT13:30:00.000Z)
LEJOS_ISO=$(fecha -u +3y +%Y-%m-%dT13:30:00.000Z); AHORA_ISO=$(fecha -u +%Y-%m-%dT%H:%M:%S.000Z)

# Un registro y un turno de Toby (mascota 4, de Lucía) para probar los 403.
sql "insert into RegistroSanitario (mascotaId,tipo,nombre,fecha,profesional) values (4,'vacuna','Séxtuple','2026-01-10T00:00:00.000+00:00','Vet. Centro');"
TOBY_REG=$(sql "select max(id) from RegistroSanitario;")
sql "insert into Turno (mascotaId,categoria,fecha,motivo,lugar) values (4,'veterinario','$(fecha -u +5d +%Y-%m-%dT15:00:00.000+00:00)','Control','Vet. Centro');"
TOBY_TUR=$(sql "select max(id) from Turno;")

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

# Sesiones de los usuarios del seed (la demo: Sofía, Lucía y Julián).
SOFIA=$(login sofia.romero@mail.com) || abortar "no se pudo hacer login con Sofía."
LUCIA=$(login lucia.gomez@mail.com) || abortar "no se pudo hacer login con Lucía."
JULIAN=$(login julian.fernandez@mail.com) || abortar "no se pudo hacer login con Julián."

# Actores extra: el seed es la demo mínima y las pruebas necesitan más gente.
# Se registran por la API y se asignan con SQL:
# - Carlos, co-dueño de Luna; la Clínica San Roque (teléfono fijo), invitada en Luna;
# - Marcos, invitado de Roco y dueño de Rocky (perdido); Sol, co-dueña de Milo;
# - Valentina y Martín, que no tienen mascotas y encuentran perros (Martín encuentra a Rocky).
CARLOS=$(registrar Carlos Romero carlos.romero@mail.com "11 6120-4455") || abortar "no se pudo registrar a Carlos."
VALENTINA=$(registrar Valentina Pérez valentina.perez@mail.com "11 6274-9031") || abortar "no se pudo registrar a Valentina."
MARTIN=$(registrar Martín López martin.lopez@mail.com "11 5320-1187") || abortar "no se pudo registrar a Martín."
MARCOS=$(registrar Marcos Díaz marcos.diaz@mail.com "11 5874-2216") || abortar "no se pudo registrar a Marcos."
SOL=$(registrar Sol Romero sol.romero@mail.com "11 6041-3378") || abortar "no se pudo registrar a Sol."
VET=$(registrar Clínica "San Roque" contacto@vetsanroque.com "11 4777-3020" fijo) || abortar "no se pudo registrar a la clínica."
CARLOS_ID=$(id_de carlos.romero@mail.com); MARCOS_ID=$(id_de marcos.diaz@mail.com); VALENTINA_ID=$(id_de valentina.perez@mail.com)
SOL_ID=$(id_de sol.romero@mail.com); VET_ID=$(id_de contacto@vetsanroque.com)
sql "insert into Cuidador (mascotaId, usuarioId, rol, detalle, tipo) values (1, $CARLOS_ID, 'dueno', 'Co-tutor', 'familia'), (1, $VET_ID, 'invitado', 'Dra. Martínez', 'clinica'), (2, $MARCOS_ID, 'invitado', 'Paseos', 'paseador'), (3, $SOL_ID, 'dueno', 'Hogar secundario', 'familia');"
sql "insert into Mascota (tutorId, nombre, raza, fechaNacimiento, codigo, senas, foto) values ($MARCOS_ID, 'Rocky', 'Boxer', '2019-11-12T00:00:00.000+00:00', 'DOGGY-1953-ROCKY', 'Boxer atigrado con el pecho blanco.', NULL);"
ROCKY=$(sql "select id from Mascota where codigo = 'DOGGY-1953-ROCKY';")
sql "insert into Cuidador (mascotaId, usuarioId, rol, detalle, tipo) values ($ROCKY, $MARCOS_ID, 'dueno', 'Tutor', 'familia');"
# Rocky: perdido de Marcos y encontrado por Martín (un reencuentro).
P_ROCKY=$(reporte_de "$MARCOS_ID" "$ROCKY" perdido Rocky)
E_ROCKY=$(reporte_de "$(id_de martin.lopez@mail.com)" "$ROCKY" encontrado Rocky)

seccion "Auth: registro"
como ""
t "API levantada (pública)" 200 GET /api/health
v "responde { ok: true }" true "$(jget .ok)"
t "registro válido" 201 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":" Ana.Ruiz@MAIL.com ","telefonoEmergencia":"11 15 4589-2310","password":"perro1234","passwordHash":"x","id":1}'
NUEVO_TOKEN=$(jget .token); NUEVO_ID=$(jget .usuario.id)
v "devuelve un token" sí "$(jok 'typeof r.token === "string" && r.token.length >= 32')"
v "email limpio y en minúsculas" ana.ruiz@mail.com "$(jget .usuario.email)"
v "no devuelve passwordHash" sí "$(jok '!("passwordHash" in r.usuario)')"
v "id nuevo (no el del body)" sí "$(jok 'r.usuario.id > 20')"
v "la contraseña se guarda hasheada" 1 "$(sql "select passwordHash like '\$2%' from Usuario where id = $NUEVO_ID;")"
v "el teléfono se guarda en E.164" +5491145892310 "$(jget .usuario.telefonoEmergencia)"
t "registro con teléfono fijo marcado" 201 POST /api/auth/registro '{"nombre":"Ana","apellido":"Fijo","email":"ana.fijo@mail.com","telefonoEmergencia":"011 4777-3020","telefonoFijo":true,"password":"perro1234"}'
v "se guarda como fijo" +541147773020 "$(jget .usuario.telefonoEmergencia)"
t "registro con celular sin 15" 201 POST /api/auth/registro '{"nombre":"Ana","apellido":"Celular","email":"ana.celu@mail.com","telefonoEmergencia":"2994554060","password":"perro1234"}'
v "se guarda como celular" +5492994554060 "$(jget .usuario.telefonoEmergencia)"
t "registro sin teléfono" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana3@mail.com","password":"perro1234"}'
v "pide el teléfono" "Ingresá un teléfono de contacto." "$(jget .error)"
t "registro con teléfono inválido" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana3@mail.com","telefonoEmergencia":"11 1234","password":"perro1234"}'
v "dice que no es un número válido" sí "$(jok 'r.error.includes("no es un número válido")')"
t "registro con teléfono de otro país" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana3@mail.com","telefonoEmergencia":"+1 202 555 0143","password":"perro1234"}'
v "solo de Argentina" "Solo se aceptan teléfonos de Argentina." "$(jget .error)"
t "email ya registrado (otras mayúsculas)" 409 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ANA.RUIZ@mail.com","telefonoEmergencia":"11 15 4589-2310","password":"perro1234"}'
t "email de una cuenta del seed" 409 POST /api/auth/registro '{"nombre":"Sofía","apellido":"Romero","email":"sofia.romero@mail.com","telefonoEmergencia":"11 15 4589-2310","password":"perro1234"}'
t "contraseña de 7 caracteres" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana2@mail.com","telefonoEmergencia":"11 15 4589-2310","password":"perro12"}'
t "contraseña sin números" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana2@mail.com","telefonoEmergencia":"11 15 4589-2310","password":"perroperro"}'
v "mensaje de la app" "Usá al menos una letra y un número." "$(jget .error)"
t "contraseña con espacios" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana2@mail.com","telefonoEmergencia":"11 15 4589-2310","password":"perro 1234"}'
t "contraseña de 65 caracteres" 400 POST /api/auth/registro "{\"nombre\":\"Ana\",\"apellido\":\"Ruiz\",\"email\":\"ana2@mail.com\",\"telefonoEmergencia\":\"11 15 4589-2310\",\"password\":\"a1$(printf 'x%.0s' $(seq 63))\"}"
t "contraseña que no es texto" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana2@mail.com","telefonoEmergencia":"11 15 4589-2310","password":12345678}'
t "nombre con números" 400 POST /api/auth/registro '{"nombre":"Ana2","apellido":"Ruiz","email":"ana2@mail.com","telefonoEmergencia":"11 15 4589-2310","password":"perro1234"}'
t "apellido vacío" 400 POST /api/auth/registro '{"nombre":"Ana","email":"ana2@mail.com","telefonoEmergencia":"11 15 4589-2310","password":"perro1234"}'
t "email inválido" 400 POST /api/auth/registro '{"nombre":"Ana","apellido":"Ruiz","email":"ana@mail","telefonoEmergencia":"11 15 4589-2310","password":"perro1234"}'
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
VENCE_ID=$(sql "select max(id) from Sesion;")
vencer_ultima_sesion
como "$VENCE"
t "token vencido" 401 GET /api/usuarios/me
v "la sesión vencida se borra" 0 "$(sql "select count(*) from Sesion where id = $VENCE_ID;")"
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

seccion "Errores de formato y rutas inexistentes"
# express.json() falla antes de llegar a la ruta: el middleware manejarErrores
# tiene que responder { error } en español, sin la página HTML ni el stack.
como ""
t "JSON mal formado (sin sesión)" 400 POST /api/auth/login '{"email": "sofia.romero@mail.com",'
v "llega como { error } en español" "Los datos enviados no tienen un formato válido." "$(jget .error)"
v "sin stack trace" sí "$(jok '!JSON.stringify(r).includes("SyntaxError")')"
como "$SOFIA"
t "JSON mal formado (con sesión)" 400 PATCH /api/usuarios/me '{nombre: Sofía}'
v "llega como { error }" sí "$(jok 'typeof r.error === "string"')"
# El límite por defecto de express.json() es 100 KB.
t "body de más de 100 KB" 413 PATCH /api/usuarios/me "{\"ubicacion\":\"$(head -c 150000 /dev/zero | tr '\0' 'x')\"}"
v "llega como { error } en español" "Los datos enviados son demasiado grandes." "$(jget .error)"
t "después de los errores, la API sigue respondiendo" 200 GET /api/usuarios/me

# Rutas que no existen: 404 con { error } en vez de la página HTML de Express.
t "ruta de la API que no existe" 404 GET /api/noexiste
v "llega como { error } en español" "No existe esa ruta." "$(jget .error)"
t "método que no corresponde (PUT, nunca PUT)" 404 PUT /api/mascotas/1 '{"nombre":"Luna"}'
v "llega como { error }" "No existe esa ruta." "$(jget .error)"
como ""
t "ruta de la API que no existe, sin sesión" 401 GET /api/noexiste
t "ruta fuera de /api" 404 GET /noexiste
v "llega como { error }" "No existe esa ruta." "$(jget .error)"
t "foto de /uploads que no existe (pública)" 404 GET "$RUTA_INEXISTENTE"
v "llega como { error }" "No existe esa ruta." "$(jget .error)"

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
v "los 2 del seed y los 2 de Rocky, con etiquetas como lista" sí "$(jok 'r.length === 4 && r.every((x) => Array.isArray(x.etiquetas))')"
v "todos son de una mascota registrada (no hay anónimos)" sí "$(jok 'r.every((x) => x.mascotaId !== null)')"
v "Pipa perdida y Milo encontrado por Julián" "perdido Pipa,encontrado Milo" "$(jmap 'r.filter((x) => x.autorId === 4).map((x) => x.estado + " " + x.nombre).join()')"
v "Rocky: el perdido y el encontrado de Martín, los dos activos" "perdido,encontrado" "$(jmap "r.filter((x) => x.mascotaId === $ROCKY).map((x) => x.estado).join()")"
v "solo trae contacto el encontrado de Milo" 2 "$(jmap 'r.filter((x) => x.contacto).map((x) => x.id).join()')"
v "es el de Julián, que lo encontró (en E.164)" "Julián +5491157698999" "$(jmap 'const c = r.find((x) => x.id === 2).contacto; c.nombre + " " + c.telefono')"
v "los perdidos de otras familias no traen contacto" sí "$(jok '!r.some((x) => x.estado === "perdido" && "contacto" in x)')"
como "$LUCIA"
t "reportes activos (Lucía, sin encontrados propios)" 200 GET /api/reportes
v "ninguno trae contacto" sí "$(jok '!r.some((x) => "contacto" in x)')"
como "$JULIAN"
t "reportes activos (Julián, que encontró a Milo)" 200 GET /api/reportes
v "su encontrado de Milo trae el contacto de la familia" Sofía "$(jmap 'r.find((x) => x.id === 2).contacto.nombre')"
v "ningún otro trae contacto" 2 "$(jmap 'r.filter((x) => x.contacto).map((x) => x.id).join()')"
como "$MARTIN"
t "reportes activos (Martín, que encontró a Rocky)" 200 GET /api/reportes
v "su encontrado de Rocky trae a Marcos, que publicó el perdido" Marcos "$(jmap "r.find((x) => x.id === $E_ROCKY).contacto.nombre")"
v "el perdido de Rocky no trae contacto" sí "$(jok "!(\"contacto\" in r.find((x) => x.id === $P_ROCKY))")"
como "$SOFIA"
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
v "la foto subida se sirve pública en /uploads" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$API$FOTO_A")"
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
v "dice que no es un número válido" sí "$(jok 'r.error.includes("no es un número válido")')"
t "teléfono con letras" 400 PATCH /api/usuarios/me '{"telefonoEmergencia":"11 4589-23AB"}'
t "teléfono que no existe (11 1234)" 400 PATCH /api/usuarios/me '{"telefonoEmergencia":"11 1234"}'
t "característica que no existe (351 123-4567)" 400 PATCH /api/usuarios/me '{"telefonoEmergencia":"351 123-4567"}'
v "dice que no es un número válido" sí "$(jok 'r.error.includes("no es un número válido")')"
# La regla de teléfonos es un solo archivo, copiado igual en la app y en la API.
COPIA_APP="$RAIZ/../doggy/mobile/src/utils/telefonos.ts"
if [ -f "$COPIA_APP" ]; then
  v "telefonos.ts es idéntico en la app y en la API" sí "$(diff -q --strip-trailing-cr src/lib/telefonos.ts "$COPIA_APP" > /dev/null && echo sí || echo no)"
else
  echo "Aviso: no está ../doggy, no se compara la copia de telefonos.ts de la app." >&2
fi
# Celular por defecto: el mismo número escrito de cualquier forma se guarda igual, con el 9.
for formato in "2994554060" "299 455-4060" "0299 15 455-4060" "299 15 4554060" "+54 299 455 4060" "+54 9 299 455-4060" "54 9 299 455-4060" "5492994554060" "0054 9 299 455-4060" "+549 299 4554060"; do
  t "celular \"$formato\"" 200 PATCH /api/usuarios/me "{\"telefonoEmergencia\":\"$formato\"}"
  v "se guarda como celular" +5492994554060 "$(jget .telefonoEmergencia)"
done
for formato in "1145892310" "11 4589-2310" "011 15 4589-2310" "+54 9 11 4589-2310"; do
  t "celular de CABA \"$formato\"" 200 PATCH /api/usuarios/me "{\"telefonoEmergencia\":\"$formato\"}"
  v "se guarda como celular" +5491145892310 "$(jget .telefonoEmergencia)"
done
t "característica de 4 dígitos (2966 421234)" 200 PATCH /api/usuarios/me '{"telefonoEmergencia":"2966 421234"}'
v "se guarda como celular" +5492966421234 "$(jget .telefonoEmergencia)"
t "característica de 3 dígitos (351 423-4567)" 200 PATCH /api/usuarios/me '{"telefonoEmergencia":"351 423-4567"}'
v "se guarda como celular" +5493514234567 "$(jget .telefonoEmergencia)"
t "característica de 4 dígitos (3543 41-2345)" 200 PATCH /api/usuarios/me '{"telefonoEmergencia":"3543 41-2345"}'
v "se guarda como celular" +5493543412345 "$(jget .telefonoEmergencia)"
t "característica 2944 (2944 41-2345)" 200 PATCH /api/usuarios/me '{"telefonoEmergencia":"2944 41-2345"}'
v "se guarda como celular" +5492944412345 "$(jget .telefonoEmergencia)"
t "fijo marcado (011) 4777-3020" 200 PATCH /api/usuarios/me '{"telefonoEmergencia":"(011) 4777-3020","telefonoFijo":true}'
v "se guarda como fijo, sin el 9" +541147773020 "$(jget .telefonoEmergencia)"
t "fijo marcado escrito con el 15" 200 PATCH /api/usuarios/me '{"telefonoEmergencia":"0299 15 455-4060","telefonoFijo":true}'
v "se guarda como fijo, sin el 9" +542994554060 "$(jget .telefonoEmergencia)"
t "telefonoFijo que no es booleano" 400 PATCH /api/usuarios/me '{"telefonoEmergencia":"2994554060","telefonoFijo":"sí"}'
t "fijo marcado con +54 adelante" 200 PATCH /api/usuarios/me '{"telefonoEmergencia":"+54 11 4777-3020","telefonoFijo":true}'
v "se guarda como fijo, sin el 9" +541147773020 "$(jget .telefonoEmergencia)"
for formato in "+34 612 345 678" "+1 202 555 0143" "0034 612 345 678"; do
  t "número de otro país \"$formato\"" 400 PATCH /api/usuarios/me "{\"telefonoEmergencia\":\"$formato\"}"
  v "solo de Argentina" "Solo se aceptan teléfonos de Argentina." "$(jget .error)"
done
v "el teléfono guardado no cambió" +541147773020 "$(sql "select telefonoEmergencia from Usuario where id = 1;")"
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
t "alta válida" 201 POST /api/mascotas '{"nombre":"Ñandú","raza":"Mestizo","fechaNacimiento":"2024-05-10","senas":"Mancha blanca en el pecho","foto":null,"codigo":"HACK","tutorId":99}'
NUEVA=$(jget .id); CODIGO=$(jget .codigo)
v "el código lo genera el servidor" sí "$(jok '/^DOGGY-[A-Z0-9]{4}-/.test(r.codigo)')"
v "el tutor es el de la sesión" 1 "$(jget .tutorId)"
t "la mascota nueva tiene cuidadores" 200 GET /api/cuidadores
v "quien la dio de alta quedó como dueño" dueno "$(jmap "r.filter((c) => c.mascotaId === $NUEVA && c.usuarioId === 1).map((c) => c.rol).join()")"
HACE_31=$(fecha -31y +%Y-%m-%d)
t "nació hace 31 años" 400 POST /api/mascotas "{\"nombre\":\"Toto\",\"raza\":\"Mestizo\",\"fechaNacimiento\":\"$HACE_31\",\"senas\":\"Orejas largas\"}"
v "dice el máximo" sí "$(jok 'r.error.includes("más de 30 años")')"
t "fecha de nacimiento futura" 400 POST /api/mascotas "{\"nombre\":\"Toto\",\"raza\":\"Mestizo\",\"fechaNacimiento\":\"$MANANA\",\"senas\":\"Orejas largas\"}"
v "dice que no puede ser futura" sí "$(jok 'r.error.includes("no puede ser futura")')"
t "fecha de nacimiento que no existe" 400 POST /api/mascotas '{"nombre":"Toto","raza":"Mestizo","fechaNacimiento":"2024-02-30","senas":"Orejas largas"}'
t "sin fecha de nacimiento" 400 POST /api/mascotas '{"nombre":"Toto","raza":"Mestizo","senas":"Orejas largas"}'
t "edad en vez de fecha (campo viejo)" 400 POST /api/mascotas '{"nombre":"Toto","raza":"Mestizo","edad":3,"senas":"Orejas largas"}'
t "nombre vacío" 400 POST /api/mascotas '{"raza":"Mestizo","fechaNacimiento":"2023-01-01","senas":"Orejas largas"}'
t "señas con emoji" 400 POST /api/mascotas '{"nombre":"Toto","raza":"Mestizo","fechaNacimiento":"2023-01-01","senas":"Muy bueno 🐶"}'
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
v "solo los datos públicos (la edad, no la fecha de nacimiento)" "codigo,dueno,edadMeses,foto,id,nombre,raza,senas" "$(jmap 'Object.keys(r).sort().join()')"
# La edad la calcula el servidor desde fechaNacimiento: se prueba con fechas relativas a hoy.
sql "update Mascota set fechaNacimiento = '$(fecha -10d +%Y-%m-%d)T00:00:00.000+00:00' where id = 4;"
t "Toby nació hace 10 días" 200 GET /api/mascotas/codigo/DOGGY-7741-TOBY
v "edad: 0 meses (menos de 1 mes)" 0 "$(jget .edadMeses)"
sql "update Mascota set fechaNacimiento = '$(fecha -40d +%Y-%m-%d)T00:00:00.000+00:00' where id = 4;"
t "Toby nació hace 40 días" 200 GET /api/mascotas/codigo/DOGGY-7741-TOBY
v "edad: 1 mes" 1 "$(jget .edadMeses)"
sql "update Mascota set fechaNacimiento = '$(fecha -3y +%Y-%m-%d)T00:00:00.000+00:00' where id = 4;"
t "Toby cumplió 3 años hoy" 200 GET /api/mascotas/codigo/DOGGY-7741-TOBY
v "edad: 36 meses" 36 "$(jget .edadMeses)"
v "del dueño, solo el nombre (Toby no está perdido)" nombre "$(jmap 'Object.keys(r.dueno).join()')"
v "nombre de la dueña" Lucía "$(jget .dueno.nombre)"
t "mascota propia (Luna)" 200 GET /api/mascotas/codigo/DOGGY-8492-LUNA
v "es Luna" 1 "$(jget .id)"
v "no trae tutorId" sí "$(jok '!("tutorId" in r)')"
# El teléfono de Sofía lo cambia la sección "Usuario": se compara con el de la base.
TEL_SOFIA=$(sql "select telefonoEmergencia from Usuario where id = 1;")
v "asignada: trae el teléfono aunque no esté perdida" "$TEL_SOFIA" "$(jget .dueno.telefono)"
como "$LUCIA"
t "Luna sin reporte de perdida (Lucía)" 200 GET /api/mascotas/codigo/DOGGY-8492-LUNA
v "sin teléfono del dueño" sí "$(jok '!("telefono" in r.dueno)')"
t "Milo con un encontrado activo (Lucía)" 200 GET /api/mascotas/codigo/DOGGY-5610-MILO
v "un encontrado no suma el teléfono" sí "$(jok '!("telefono" in r.dueno)')"
LUNA_PERDIDA=$(reporte_de 1 1 perdido Luna)
t "Luna perdida (Lucía)" 200 GET /api/mascotas/codigo/DOGGY-8492-LUNA
v "con el teléfono de la dueña" "$TEL_SOFIA" "$(jget .dueno.telefono)"
sql "update ReportePerdida set cerradoEn = '$(fecha -u +%Y-%m-%dT%H:%M:%S.000+00:00)' where id = $LUNA_PERDIDA;"
t "Luna ya apareció (Lucía)" 200 GET /api/mascotas/codigo/DOGGY-8492-LUNA
v "cerrado el reporte, ya no trae el teléfono" sí "$(jok '!("telefono" in r.dueno)')"
como "$SOFIA"
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
t "alta válida con refuerzo" 201 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\",\"proximaDosis\":\"$(fecha +1y +%Y-%m-%d)\",\"fotoEtiqueta\":\"$FOTO_ETIQUETA\",\"mascotaId\":4}"
REG=$(jget .id)
v "guarda la foto de la etiqueta" "$FOTO_ETIQUETA" "$(jget .fotoEtiqueta)"
v "fecha como AAAA-MM-DD" "$HOY" "$(jget .fecha)"
v "mascota de la URL, no la del body" 1 "$(jget .mascotaId)"
t "etiqueta con URI del navegador" 400 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\",\"fotoEtiqueta\":\"blob:http://localhost:8081/abc\"}"
t "fecha futura" 400 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$MANANA\",\"profesional\":\"Vet. San Roque\"}"
t "fecha de hace 31 años" 400 POST /api/mascotas/1/registros '{"tipo":"vacuna","nombre":"Antirrábica","fecha":"1990-01-01","profesional":"Vet. San Roque"}'
t "día inexistente" 400 POST /api/mascotas/1/registros '{"tipo":"vacuna","nombre":"Antirrábica","fecha":"2026-02-31","profesional":"Vet. San Roque"}'
t "refuerzo anterior" 400 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\",\"proximaDosis\":\"$AYER\"}"
t "refuerzo a 6 años" 400 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\",\"proximaDosis\":\"$(fecha +6y +%Y-%m-%d)\"}"
t "'otro' sin descripción" 400 POST /api/mascotas/1/registros "{\"tipo\":\"otro\",\"nombre\":\"\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\"}"
v "pide la descripción (el nombre)" sí "$(jok 'r.error.includes("nombre")')"
t "'otro' con descripción" 201 POST /api/mascotas/1/registros "{\"tipo\":\"otro\",\"nombre\":\"Castración\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\"}"
v "la descripción queda como nombre" "otro Castración" "$(jmap 'r.tipo + " " + r.nombre')"
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
sql "insert into Turno (mascotaId,categoria,fecha,motivo,lugar) values (1,'peluqueria','$(fecha -u -2d +%Y-%m-%dT15:00:00.000+00:00)','Baño','Peluquería Canina');"
PASADO=$(sql "select max(id) from Turno;")
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
v "nombre, raza y señas salen de la mascota, no del body" "$(sql "select nombre || ' · ' || raza || ' · ' || senas from Mascota where id = 2;")" "$(jmap 'r.nombre + " · " + r.raza + " · " + r.descripcion')"
v "etiquetas como lista" "Collar azul,Asustadizo" "$(jget .etiquetas)"
t "segundo perdido de la misma mascota" 409 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":2,\"nombre\":\"Roco\",\"raza\":\"Beagle\",\"descripcion\":\"Collar azul con chapita\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"
v "mensaje del 409" "Esta mascota ya está reportada como perdida. No se puede reportar de nuevo." "$(jget .error)"
t "perdido de mascota ajena" 403 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":4,\"nombre\":\"Toby\",\"raza\":\"Caniche\",\"descripcion\":\"Pelo blanco con rulos\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"
t "encontrado sin código (con mascotaId)" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":4,\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
v "mensaje del 400" "Escaneá el QR de su chapita para avisar que la encontraste." "$(jget .error)"
t "encontrado sin código ni mascota (anónimo)" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":null,\"nombre\":\"Sin identificar\",\"raza\":\"Mestizo\",\"descripcion\":\"Perro marrón chico\",\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
t "encontrado con código de mascota ajena, que no está perdida" 201 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\" doggy-7741-toby \",\"nombre\":\"Firulais\",\"raza\":\"Caniche\",\"descripcion\":\"Otro texto\",\"foto\":\"milo\",\"etiquetas\":[\"Collar\"],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"infoAdicional\":\"La vi en la plaza, tiene collar rojo\"}"
QR_PROPIO=$(jget .id)
v "nombre, raza, foto y señas salen de la mascota, no del body" "$(sql "select nombre || ' · ' || raza || ' · ' || foto || ' · ' || senas from Mascota where id = 4;")" "$(jmap 'r.nombre + " · " + r.raza + " · " + r.foto + " · " + r.descripcion')"
v "sin etiquetas" "" "$(jget .etiquetas)"
v "el comentario de quien la encontró va en infoAdicional" "La vi en la plaza, tiene collar rojo" "$(jget .infoAdicional)"
v "queda vinculado a Toby" 4 "$(jget .mascotaId)"
t "encontrado repetido de Toby del mismo usuario" 409 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-7741-TOBY\",\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
v "mensaje del 409" "Ya avisaste que encontraste a esta mascota." "$(jget .error)"
t "perdido de una mascota que no existe" 404 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":9999,\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"
t "perdido sin mascota" 400 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":null,\"nombre\":\"Sin nombre\",\"raza\":\"Mestizo\",\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"
t "encontrado con radio" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-5610-MILO\",\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"
t "encontrado con latitud fuera de rango" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-7741-TOBY\",\"lat\":-134.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
t "etiquetas repetidas" 400 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":2,\"radioMetros\":500,\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[\"Collar\",\"collar\"],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
t "6 etiquetas" 400 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":2,\"radioMetros\":500,\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[\"Uno\",\"Dos\",\"Tres\",\"Cuatro\",\"Cinco\",\"Seis\"],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
t "latitud fuera de rango" 400 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":2,\"radioMetros\":500,\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[],\"lat\":-134.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
t "fecha futura" 400 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":2,\"radioMetros\":500,\"descripcion\":\"Perro marrón chico\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$FUT_ISO\"}"
t "foto con URI del celular" 400 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":2,\"radioMetros\":500,\"descripcion\":\"Perro marrón chico\",\"foto\":\"file:///tmp/perro.jpg\",\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\"}"
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
v "cerradoEn quedó guardado en la base" 1 "$(sql "select cerradoEn is not null from ReportePerdida where id = $REP;")"
t "cerrar otra vez" 409 PATCH /api/reportes/$REP '{"cerrado":true}'
t "reportes activos después de cerrar" 200 GET /api/reportes
v "el cerrado ya no sale" sí "$(jok "!r.some((x) => x.id === $REP)")"
t "nuevo perdido de Roco tras cerrar" 201 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":2,\"nombre\":\"Roco\",\"raza\":\"Beagle\",\"descripcion\":\"Collar azul con chapita\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"


# Quién edita o cierra un reporte: el autor o alguien asignado a la mascota.
R_CARLOS=$(reporte_de "$CARLOS_ID" 1 perdido Luna)   # Carlos, co-dueño de Luna
R_TOBY=$(reporte_de 20 4 perdido Toby)     # Lucía, dueña de Toby
t "perdido de Luna publicado por Carlos: lo edita la dueña" 200 PATCH /api/reportes/$R_CARLOS '{"zona":"Villa Crespo, CABA"}'
v "el autor sigue siendo Carlos" "$CARLOS_ID" "$(jget .autorId)"
t "perdido de Luna publicado por Carlos: lo cierra la dueña" 200 PATCH /api/reportes/$R_CARLOS '{"cerrado":true}'
v "sin encontrado: Apareció" aparecio "$(jget .resultado)"
R_QR=$(reporte_de "$VALENTINA_ID" 1 encontrado Luna)     # Valentina encontró a Luna por el QR
t "encontrado de Luna (QR) sin perdido: lo cierra la dueña" 200 PATCH /api/reportes/$R_QR '{"cerrado":true}'
v "No, está conmigo: Descartado" descartado "$(jget .resultado)"
t "encontrado de Milo del seed: No, está conmigo" 200 PATCH /api/reportes/2 '{"cerrado":true}'
v "Descartado, con la fecha" "descartado sí" "$(jget .resultado) $(jok 'typeof r.cerradoEn === "string"')"
ANONIMO=$(reporte_de "$VALENTINA_ID" NULL encontrado Perro)   # un encontrado anónimo de antes (Valentina)
t "encontrado anónimo de antes, de otro autor: cerrar" 403 PATCH /api/reportes/$ANONIMO '{"cerrado":true}'
t "encontrado anónimo de antes, de otro autor: editar" 403 PATCH /api/reportes/$ANONIMO '{"zona":"Palermo, CABA"}'
t "perdido de Toby sin tenerlo asignado" 403 PATCH /api/reportes/$R_TOBY '{"zona":"Palermo, CABA"}'
t "encontrado propio: el autor corrige el punto y el comentario" 200 PATCH /api/reportes/$QR_PROPIO '{"zona":"Villa Crespo, CABA","infoAdicional":"Sin collar"}'
v "zona y comentario nuevos" "Villa Crespo, CABA · Sin collar" "$(jmap 'r.zona + " · " + r.infoAdicional')"
t "encontrado: el nombre no se edita" 400 PATCH /api/reportes/$QR_PROPIO '{"nombre":"Firulais"}'
t "encontrado: la foto no se edita" 400 PATCH /api/reportes/$QR_PROPIO '{"foto":null}'
t "encontrado: la descripción no se edita" 400 PATCH /api/reportes/$QR_PROPIO '{"descripcion":"Otra cosa"}'

seccion "Reportes: perdido hasta que la familia la recupera"
# Un perdido de Luna (Sofía) y el encontrado de Lucía, que no está asignada a Luna.
PERDIDO_LUNA="{\"estado\":\"perdido\",\"mascotaId\":1,\"descripcion\":\"Collar rojo con chapita\",\"foto\":null,\"etiquetas\":[],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"
ENCONTRADO_LUNA="{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-8492-LUNA\",\"infoAdicional\":\"Estaba en la plaza con la chapita\",\"lat\":-34.57,\"lng\":-58.43,\"zona\":\"Colegiales, CABA\",\"fecha\":\"$AHORA_ISO\"}"
# Estado de un reporte en la base: "<resultado>|<1 si está cerrado>".
cierre_de() { sql "select resultado, cerradoEn is not null from ReportePerdida where id = $1;"; }
como "$SOFIA"
t "perdido de Luna" 201 POST /api/reportes "$PERDIDO_LUNA"
P_LUNA=$(jget .id)
como "$LUCIA"
t "encontrado de Luna con el perdido activo" 201 POST /api/reportes "$ENCONTRADO_LUNA"
E_LUNA=$(jget .id)
t "reportes activos después del encontrado" 200 GET /api/reportes
v "el perdido sigue activo" sí "$(jok "r.some((x) => x.id === $P_LUNA)")"
v "y el encontrado también" sí "$(jok "r.some((x) => x.id === $E_LUNA)")"
v "el perdido no se cerró en la base" "|0" "$(cierre_de "$P_LUNA")"
t "quien no es dueña ni está asignada: cerrar el perdido" 403 PATCH /api/reportes/$P_LUNA '{"cerrado":true}'
v "el perdido sigue abierto" "|0" "$(cierre_de "$P_LUNA")"
como "$SOFIA"
t "Ya volvió a casa (cierra el encontrado)" 200 PATCH /api/reportes/$E_LUNA '{"cerrado":true}'
v "Devuelta a su familia, con la fecha" "devuelta sí" "$(jget .resultado) $(jok 'typeof r.cerradoEn === "string"')"
v "el perdido se cerró con el mismo resultado" "devuelta|1" "$(cierre_de "$P_LUNA")"
v "con la misma fecha" 1 "$(sql "select count(distinct cerradoEn) from ReportePerdida where id in ($P_LUNA, $E_LUNA);")"
t "reportes activos después de recuperarla" 200 GET /api/reportes
v "no sale ninguno de los dos" sí "$(jok "!r.some((x) => x.id === $P_LUNA || x.id === $E_LUNA)")"
# Desde el perdido ("Ya apareció" con un encontrado activo) también es Devuelta y cierra los dos.
t "otro perdido de Luna" 201 POST /api/reportes "$PERDIDO_LUNA"
P_LUNA=$(jget .id)
como "$LUCIA"
t "otro encontrado de Luna" 201 POST /api/reportes "$ENCONTRADO_LUNA"
E_LUNA=$(jget .id)
como "$CARLOS"
t "el co-dueño cierra el perdido" 200 PATCH /api/reportes/$P_LUNA '{"cerrado":true}'
v "Devuelta a su familia" devuelta "$(jget .resultado)"
v "el encontrado se cerró con el mismo resultado" "devuelta|1" "$(cierre_de "$E_LUNA")"
como "$SOFIA"
t "perdido de Luna sin encontrado" 201 POST /api/reportes "$PERDIDO_LUNA"
P_LUNA=$(jget .id)
t "Ya apareció" 200 PATCH /api/reportes/$P_LUNA '{"cerrado":true}'
v "Apareció" aparecio "$(jget .resultado)"
v "guardado en la base" "aparecio|1" "$(cierre_de "$P_LUNA")"

seccion "Reportes: encontrados vinculados y reencuentros"
# Lucía no está asignada a Luna; Sofía y Carlos son sus dueños. Luna no tiene reportes activos.
CUERPO_HALLAZGO="\"infoAdicional\":\"Está conmigo, tiene la chapita\",\"lat\":-34.57,\"lng\":-58.43,\"zona\":\"Colegiales, CABA\",\"fecha\":\"$AHORA_ISO\""
como "$LUCIA"
t "encontrado de Luna sin código" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":1,$CUERPO_HALLAZGO}"
t "código con otro formato" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"hola\",$CUERPO_HALLAZGO}"
t "código que no es de nadie" 404 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-0000-NADIE\",$CUERPO_HALLAZGO}"
t "código de otra mascota que el mascotaId" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":2,\"codigo\":\"DOGGY-8492-LUNA\",$CUERPO_HALLAZGO}"
t "perdido con código" 400 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":4,\"codigo\":\"DOGGY-7741-TOBY\",\"radioMetros\":500,$CUERPO_HALLAZGO}"
t "QR de Luna sin perdido (caso dudoso)" 201 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-8492-LUNA\",$CUERPO_HALLAZGO}"
E_DUDA=$(jget .id)
v "vinculado a Luna" "1 Luna" "$(jget .mascotaId) $(jget .nombre)"
t "segundo encontrado de Luna de Lucía" 409 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-8492-LUNA\",$CUERPO_HALLAZGO}"
t "reportes activos (Lucía, que la encontró)" 200 GET /api/reportes
v "su encontrado trae el contacto de la dueña" Sofía "$(jmap "r.find((x) => x.id === $E_DUDA).contacto.nombre")"
como "$SOFIA"
t "la dueña avisa que encontró a Luna" 403 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-8492-LUNA\",$CUERPO_HALLAZGO}"
v "mensaje del 403" "Esta mascota está en tu cuenta: no hace falta avisar que la encontraste." "$(jget .error)"
t "reportes activos (Sofía)" 200 GET /api/reportes
v "el encontrado trae el contacto de Lucía" Lucía "$(jmap "r.find((x) => x.id === $E_DUDA).contacto.nombre")"
como "$VALENTINA"
t "reportes activos (Valentina, ajena a Luna)" 200 GET /api/reportes
v "el encontrado de Lucía no trae contacto" sí "$(jok "!(\"contacto\" in r.find((x) => x.id === $E_DUDA))")"
t "Valentina no se vincula sin código" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":1,$CUERPO_HALLAZGO}"

# Sí, se perdió: crea el perdido con el lugar y la hora del encontrado.
como "$LUCIA"
t "Sí, se perdió: quien la encontró" 403 POST /api/reportes/$E_DUDA/perdida
como "$SOFIA"
t "Sí, se perdió: id inválido" 400 POST /api/reportes/abc/perdida
t "Sí, se perdió: no existe" 404 POST /api/reportes/9999/perdida
t "Sí, se perdió: encontrado anónimo de antes" 403 POST /api/reportes/$ANONIMO/perdida
t "Sí, se perdió" 201 POST /api/reportes/$E_DUDA/perdida
P_REENC=$(jget .id)
v "es un perdido de Luna, de Sofía" "perdido 1 1" "$(jget .estado) $(jget .mascotaId) $(jget .autorId)"
v "con el lugar del encontrado y las señas de Luna" "Colegiales, CABA · -34.57" "$(jmap 'r.zona + " · " + r.lat')"
v "sin radio" sí "$(jok '!("radioMetros" in r)')"
t "Sí, se perdió otra vez" 409 POST /api/reportes/$E_DUDA/perdida
t "Sí, se perdió sobre un perdido" 409 POST /api/reportes/$P_REENC/perdida
t "otro perdido de Luna" 409 POST /api/reportes "$PERDIDO_LUNA"

# Desde el mapa ya no se puede avisar: hace falta el código aunque Luna esté perdida.
como "$VALENTINA"
t "encontrado de una mascota perdida sin código" 400 POST /api/reportes "{\"estado\":\"encontrado\",\"mascotaId\":1,$CUERPO_HALLAZGO}"
t "otra persona escanea el QR de Luna perdida" 201 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-8492-LUNA\",$CUERPO_HALLAZGO}"
E_MAPA=$(jget .id)
t "reportes activos (Valentina)" 200 GET /api/reportes
v "su encontrado trae a Sofía, que publicó el perdido" Sofía "$(jmap "r.find((x) => x.id === $E_MAPA).contacto.nombre")"
v "el de Lucía no le trae contacto" sí "$(jok "!(\"contacto\" in r.find((x) => x.id === $E_DUDA))")"
t "quien la encontró no cierra el perdido" 403 PATCH /api/reportes/$P_REENC '{"cerrado":true}'
como "$CARLOS"
t "reportes activos (Carlos, co-dueño)" 200 GET /api/reportes
v "ve el contacto de las dos personas que la encontraron" "Lucía,Valentina" "$(jmap "[$E_DUDA, $E_MAPA].map((id) => r.find((x) => x.id === id).contacto.nombre).join()")"
v "el perdido no trae contacto" sí "$(jok "!(\"contacto\" in r.find((x) => x.id === $P_REENC))")"
t "Ya volvió a casa (desde el aviso, cierra un encontrado)" 200 PATCH /api/reportes/$E_MAPA '{"cerrado":true}'
v "Devuelta a su familia" devuelta "$(jget .resultado)"
v "se cerró el perdido" "devuelta|1" "$(cierre_de "$P_REENC")"
v "y el otro encontrado" "devuelta|1" "$(cierre_de "$E_DUDA")"

# No, está conmigo: cierra el encontrado como descartado.
como "$LUCIA"
t "QR de Luna otra vez, sin perdido" 201 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-8492-LUNA\",$CUERPO_HALLAZGO}"
E_DUDA=$(jget .id)
como "$CARLOS"
t "No, está conmigo" 200 PATCH /api/reportes/$E_DUDA '{"cerrado":true}'
v "Descartado" descartado "$(jget .resultado)"
t "Sí, se perdió sobre un encontrado cerrado" 409 POST /api/reportes/$E_DUDA/perdida
como "$LUCIA"
t "QR de Luna: quien la encontró cierra su aviso" 201 POST /api/reportes "{\"estado\":\"encontrado\",\"codigo\":\"DOGGY-8492-LUNA\",$CUERPO_HALLAZGO}"
E_DUDA=$(jget .id)
t "lo cierra quien lo publicó" 200 PATCH /api/reportes/$E_DUDA '{"cerrado":true}'
v "sin resultado" sí "$(jok '!("resultado" in r)')"
como "$SOFIA"

seccion "Invitaciones y cuidadores"
t "genera código (dueña de Luna)" 201 POST /api/mascotas/1/invitaciones '{"rol":"invitado"}'
CODIGO_LUNA=$(jget .token)
v "código de 8 caracteres" 8 "${#CODIGO_LUNA}"
v "trae la mascota" Luna "$(jget .mascota.nombre)"
v "no trae vencimiento (es de un solo uso)" no "$(jok '"vence" in r')"
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

seccion "Quitar invitados"
# Roco (2): Sofía dueña, Julián y Marcos invitados. Milo (3): Sofía y Sol dueñas. Luna (1): la clínica, invitada.
como "$MARCOS"
t "un invitado no quita a la dueña" 403 DELETE /api/mascotas/2/cuidadores/1
v "dice que solo un dueño puede" "Solo un dueño de Roco puede quitar a otras personas." "$(jget .error)"
como "$LUCIA"
t "alguien sin asignar no quita a nadie" 403 DELETE /api/mascotas/2/cuidadores/$MARCOS_ID
como "$SOFIA"
t "quitar a quien no está asignado (Lucía)" 404 DELETE /api/mascotas/2/cuidadores/20
v "dice que no está asignada" "Esa persona no está asignada a Roco." "$(jget .error)"
t "id de usuario inválido" 400 DELETE /api/mascotas/2/cuidadores/abc
t "mascota no existe" 404 DELETE /api/mascotas/9999/cuidadores/$MARCOS_ID
t "una dueña no quita a otra dueña (Sol, de Milo)" 403 DELETE /api/mascotas/3/cuidadores/$SOL_ID
t "única dueña, con su propio id" 409 DELETE /api/mascotas/2/cuidadores/1
t "la dueña quita a Marcos (invitado de Roco)" 204 DELETE /api/mascotas/2/cuidadores/$MARCOS_ID
v "Marcos ya no está asignado" 0 "$(sql "select count(*) from Cuidador where mascotaId = 2 and usuarioId = $MARCOS_ID;")"
t "quitarlo otra vez" 404 DELETE /api/mascotas/2/cuidadores/$MARCOS_ID
como "$MARCOS"
t "Marcos ya no ve a Roco" 200 GET /api/mascotas
v "Roco no está en su lista" sí "$(jok '!r.some((m) => m.id === 2)')"
como "$VET"
t "una invitada se va con su propio id (Luna)" 204 DELETE /api/mascotas/1/cuidadores/$VET_ID
v "la clínica ya no está asignada a Luna" 0 "$(sql "select count(*) from Cuidador where mascotaId = 1 and usuarioId = $VET_ID;")"

seccion "Borrar mascota"
# Una mascota de Sofía con todo lo que puede tener: fotos, carnet, turno,
# reporte con etiquetas, un encontrado de otra persona, un código sin usar y Lucía de invitada.
como "$SOFIA"
subir "foto de la mascota a borrar" 201 "$F_JPG"
FOTO_NUBE=$(jget .foto)
subir "foto de la etiqueta de su vacuna" 201 "$F_PNG"
FOTO_NUBE_ETIQUETA=$(jget .foto)
t "alta de Nube" 201 POST /api/mascotas "{\"nombre\":\"Nube\",\"raza\":\"Mestizo\",\"fechaNacimiento\":\"2022-03-01\",\"senas\":\"Mancha gris en la oreja\",\"foto\":\"$FOTO_NUBE\"}"
NUBE=$(jget .id)
t "vacuna de Nube con foto de la etiqueta" 201 POST /api/mascotas/$NUBE/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\",\"fotoEtiqueta\":\"$FOTO_NUBE_ETIQUETA\"}"
t "turno de Nube" 201 POST /api/turnos "{\"mascotaId\":$NUBE,\"categoria\":\"veterinario\",\"fecha\":\"$FUT_ISO\",\"motivo\":\"Control\",\"lugar\":\"Vet. San Roque\"}"
t "Nube se perdió" 201 POST /api/reportes "{\"estado\":\"perdido\",\"mascotaId\":$NUBE,\"descripcion\":\"Mancha gris en la oreja\",\"foto\":null,\"etiquetas\":[\"Collar verde\"],\"lat\":-34.58,\"lng\":-58.42,\"zona\":\"Palermo, CABA\",\"fecha\":\"$AHORA_ISO\",\"radioMetros\":500}"
reporte_de 20 "$NUBE" encontrado Nube > /dev/null
t "código para Lucía" 201 POST /api/mascotas/$NUBE/invitaciones '{"rol":"invitado"}'
CODIGO_NUBE=$(jget .token)
t "código que queda sin usar" 201 POST /api/mascotas/$NUBE/invitaciones '{"rol":"dueno"}'
como "$LUCIA"
t "Lucía acepta y queda de invitada" 200 POST /api/invitaciones/$CODIGO_NUBE/aceptar
t "una invitada no la borra" 403 DELETE /api/mascotas/$NUBE
v "dice que solo un dueño puede" "Solo un dueño de Nube puede eliminarla." "$(jget .error)"
como "$CARLOS"
t "alguien sin asignar no la borra" 403 DELETE /api/mascotas/$NUBE
como "$SOFIA"
t "id inválido" 400 DELETE /api/mascotas/abc
t "no existe" 404 DELETE /api/mascotas/9999
# Contar todo lo de Nube en una sola consulta: mascota|carnet|turnos|reportes|etiquetas|códigos|asignaciones.
de_nube() {
  sql "select (select count(*) from Mascota where id = $NUBE) || '|' || (select count(*) from RegistroSanitario where mascotaId = $NUBE) || '|' || (select count(*) from Turno where mascotaId = $NUBE) || '|' || (select count(*) from ReportePerdida where mascotaId = $NUBE) || '|' || (select count(*) from Etiqueta where reporteId in (select id from ReportePerdida where mascotaId = $NUBE)) || '|' || (select count(*) from Invitacion where mascotaId = $NUBE) || '|' || (select count(*) from Cuidador where mascotaId = $NUBE);"
}
v "antes de borrar tiene de todo" "1|1|1|2|1|2|2" "$(de_nube)"
t "la dueña la borra" 204 DELETE /api/mascotas/$NUBE
v "no queda nada de Nube en la base" "0|0|0|0|0|0|0" "$(de_nube)"
v "se borró la foto de la mascota" no "$(hay_archivo "$FOTO_NUBE")"
v "se borró la foto de la etiqueta" no "$(hay_archivo "$FOTO_NUBE_ETIQUETA")"
t "borrarla otra vez" 404 DELETE /api/mascotas/$NUBE
como "$LUCIA"
t "Lucía ya no la ve" 200 GET /api/mascotas
v "Nube no está en su lista" sí "$(jok "!r.some((m) => m.id === $NUBE)")"
t "ni su reporte en el mapa" 200 GET /api/reportes
v "ningún reporte de Nube" sí "$(jok "!r.some((x) => x.mascotaId === $NUBE)")"

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
