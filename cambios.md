# Cambios propuestos a CLAUDE.md (rol B — backend)

Este archivo junta los cambios y decisiones del backend que afectan a todo el equipo. Va aparte para no generar
conflictos con `CLAUDE.md` en las otras ramas. Cuando los tres estén de acuerdo, se pasa a `CLAUDE.md` en un commit
propio y se borra este archivo.

Detalle técnico completo: `backend/README.md`. Datos y MIDI: `data/README.md`.

---

## 1. Base de datos: PostgreSQL en TigerData (sección 3)

- La base pasa de SQLite a **PostgreSQL en TigerData** (Postgres administrado con TimescaleDB), para optar al premio
  "Best Use of Tiger Data" de MLH. TigerData da una prueba gratis de 30 días sin tarjeta.
- En local, sin `DATABASE_URL`, el backend usa **PGlite**: un Postgres que corre dentro de Node y guarda los datos
  en `backend/.pglite/` (no va al repo). No hay que instalar nada y se trabaja sin internet. Mismo SQL en los dos casos.
- Librerías: `pg` (TigerData) y `@electric-sql/pglite` (local).
- Las rutas, los contratos y los datos de `/data` no cambian. El frontend no tiene que tocar nada.

**Cambio propuesto en la tabla de stack:** `Base de datos | PostgreSQL: TigerData en producción, PGlite en desarrollo`.

## 2. Variables de entorno nuevas (sección 3)

Backend (agregar a la lista):

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `DATABASE_URL` | — (usa PGlite local) | Cadena de conexión de TigerData: `postgres://tsdbadmin:...@<host>:<puerto>/tsdb?sslmode=verify-full` |
| `PG_POOL_MAX` | `5` | Opcional, conexiones máximas a Postgres por instancia |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Opcional, para cambiar el modelo del copiloto |

El copiloto va a pasar a **Gemini** (gratis en la hackathon). Ese cambio lo trae otra rama del equipo; cuando se
junte, su variable de entorno reemplaza a `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`.

`ANTHROPIC_API_KEY` y `PORT` siguen igual. Están todas en `backend/.env.example`.

## 3. Rutas extra de la API (sección 4.3)

