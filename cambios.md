# Cambios propuestos a CLAUDE.md (rol B — backend)

Este archivo junta los cambios y decisiones del backend que afectan a todo el equipo. Va aparte para no generar
conflictos con `CLAUDE.md` en las otras ramas. Cuando los tres estén de acuerdo, se pasa a `CLAUDE.md` en un commit
propio y se borra este archivo.

Detalle técnico completo: `backend/README.md`. Datos y MIDI: `data/README.md`.

---

## 1. Base de datos: SQLite local + Turso en producción (sección 3)

- Vercel no puede usar un archivo SQLite, así que en producción la base vive en **Turso** (SQLite alojado, plan
  gratis). Sigue siendo SQLite, así que el acuerdo de la sección 3 se mantiene.
- En local se usa el archivo `backend/lineage.db` (no va al repo). Mismo código y mismo SQL en los dos casos.
- Librería: `@libsql/client`.

**Cambio propuesto en la tabla de stack:** `Base de datos | SQLite (libSQL): archivo local en desarrollo, Turso en producción`.

## 2. Variables de entorno nuevas (sección 3)

Backend (agregar a la lista):

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | `file:lineage.db` | En producción: `libsql://<db>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | — | Token de Turso (no hace falta en local) |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Opcional, para cambiar el modelo del copiloto |

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
- **Normalización al guardar:** los tags de `estilo` se guardan en minúscula y sin tildes (`"romántica"` →
  `"romantica"`); `tonalidad` se guarda en notación corta (`"La menor"` o `"A minor"` → `"Am"`). La búsqueda `?q=`
  ignora mayúsculas y tildes.
- **`PUT /piezas/:id`:** reemplaza toda la lista de notas. También acepta `nombre`, `tonalidad`, `tempo`, `estilo` y
  `compases`. No se pueden cambiar `autor`, `tipo`, `licencia` ni `parent_id` (protege el linaje).
- **Ids:** se generan en secuencia (`p-016`, `c-002`...).

## 6. Datos provisorios (sección 6)

- `data/piezas/p-001` a `p-015` y `data/canciones/c-001` son **provisorios** para poder trabajar mientras el rol C
  prepara las piezas reales. Su `fuente` lo dice. Se pueden reemplazar con los mismos ids.
- Valores de `instrumento` usados en `c-001`: `bateria`, `piano`, `bajo`. **Rol A:** confirmar si esos nombres sirven
  para elegir el sampler.
- Las piezas se cargan con `npm run db:seed` desde `backend/`. Los MIDI se convierten con `npm run import:midi`
  (ver `data/README.md`).

## 7. Copiloto (sección 4.4)

- Modelo `claude-opus-5-5`, solo las dos herramientas acordadas (`buscar_piezas`, `describir_estilo`).
- La respuesta final sale siempre como `{ texto, piezas_sugeridas }` y los ids se verifican contra la base: nunca
  sugiere una pieza que no exista.
- **Rol C:** el prompt del sistema está en `backend/src/copilot/systemPrompt.js` y los rasgos de estilo en
  `backend/src/copilot/styles.js`; se pueden editar sin tocar el resto.
- Sin `ANTHROPIC_API_KEY`, `/copiloto` responde 503 y el resto de la API funciona igual.
