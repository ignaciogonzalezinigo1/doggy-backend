#!/bin/bash
# Pruebas de la API de Doggy con curl.
#
# Resetea la base con los datos del seed, levanta el servidor en el puerto 3001,
# prueba todos los endpoints (también sus casos de error) y muestra una tabla
# con el endpoint, el caso, el status esperado y el obtenido. Además chequea
# partes del contenido de algunas respuestas. Sale con 1 si algo falla.
#
# Uso: npm test (o bash scripts/probar.sh). Necesita curl y sqlite3.
# Ojo: borra lo que haya en la base y vuelve a cargar los datos de ejemplo.

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

# Archivo de la base: el de DATABASE_URL del .env, relativo a la raíz.
URL_DB=$(grep -E '^DATABASE_URL=' .env | head -n 1 | cut -d= -f2- | tr -d "\"'")
DB="$RAIZ/${URL_DB#file:./}"
[ -n "$URL_DB" ] || DB="$RAIZ/dev.db"

if curl -s -o /dev/null "$API/api/health"; then
  abortar "ya hay algo escuchando en el puerto $PUERTO. Bajalo y volvé a correr las pruebas."
fi

echo "Reseteando la base ($DB)…"
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

# Hace un pedido y compara el status: t <caso> <esperado> <método> <ruta> [body]
# La respuesta queda en $LAST para las verificaciones que siguen.
t() {
  local caso="$1" esperado="$2" metodo="$3" ruta="$4" body="${5:-}" status
  if [ -n "$body" ]; then
    status=$(curl -s -o "$OUT" -w '%{http_code}' -X "$metodo" -H 'Content-Type: application/json' -d "$body" "$API$ruta")
  else
    status=$(curl -s -o "$OUT" -w '%{http_code}' -X "$metodo" "$API$ruta")
  fi
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

seccion "Lecturas"
t "API levantada" 200 GET /api/health
v "responde { ok: true }" true "$(jget .ok)"
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

seccion "Usuario"
t "datos válidos" 200 PATCH /api/usuarios/me '{"ubicacion":"Palermo, CABA","telefonoEmergencia":"+54 11 5555-1234","passwordHash":"x"}'
t "email en mayúsculas" 200 PATCH /api/usuarios/me '{"email":" Sofia.Romero@MAIL.com "}'
v "se guarda limpio y en minúsculas" sofia.romero@mail.com "$(jget .email)"
t "nombre con números" 400 PATCH /api/usuarios/me '{"nombre":"Sofi4"}'
t "teléfono corto" 400 PATCH /api/usuarios/me '{"telefonoEmergencia":"123"}'
t "body vacío" 400 PATCH /api/usuarios/me '{}'
t "email de otra cuenta" 409 PATCH /api/usuarios/me '{"email":"lucia.gomez@mail.com"}'

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

seccion "Registros"
t "alta válida con refuerzo" 201 POST /api/mascotas/1/registros "{\"tipo\":\"vacuna\",\"nombre\":\"Antirrábica\",\"fecha\":\"$HOY\",\"profesional\":\"Vet. San Roque\",\"proximaDosis\":\"$(date -v+1y +%Y-%m-%d)\",\"fotoEtiqueta\":\"etiqueta-1\",\"mascotaId\":4}"
REG=$(jget .id)
v "fecha como AAAA-MM-DD" "$HOY" "$(jget .fecha)"
v "mascota de la URL, no la del body" 1 "$(jget .mascotaId)"
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
t "foto de etiqueta en 'otro'" 400 PATCH /api/registros/$REG '{"fotoEtiqueta":"x"}'
t "id inválido" 400 PATCH /api/registros/0 '{"nombre":"Quíntuple"}'
t "registro de mascota ajena" 403 PATCH /api/registros/$TOBY_REG '{"nombre":"Quíntuple"}'
t "no existe" 404 PATCH /api/registros/9999 '{"nombre":"Quíntuple"}'
t "borrar de mascota ajena" 403 DELETE /api/registros/$TOBY_REG
t "borrar" 204 DELETE /api/registros/$REG
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
TOKEN=$(jget .token)
v "código de 8 caracteres" 8 "${#TOKEN}"
v "trae la mascota" Luna "$(jget .mascota.nombre)"
t "rol inválido" 400 POST /api/mascotas/1/invitaciones '{"rol":"admin"}'
t "mascota no asignada (Toby)" 403 POST /api/mascotas/4/invitaciones '{"rol":"invitado"}'
t "mascota no existe" 404 POST /api/mascotas/9999/invitaciones '{"rol":"invitado"}'
t "ver código propio" 200 GET /api/invitaciones/$TOKEN
t "aceptar código de mascota propia" 409 POST /api/invitaciones/$TOKEN/aceptar
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