No se cambió ninguna ruta del contrato. Se agregaron estas, porque sin ellas no se puede guardar una canción ni
armar su árbol:

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/health` | Estado de la base y cantidad de piezas/canciones |
| POST | `/piezas` | Crea una pieza original (el id se genera solo) |
| GET | `/piezas/:id/diff` | Diff de un fork contra su padre (sin tener que pasar `:otra`) |
| GET | `/canciones` | Lista las canciones |
| GET | `/canciones/:id` | Devuelve una canción (contrato 4.2) |
| POST | `/canciones` | Crea una canción (contrato 4.2 sin `id`). Todos los `pieza_id` deben existir |
| PUT | `/canciones/:id` | Reemplaza nombre, tempo, pistas y bloques |

`GET /piezas` acepta además `?autor=`.

## 4. Campos extra en las respuestas (sección 4.3)

Solo se agregan campos; los del contrato no cambian.

- **Diff** (`/piezas/:id/diff/:otra`): `original` y `modificada` (ids) dicen qué pieza cumplió cada rol.
- **Árbol** (`/canciones/:id/arbol`):
  - cada nodo trae además `fuente` (atribución) y `en_cancion` (`true` si la pieza está en la canción, `false` si
    solo es un ancestro);
  - `cancion: { id, nombre, autor }`, para resaltar lo que aportó el usuario;
  - `resumen: { piezas, autores }`, para el "esta canción tiene N piezas de M autores" de la demo.
- **Fork** (`POST /piezas/:id/fork`): además de `autor`, el body acepta `nombre` opcional. Sin `autor`, el fork queda
  como `"anonymous"`. El fork hereda la licencia y su `fuente` queda como `"Fork of p-XXX"`.

## 5. Reglas que conviene saber (secciones 4.1 y 5)

- **Orden del diff:** en `/piezas/:id/diff/:otra`, `:id` es la pieza modificada y `:otra` la de referencia. Si una es
  ancestro de la otra, el ancestro siempre se toma como original, se pasen en el orden que se pasen.
- **Diff:** sigue la sección 5 al pie de la letra. Si solo cambia la `duracion` o la `velocidad` de una nota, cuenta
  como `iguales`. Una nota cuenta como "movida" solo si se mueve hasta 4 pulsos o 12 semitonos; más lejos aparece
  como borrada + nueva.
- **Normalización al guardar:** los tags de `estilo` se guardan en minúscula, sin tildes y sin guiones
  (`"romántica"` → `"romantica"`, `"lo-fi"` → `"lofi"`, `"boom bap"` → `"boombap"`); `tonalidad` se guarda en notación corta (`"La menor"` o `"A minor"` → `"Am"`). La búsqueda `?q=`
  ignora mayúsculas y tildes.
- **`PUT /piezas/:id`:** reemplaza toda la lista de notas. También acepta `nombre`, `tonalidad`, `tempo`, `estilo` y
  `compases`. No se pueden cambiar `autor`, `tipo`, `licencia` ni `parent_id` (protege el linaje).
- **Ids:** se generan en secuencia (`p-016`, `c-002`...).

## 6. Datos provisorios (sección 6)

- `data/piezas/p-001` a `p-015` y `data/canciones/c-001` son **provisorios** (y todavía de salsa) para poder
  trabajar mientras el rol C prepara las piezas reales. Su `fuente` lo dice. Se pueden reemplazar con los mismos ids.
  Los ritmos reales del Groove MIDI (`data/piezas/groove.json`, `p-101` a `p-402`) se cargan junto con ellos.
- Valores de `instrumento`: `bateria`, `piano`, `bajo`, `melodia` (confirmado por el frontend).
- Las piezas se cargan con `npm run db:seed` desde `backend/`. Los MIDI se convierten con `npm run import:midi`
  (ver `data/README.md`).

## 7. Copiloto (sección 4.4)

- Modelo `claude-opus-5-5`, solo las dos herramientas acordadas (`buscar_piezas`, `describir_estilo`).
- La respuesta final sale siempre como `{ texto, piezas_sugeridas }` y los ids se verifican contra la base: nunca
  sugiere una pieza que no exista.
- **Rol C:** el prompt del sistema está en `backend/src/copilot/systemPrompt.js` y los rasgos de estilo en
  `backend/src/copilot/styles.js`; se pueden editar sin tocar el resto.
- Sin `ANTHROPIC_API_KEY`, `/copiloto` responde 503 y el resto de la API funciona igual.

## 8. Cuentas de usuario (sección 2: pasa de "Fuera" a "Importante")

- **Decisión:** el equipo decidió tener cuentas reales (antes estaban en la lista "Fuera"). Login propio con
  email + contraseña, guardado en TigerData; no se usa Supabase ni otro servicio.
- **Tablas nuevas:** `usuarios` (nombre, email, hash de la contraseña con scrypt, `perfil` JSONB) y `sesiones`
  (solo se guarda el hash del token, duran 30 días). `piezas` y `canciones` ganan `usuario_id` (dueño).
- **Migración automática:** el backend crea las tablas y columnas que falten en la primera petición después de un
  deploy. No hay que correr nada a mano en TigerData.
- **Rutas nuevas:**

| Método | Ruta | Qué hace |
| --- | --- | --- |
| POST | `/auth/registro` | `{ nombre, email, password }` → `201 { usuario, token }` |
| POST | `/auth/login` | `{ usuario (nombre o email), password }` → `{ usuario, token }` |
| POST | `/auth/logout` | Cierra la sesión del token |
| GET | `/auth/yo` | La cuenta conectada |
| PUT | `/auth/yo` | Guarda el perfil público `{ perfil: {...} }` |
| GET | `/usuarios/:nombre` | Perfil público (sin email) |

- El token va en `Authorization: Bearer <token>`.
- **Con sesión:** forks, piezas y canciones nuevas quedan a nombre de la cuenta (`autor` = nombre de usuario) y solo
  esa cuenta puede editarlas.
- **Sin sesión:** todo funciona como antes (`autor` = lo que mande el cliente, por ejemplo `"you"`), pero no se puede
  publicar con el nombre de una cuenta registrada. Las piezas semilla y lo anónimo no tienen dueño.
- **Frontend:** el login y el registro ya llaman al backend. `ME` en `frontend/src/api.js` es el usuario conectado
  (`"you"` sin sesión) y el perfil (bio, README, foto, pins) se guarda en el servidor con copia en el navegador.
- No hay verificación de email ni recuperación de contraseña (necesitarían un servicio de envío de correos).

## 9. Historial del proyecto: versiones, diff, merge y créditos (secciones 2 y 5)

Es la parte "GitHub" de Stemma. En el proyecto, el botón **History** abre una ventana con pestañas, como las de un
repositorio:

| Pestaña | Qué muestra |
| --- | --- |
| Tree | El árbol por versiones (ver §10) |
| Changes | Qué cambió una versión: pistas nuevas, borradas o cambiadas, y nota por nota en cada pieza (verde nueva, rojo borrada, amarillo movida). Se puede comparar contra cualquier versión anterior |
| Versions | v1, v2, v3… una por cada guardado, como commits, con mensaje (se escribe en la ventana de guardar o se genera solo) |
| Merge | Traer los cambios de un fork (o del original), con conflictos para resolver y aviso de choques armónicos |
| Credits | Quién escribió cada nota de la canción, con su porcentaje, sus piezas y sus versiones |

- **Versiones:** cada guardado crea una versión con una foto completa de la canción (pistas y las notas de cada pieza
  en ese momento). Si no cambió nada, no se crea versión.
- **Fork de proyectos:** guardar una copia del proyecto de otra persona ahora guarda de qué proyecto y versión viene
  (`parent_id`, `parent_version` en `canciones`). La v1 del fork se compara contra ese punto.
- **Merge (sale de "Extra"):** se trabaja a tres bandas, como `git merge`, contra el último punto en común (el fork o el
  último merge):
  - Lo que cambió solo un lado se aplica.
  - Lo que cambiaron los dos en el mismo lugar es un conflicto, y el dueño elige "Keep yours" o "Take theirs". Los
    conflictos posibles son el tempo, el instrumento de una pista, bloques nuevos en los mismos compases, o una pista
    que un lado borró y el otro cambió.
  - También marca los **choques armónicos**: notas a una segunda menor sonando juntas, una de cada proyecto (lo que
    pedía la sección 5).
  - Solo el dueño puede hacer el merge en su proyecto, y solo entre un proyecto y sus forks.
- **Créditos:** funcionan como un `git blame` de notas. En un fork, las notas que ya estaban en la pieza original siguen
  siendo del autor original; solo lo agregado o movido es de quien hizo el fork. Cada nota cuenta cada vez que suena en
  la canción.
- **Tabla nueva** `versiones` y columnas `canciones.parent_id` / `parent_version`. La migración es automática, como en
  §8. Las canciones guardadas antes reciben su estado actual como v1.
- **Rutas nuevas** (detalle en `backend/README.md`, carpeta "Historial" en Postman):

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/canciones/:id/versiones` | Lista de versiones con resumen de cambios |
| GET | `/canciones/:id/versiones/:n` | Una versión con su foto completa |
| GET | `/canciones/:id/versiones/:n/diff?contra=m` | Qué cambió la versión n (contra la anterior o contra m) |
| GET | `/canciones/:id/forks` | El proyecto original y los forks |
| GET / POST | `/canciones/:id/merge/:otra` (`/preview`) | Vista previa del merge (POST con `resoluciones`) |
| POST | `/canciones/:id/merge/:otra` | Aplica el merge (solo el dueño) |
| GET | `/canciones/:id/creditos` | Créditos por autor y autor de cada nota |

