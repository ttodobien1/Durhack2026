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