- Las canciones traen además `version`, `parent_id` y `parent_version`. `POST`/`PUT /canciones` aceptan `mensaje`
  opcional.
- Sin backend (datos de prueba) solo funciona la pestaña Tree.

## 10. Crear piezas propias, árbol por versiones y "My projects"

- **Crear piezas ("+")**: cada pista de la Playlist tiene un botón **+**, y la barra de la Playlist tiene
  **+ New piece** (pista nueva). Abre una ventana para elegir nombre, tipo, compases y tonalidad. La pieza se crea
  vacía y se abre en el piano roll para dibujar las notas.
  - En una pista existente, el tipo sale de esa pista y la pieza queda después del último bloque.
  - Debajo de las pistas hay una fila **+ Add track**: se elige el instrumento (Drums, Piano, Bass, Lead, Rhodes, Pad,
    Electric bass, Synth bass, Vibraphone) y se crea la pieza en una pista nueva con ese instrumento.
  - Al editar una batería, el piano roll muestra además un kit básico (bombo, caja, palmas, hi-hats, tom, platillos),
    para poder dibujar una batería vacía o agregar un sonido que no estaba.
- **Piezas privadas hasta publicarlas**: las piezas creadas con "+" las ve solo su autor (columna nueva
  `piezas.publica`). Se vuelven públicas, junto con las piezas de las que vienen, cuando se guardan en un proyecto
  público. Desde ahí cualquiera las encuentra, las escucha y les hace fork.
  - Nadie más puede usar ni ver una pieza privada (404).
  - Lo demás sigue público como antes: semillas, Upload y forks de piezas públicas.
  - `POST /piezas` acepta `"publica": false` (con sesión) y las piezas traen el campo `publica`.
- **Tree por versiones** (`frontend/src/components/VersionTree.jsx`, lógica en `frontend/src/versionTree.js`):
  - **Filas:** cada versión del proyecto es una fila con todas sus piezas, hayan cambiado o no. Las filas van
    conectadas por una línea horizontal y unidas entre sí por la columna de versiones.
  - **Arriba:** las piezas de la librería de las que vienen y, en los forks, el proyecto original en el punto del fork.
  - **Abajo:** "Now", los cambios sin guardar.
  - **Conexiones:** cada pieza se conecta con la fila donde estaba antes. Gris punteado si quedó igual, amarillo si se
    editó, naranja si un fork tomó su lugar. Una pieza mantiene su columna, y un fork que reemplaza a su original toma
    la columna del original.
  - **Clic en una pieza:** muestra qué cambió ahí (mini piano roll con el diff), permite **escucharla** y tiene dos
    botones:
    - **Restore in project:** vuelve a poner la pieza como estaba ahí. Si es tuya, las notas viejas quedan como
      cambios sin guardar en el piano roll. Si es de otra persona, se crea tu fork con esas notas. Reemplaza a la
      pieza que hoy ocupa su lugar.
    - **Continue working from here:** lo mismo, pero además la abre en el piano roll para seguir trabajando (como tu
      fork si no es tuya).
  - **Nodos que se mueven:** se pueden arrastrar, y su posición se recuerda en ese navegador. "Reset layout" los
    vuelve a su lugar.
  - `GET /canciones/:id/versiones?snapshots=1` trae la foto de cada versión (las 40 más nuevas) y la del punto del fork.
- **"My projects" en el menú del sitio**, al lado de Upload: lleva a tus proyectos (pide iniciar sesión si hace falta).

## 11. Favoritos en el Browser del proyecto

- El Browser tiene una pestaña **Favorites** entre **All** y **Rhythm**. Cada pieza del Browser tiene, además de ▶ y
  **+**, una **estrella**: marcada (naranja) es favorita y se desmarca con otro clic.
- **Sin sesión**, la estrella abre el login. Después de entrar, la pieza queda marcada.
- **Siempre al día**: la pestaña se calcula a partir de la lista de favoritos de la cuenta, no se guarda aparte.
  - Marcar o desmarcar una pieza cambia la estrella y la pestaña en el mismo clic.
  - El servidor recibe un pedido por pieza, en orden, y gana el último clic. Si falla, la lista se vuelve a pedir al
    servidor.
  - La lista también se recarga al entrar o salir de la cuenta y al volver a la ventana, así que se ven los cambios
    hechos en otra pestaña o en otro equipo.
- **Tabla nueva** `favoritos` (`usuario_id`, `pieza_id`, `created_at`). Se crea sola en el próximo arranque, como en §8.
- **Rutas nuevas** (con sesión; no cambian los contratos de §4):

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/auth/yo/favoritos` | Ids de las piezas favoritas, de la más reciente a la más antigua. Solo piezas que la cuenta puede ver |
| PUT | `/auth/yo/favoritos/:piezaId` | Marca la pieza → `204` (repetirlo no duplica); `404` si no existe o es privada de otra persona |
| DELETE | `/auth/yo/favoritos/:piezaId` | La desmarca → `204` (repetirlo no da error) |

- Sin backend (datos de prueba), los favoritos se guardan en el navegador (`stemma-favorites:<usuario>`).

## 12. El copiloto se llama DJ Stemy

- En la interfaz, el asistente ahora se llama **DJ Stemy**. Sus funciones no cambian: sigue buscando y explicando
  piezas existentes, sin componer.
- Su personaje es el logo de Stemma con ojos estilo emoji y audífonos de DJ (`frontend/src/components/DJStemy.jsx`):
  - en el chat del proyecto responde en viñetas, tipo SimSimi;
  - en reposo flota, parpadea y mira alrededor;
  - mientras busca piezas cabecea al ritmo, los audífonos laten y salen notas;
  - en el chat está detrás de una mesa de DJ, con dos tornamesas cuyos vinilos giran, un mixer con crossfader y luces
    que parpadean (todo más rápido mientras busca);
  - cuando entrega una respuesta o sugerencias, da un giro sobre sí mismo. Solo gira Stemy; la mesa se queda quieta.
- El prompt del sistema empieza con "You are DJ Stemy" y los mensajes de error dicen "DJ Stemy". El código, los
  archivos y la ruta `/copiloto` mantienen el nombre copiloto (contrato de la sección 4.3).

## 13. Renombrar piezas, borrar proyectos (papelera) y aviso al salir sin guardar

- **Renombrar piezas:** el autor de una pieza puede cambiarle el nombre cuando quiera, escribiendo en el título del
  piano roll (Enter o hacer clic fuera guarda, Esc cancela). Usa `PUT /piezas/:id` con solo `{ "nombre" }`, que ya
  existía; las notas, el autor y el linaje no cambian. Las piezas de otras personas no muestran el campo.
- **Borrar proyectos:** en My projects, el menú "..." de cada proyecto propio tiene **Delete**. Pregunta "Are you sure
  you want to delete...?" y, si se confirma, el proyecto pasa a la **papelera** (abajo de la lista de proyectos). Desde
  ahí se puede restaurar durante 20 días o borrarlo para siempre (con otra confirmación). A los 20 días el servidor lo
  borra solo. Las piezas del proyecto no se borran (son reutilizables); los proyectos que eran fork de él quedan como
  originales.
- Quién puede borrar un proyecto: la cuenta dueña y, en los proyectos sin cuenta dueña (guardados antes de que
  existieran las cuentas o sin sesión), la cuenta cuyo nombre de usuario es el `autor`, o cualquiera si el autor es
  `"you"` (My projects ya los muestra como tuyos). Al borrar uno de esos, pasa a ser de tu cuenta (y a tu nombre, si
  era `"you"`), para que aparezca en tu papelera y solo tú puedas restaurarlo. Los de otra persona dan 403.
- Rutas nuevas (en el backend, un proyecto es una canción):

| Método | Ruta | Qué hace |
| --- | --- | --- |
| DELETE | `/canciones/:id` | Manda la canción a la papelera → `204`. Desaparece de todas las listas y rutas |
| GET | `/canciones/papelera` | Canciones en la papelera de la cuenta, con `borrada` y `se_borra` (fechas ISO) |
| POST | `/canciones/:id/restaurar` | La saca de la papelera y la devuelve |
| DELETE | `/canciones/papelera/:id` | La borra para siempre → `204` (con sus versiones) |

- Base de datos: columna nueva `canciones.borrada_at`. El servidor la agrega solo al arrancar (migrate.js). No hay
  cron en Vercel, así que el borrado de las que pasan los 20 días se hace al pedir `GET /canciones` (máximo una vez
  por hora) y `GET /canciones/papelera`.
- **Aviso al salir sin guardar:** si el proyecto tiene cambios sin guardar (o notas sin guardar en el piano roll),
  salir pregunta "Your project has not been saved. Are you sure you want to leave?": el logo, el perfil, My projects
  y los botones Atrás/Adelante del navegador. Cerrar o recargar la pestaña muestra el aviso propio del navegador (el
  texto de ese aviso no se puede cambiar). `frontend/src/leave.js`.

## 14. Conexiones: comunidad, propuestas, colaboradores, mensajes y piezas públicas/privadas

Stemma deja de ser solo un editor: los artistas comparten, comentan, piden ideas, proponen cambios y colaboran.

### Qué ve el usuario
- **Comentarios** en proyectos y piezas: botón **Comments** en la barra del proyecto y ícono de comentario en el título
  del piano roll. Leer es abierto (lo que puedas ver); escribir pide cuenta. El autor del comentario y el autor del
  proyecto/pieza pueden borrarlo.
- **Portada (comunidad):** "Popular projects" (los más forkeados y comentados) y "Help wanted": artistas trabados con
  una canción que preguntan "¿cómo sigo con esto?". "Give an idea" abre los comentarios del proyecto. Explore tiene el
  orden "Most popular" y muestra comentarios y forks de cada proyecto.
- **Ventana Share** del proyecto (autor y colaboradores):
  - *Collaborators*: lista, link de invitación (crear, copiar, renovar, apagar), quitar colaborador o salir.
  - *What others can do* (autor): "Anyone can save their own copy" (fork) y "Anyone can propose changes".
  - *Ask the community for ideas* (autor, proyecto público): el pedido de ayuda que sale en la portada. Mientras
    está abierto, el botón Comments se llama **Ideas**.
- **Propuestas de cambio (como pull requests):** quien edita un proyecto ajeno puede **Propose changes**. Sus cambios
  quedan en una copia privada suya (solo él y la gente del proyecto la abren) y el autor recibe un mensaje. Desde un
  fork propio guardado, el botón es **Propose to original**. El autor y los colaboradores las revisan en
  **History → Proposals** (diff nota por nota y merge, o Decline); quien propuso puede retirarla. Hacer merge la cierra
  como aceptada. Si el autor apagó los forks, "Save a copy" se convierte en "Propose changes".
- **Colaboradores en proyectos privados:** el link `#/invite/<token>` (vale 7 días; uno por proyecto, uno nuevo
  reemplaza al anterior). Quien lo abre con sesión iniciada entra como colaborador: abre y edita el proyecto aunque sea
  privado, cada guardado queda a su nombre y puede hacer merge de propuestas. No cambia la visibilidad, la descripción
  ni los ajustes, y no puede borrar el proyecto. En My projects aparece "Shared with you".
- **Mensajes internos (tipo correo):** `#/messages`. Una conversación por persona, cada mensaje con asunto y,
  opcionalmente, un proyecto adjunto. Botón **Message** en los perfiles ajenos, contador de no leídos en la barra.
  **Block** en cada conversación (el bloqueado no puede escribirte ni proponerte cambios) y ajustes de "Who can write
  to you": cualquiera, solo gente con la que trabajas o a la que escribiste, o nadie.
- **Piezas públicas o privadas (lo decide su autor).** Se elige en tres lugares:
  1. la ventana **New piece** (por defecto, la visibilidad del proyecto);
  2. el botón **Public / Private** al lado del nombre de tu pieza en el piano roll;
  3. la pestaña **Pieces** de tu perfil.

### Reglas nuevas
- **Un proyecto público solo puede usar piezas públicas.** Guardar ya no publica piezas solo (reemplaza la regla de
  la sección 10): si hay piezas privadas, el servidor responde 400 con la lista y cómo arreglarlo.
- Una pieza **no puede pasar a privada** si la usa un proyecto público, si la usan proyectos de otras personas o si
  otros la forkearon (romperían su trabajo); tampoco las piezas sin cuenta dueña. No puede pasar a pública si viene
  de una pieza privada. El servidor responde 409 con el motivo y la interfaz lo muestra.
- Una pieza privada la abren su autor y quienes son dueños o colaboradores de un proyecto que la usa.
- Un proyecto lo ven: si es público, todos; si es privado, su autor, sus colaboradores y quienes revisan una propuesta
  hecha desde él.

### Rutas nuevas (backend)

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/canciones/comunidad` | `{ populares, ayuda }` para la portada |
| GET | `/canciones/compartidas` | Proyectos donde colaboras |
| PATCH | `/canciones/:id/ajustes` | Autor: `{ permite_fork?, permite_propuestas?, pide_ayuda? }` (`null` quita el pedido) |
| GET | `/canciones/:id/colaboradores` | `{ autor, rol, colaboradores, invitacion }` (`invitacion` solo para el autor) |
| POST / DELETE | `/canciones/:id/invitacion` | Autor: crea (o renueva) / apaga el link de invitación |
| DELETE | `/canciones/:id/colaboradores/:nombre` | El autor quita a alguien, o un colaborador sale |
| GET | `/canciones/:id/propuestas` | Propuestas del proyecto (abiertas primero) |
| POST | `/canciones/:id/propuestas` | `{ titulo, mensaje?, desde_id? \| cancion? }` → `{ propuesta, copia }` |
| PATCH | `/canciones/:id/propuestas/:pid` | `{ estado: "rechazada" \| "retirada" }` |
| GET / POST | `/invitaciones/:token` · `/invitaciones/:token/aceptar` | Ver / aceptar una invitación |
| GET / POST / DELETE | `/comentarios?objetivo=cancion\|pieza&id=` · `/comentarios` · `/comentarios/:id` | Comentarios |
| GET | `/mensajes` · `/mensajes/con/:nombre` · `/mensajes/sin-leer` | Conversaciones, un hilo (lo marca leído), no leídos |
| POST | `/mensajes` | `{ para, asunto?, texto, cancion_id? }` |
| GET / PUT | `/mensajes/ajustes` | `{ mensajes_de: "todos" \| "contactos" \| "nadie", bloqueados }` |
| PUT / DELETE | `/mensajes/bloqueos/:nombre` | Bloquear / desbloquear |

- `PUT /piezas/:id` acepta `publica` (true/false). `GET /canciones/:id` trae `rol` (`"autor"`, `"colaborador"` o
  `null`). Toda canción trae además `permite_fork`, `permite_propuestas`, `pide_ayuda`, `pide_ayuda_at`,
  `comentarios`, `forks`, `propuestas_abiertas` y `actualizado`. `POST /canciones` con `parent_id` responde 403 si el
  autor apagó los forks. El merge lo pueden hacer también los colaboradores, y cierra como aceptadas las propuestas
  abiertas de esa copia.
- Tablas nuevas: `comentarios`, `colaboradores`, `invitaciones`, `propuestas`, `mensajes`, `bloqueos`; columnas nuevas
  `canciones.permite_fork / permite_propuestas / pide_ayuda / pide_ayuda_at` y `usuarios.mensajes_de`. `migrate.js`
  las crea solo al primer request después del deploy.

## 15. Popularidad (re-usos) y "tararéale a DJ Stemy"

### Popularidad: cuántas veces se re-usó algo
- **Piezas:** contador ↻ (proyectos que la usan + forks) en las tarjetas de la librería (Explore → Library), en las
  piezas del perfil y en el Browser del proyecto. Al hacer clic se abre una lista con los proyectos públicos que la
  usan (enlazados) y los forks con su autor; lo privado solo suma al contador ("+N private").
- **Proyectos:** el contador de forks de las tarjetas (Explore, Popular projects, perfil) ahora se abre y lista las
  copias públicas, enlazadas.
- Backend: `GET /usos?piezas=&canciones=` (contadores en lote) y `GET /piezas/:id/usos` (dónde se re-usa).

### Tararéale a DJ Stemy
- En el chat de DJ Stemy hay un botón de micrófono. Le dices un género y un instrumento, aprietas el micrófono y
  tarareas (una "da" por nota, hasta 15 s). Ves el nivel y la nota en vivo.
- Al parar, el navegador transforma el tarareo en notas MIDI (`frontend/src/hum.js`; el audio nunca sale de la
  página), lo muestra en un mini piano roll y lo puedes **escuchar antes de mandarlo** (Play), repetir o enviar.
- El servidor compara esas notas con todas las melodías públicas (intervalos y ritmo: da igual la tonalidad y la
  velocidad a la que se tararee) y DJ Stemy responde a qué melodía se parece (con % de coincidencia en cada
  sugerencia) y qué acordes, bajo y batería le van, en la tonalidad del tarareo.
- "Use in my song" guarda el tarareo como **pieza propia** (melodía del usuario, CC BY 4.0) y la agrega a la canción:
  aparece en los créditos y en el árbol como lo que aportó el usuario. El copiloto sigue sin componer: solo compara y
  recomienda piezas existentes.
- DJ Stemy ahora recibe los mensajes anteriores del chat (`historial`), así recuerda el género y el instrumento.
- Catálogo nuevo: `data/piezas/famous-melodies.json` (`p-501` a `p-514`), 14 melodías famosas de **dominio público**
  (Für Elise, Himno de la alegría, Estrellita, Cumpleaños feliz, Jingle Bells, la 5ª de Beethoven, Pequeña serenata
  nocturna, Canon de Pachelbel, Frère Jacques, Mary Had a Little Lamb, Marcha nupcial, En la gruta del rey de la
  montaña, Greensleeves, Tocata y fuga). Bohemian Rhapsody no se puede: tiene copyright. Para cargarlas en una base
  existente: `npm run db:seed` en `backend/`.
- Para la demo: "un beat lo-fi con piano" → micrófono → tararear Für Elise ("mi re# mi re# mi si re do la") →
  escuchar → enviar → DJ Stemy dice que suena a Für Elise de Beethoven (dominio público) y sugiere acordes y bajo en
  esa tonalidad y una batería.

### Rutas y contrato
| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/usos?piezas=p-1,p-2&canciones=c-1` | `{ piezas: { id: { canciones, forks, total } }, canciones: { id: { forks, total } } }` |
| GET | `/piezas/:id/usos` | `{ id, total, canciones: { total, lista }, forks: { total, lista } }` |
| POST | `/copiloto` | Acepta además `historial: [{ de: "usuario" \| "stemy", texto }]` y `tarareo: { notas }`; con tarareo responde además `tarareo: { tonalidad, notas, coincidencias }` |

Los campos nuevos son opcionales: el contrato 4.3 de `/copiloto` sigue igual para quien no los mande.

## 16. Huellas musicales: piezas parecidas, aviso de copia y 180 piezas generadas

Hecho por el rol A mientras B y C dormían (con el visto bueno de A). Resumen para revisar:

- **Huella de cada pieza** (`backend/src/lib/fingerprint.js`): magnitudes de la DFT del perfil de clases de altura
  (6 números) y de la grilla de ataques en semicorcheas (8); la batería, una grilla por voz (bombo, caja, platillos,
  otra percusión). No cambian al transponer, invertir ni desplazar en el tiempo, así que una copia en otra tonalidad
  se reconoce. Tests en `backend/test/fingerprint.test.js`.
- **Rutas nuevas** (solo se agregan; nada del contrato cambia):

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/piezas/:id/parecidas?n=8` | Piezas públicas del mismo tipo que más se parecen, con `similitud` 0-100 |
| POST | `/piezas/parecidas` | `{ tipo, notas, id?, parent_id?, autor? }` → `{ parecidas, aviso }` (notas sin guardar) |

- **Aviso de copia solo para melodías:** la sección 6 permite reutilizar progresiones y ritmos básicos, y la huella de
  alturas no distingue el orden de los acordes (i-iv-V7 y ii-V-i en La menor salen iguales). Compara también ventanas
  de 2 compases (las copias suelen ser fragmentos). Nunca bloquea: sugiere hacer fork para dar crédito. Se ve en la
  página de subida (`#/upload`) y en el piano roll después de guardar.
- **Copiloto (DJ Stemy):** `buscar_piezas` acepta `parecido_a` (id de pieza) y ordena por huella. Siguen siendo las dos
  herramientas de 4.4. Rol C: si conviene, mencionarlo en `systemPrompt.js` ("si el usuario pide algo parecido a una
  pieza, usa parecido_a").
- **Datos (rol C):** `data/piezas/stemma-generated.json` (`p-2001` a `p-2180`) con 100 melodías, 40 progresiones y 40
  bajos para beats de rap, generados por `data/scripts/generate_loops.py` (reglas musicales, determinista). Autor
  "Stemma generator", CC BY 4.0. La huella encontró que la semilla 2026 producía casi "Mary Had a Little Lamb"; se usa
  2027 (sin copias). **Falta escucharlas.** Para cargarlas en una base existente: `npm run db:seed` en `backend/`.
- **Mapa de sonido (`#/map`, "Sound map" en la barra):** las piezas públicas de cada tipo en 2D (PCA de las huellas,
  `GET /piezas/mapa?tipo=`). Los ejes se describen en palabras ("pulso de negras ← → síncopa"). Clic en un punto: la
  pieza, preview y las 5 que más se le parecen (con líneas en el mapa); buscador por nombre; enlace directo
  `#/map?tipo=melodia&p=p-501` y "Show on the sound map" desde el botón Similar del piano roll. Los colores son la
  **fuente** de cada pieza porque, con estos datos, los grupos siguen sobre todo a la fuente o plantilla (los acordes
  de free-midi-chords comparten un solo ritmo); la página lo dice. No se presentan las zonas vacías como "mundos
  nuevos": hoy son huecos entre fuentes, no música sin explorar. Solo el mapa de batería (Groove) refleja diferencias
  musicales reales.

### Propuestas para CLAUDE.md (no aplicadas: necesitan el acuerdo de los tres)
- 4.2 Canción: campos opcionales `publica` (bool, por defecto `true`) y `descripcion` (texto, hasta 300 caracteres),
  ya guardados por el backend.
- 4.4 Herramientas: `buscar_piezas(estilo, tipo, tonalidad, texto, parecido_a)`.

