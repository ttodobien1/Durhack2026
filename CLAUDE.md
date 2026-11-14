# CLAUDE.md — Lineage (DurHack 2026)

Contexto compartido del proyecto. Este archivo vive en la raíz del repositorio y es igual para los tres integrantes. Si un acuerdo cambia, se cambia aquí primero (en un commit propio) y se avisa al equipo.

> Nombre de trabajo del proyecto: **Lineage** (provisorio, se puede cambiar).

---

## 1. Qué estamos construyendo

**Pitch:** "El GitHub de las ideas musicales: compones tu canción con piezas reutilizables, y cada pieza recuerda quién la creó."

Una plataforma web donde las canciones se componen a partir de **piezas musicales reutilizables** (fragmentos MIDI cortos). Cada pieza guarda su autor, su licencia y de qué pieza viene. El usuario puede buscar piezas, hacer un **fork**, editarlas, ver **qué cambió musicalmente (diff)** y ver el **árbol de origen** de su canción: qué piezas tiene, de quién son y qué aportó él.

**Tema de DurHack 2026: "Composition".** El proyecto usa los tres sentidos de la palabra:
- **Composición musical:** el usuario compone una canción.
- **Composición técnica:** las canciones se arman con piezas, como el software se arma con módulos.
- **Composición de datos:** la autoría y el linaje fluyen por debajo de cada canción.

### Principio rector (no negociable)
**El usuario es el compositor.** El copiloto busca, sugiere y explica, pero **nunca compone una canción completa ni genera música por su cuenta**. Solo recomienda piezas que ya existen en la base.

### Diferenciador frente al mercado
BandLab ya tiene fork, Splice Create combina samples con IA, y Mozart AI y Veena tienen copilotos. Lo que nadie ofrece es el **origen trazable de cada pieza + un diff musical legible**. El árbol de origen y el diff son lo último que se recorta.

---

## 2. Alcance

| Prioridad | Qué entra |
| --- | --- |
| Imprescindible | Librería con búsqueda, reproducción, fork, árbol de origen |
| Importante | Diff visual, copiloto con tool use, piano roll editable |
| Extra (solo si sobra tiempo) | Merge con detección de choques armónicos, exportar MIDI, varios estilos |
| Fuera (no se construye) | Audio grabado, voces, letras generadas, mezcla/mastering, cuentas de usuario, red social |

- **Solo MIDI, nunca audio.** MIDI son datos estructurados (nota, tiempo, duración, velocidad), comparables como texto.
- **Un solo estilo para la demo:** salsa romántica. Tiene que sonar bien.

---

## 3. Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | React (Vite) |
| Audio | Tone.js (reproducción), samplers de piano y batería |
| MIDI | `@tonejs/midi` (leer/escribir MIDI ↔ JSON, licencia MIT) |
| Árbol de origen | React Flow |
| Backend | Node + Express |
| Base de datos | SQLite (por defecto; Supabase solo si el equipo lo decide) |
| Copiloto | Claude API con tool use (SDK oficial de Anthropic) |

Variables de entorno (nunca al repo, usar `.env` y `.env.example`):
- Backend: `ANTHROPIC_API_KEY`, `PORT` (por defecto 3001)
- Frontend: `VITE_API_URL` (por defecto `http://localhost:3001`)

### Estructura del repositorio (propuesta)
```
/frontend      React + Tone.js + React Flow (rol A, vista del árbol: rol C)
/backend       Express + SQLite + copiloto (rol B)
/data          piezas semilla en JSON y scripts de importación (rol C)
CLAUDE.md
README.md
```

---

## 4. Contratos compartidos (acordados)

Estos contratos permiten trabajar en paralelo con datos falsos. **No se cambian sin acuerdo de los tres.**

### 4.1 Pieza
```json
{
  "id": "p-017",
  "nombre": "Montuno en La menor",
  "tipo": "acordes",
  "autor": "ana",
  "licencia": "CC BY 4.0",
  "fuente": "creada en DurHack",
  "tonalidad": "Am",
  "tempo": 96,
  "estilo": ["salsa", "romantica"],
  "compases": 4,
  "parent_id": null,
  "notas": [{ "tono": 57, "inicio": 0, "duracion": 0.5, "velocidad": 0.8 }]
}
```
- `tipo` ∈ `ritmo`, `acordes`, `melodia`, `bajo`.
- `tono` = número MIDI (60 = Do central).
- `inicio` y `duracion` van **en pulsos (negras), no en segundos**, para poder cambiar el tempo.
- `velocidad` entre 0 y 1.
- `parent_id` = `null` si es original; si es un fork, el `id` de la pieza de origen.

### 4.2 Canción
```json
{
  "id": "c-001",
  "nombre": "Desamor en La menor",
  "autor": "ana",
  "tempo": 96,
  "pistas": [
    { "instrumento": "piano", "bloques": [{ "pieza_id": "p-017", "compas": 0 }] }
  ]
}
```

### 4.3 API (rol B la expone, rol A la consume)

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/piezas?estilo=&tipo=&tonalidad=&q=` | Busca piezas |
| GET | `/piezas/:id` | Devuelve una pieza |
| POST | `/piezas/:id/fork` | Crea una copia con `parent_id` y la devuelve |
| PUT | `/piezas/:id` | Guarda notas editadas |
| GET | `/piezas/:id/diff/:otra` | Devuelve notas nuevas, borradas y movidas |
| GET | `/canciones/:id/arbol` | Devuelve nodos y aristas del árbol de origen |
| POST | `/copiloto` | Recibe el mensaje y la canción actual; devuelve texto y piezas sugeridas |

#### Formatos de respuesta (propuestos para poder trabajar en paralelo; confirmar al inicio)
- `GET /piezas` → `[Pieza, ...]`
- `POST /piezas/:id/fork` → body opcional `{ "autor": "..." }`; respuesta: la nueva `Pieza`.
- `GET /piezas/:id/diff/:otra`:
  ```json
  {
    "nuevas":   [{ "tono": 60, "inicio": 1, "duracion": 0.5, "velocidad": 0.8 }],
    "borradas": [{ "tono": 59, "inicio": 1, "duracion": 0.5, "velocidad": 0.8 }],
    "movidas":  [{ "antes": { "tono": 64, "inicio": 2, "duracion": 1, "velocidad": 0.8 },
                   "despues": { "tono": 64, "inicio": 2.5, "duracion": 1, "velocidad": 0.8 } }],
    "iguales":  [ ... ]
  }
  ```
- `GET /canciones/:id/arbol`:
  ```json
  {
    "nodos":   [{ "id": "p-017", "nombre": "Montuno en La menor", "autor": "ana", "tipo": "acordes", "licencia": "CC BY 4.0" }],
    "aristas": [{ "desde": "p-003", "hacia": "p-017" }]
  }
  ```
  `desde` = pieza de origen (padre), `hacia` = fork (hijo). Incluye la cadena completa de padres de cada pieza usada en la canción.
- `POST /copiloto`:
  - Request: `{ "mensaje": "quiero una salsa romántica para un desamor", "cancion": Cancion | null }`
  - Response: `{ "texto": "...", "piezas_sugeridas": ["p-017", "p-022"] }`
- Errores: `{ "error": "mensaje" }` con el código HTTP correspondiente.

### 4.4 Herramientas del copiloto (solo dos)
- `buscar_piezas(estilo, tipo, tonalidad, texto)` — devuelve piezas reales de la base.
- `describir_estilo(nombre)` — devuelve rasgos de estilo (tempo, clave, instrumentación), **sin imitar artistas**.

**Regla del prompt del sistema:** el copiloto solo recomienda piezas existentes y explica por qué; nunca escribe una canción completa. Respuestas cortas.

Si el usuario pide "sonar como" un artista (ej.: "quiero sonar como Frankie Ruiz"), el copiloto traduce el pedido a **rasgos de estilo** (tempo, clave, montuno, sección de bronces, estructura de salsa romántica) y busca piezas con esos rasgos. No imita al artista ni reproduce sus canciones.

---

## 5. Lógica clave

### Diff musical (rol B)
Comparar las notas de dos piezas (normalmente un fork contra su padre):
1. Emparejar notas por **(tono, inicio)** exactos → `iguales`.
2. De las que quedan: misma `tono` con `inicio` distinto (o mismo `inicio` con `tono` distinto) → `movidas` (emparejar la más cercana).
3. Lo que queda en la pieza nueva → `nuevas`; lo que queda en la original → `borradas`.

Frontend (rol A) pinta en el piano roll: **verde = nueva, rojo = borrada, amarillo = movida**.

### Árbol de origen
Se arma recorriendo `parent_id` hacia arriba desde cada pieza de la canción. Rol B entrega nodos y aristas; rol C lo dibuja con React Flow mostrando nombre, autor y licencia de cada pieza, y resaltando lo que aportó el usuario.

### Merge (extra, solo si sobra tiempo)
Combinar dos forks y marcar choques armónicos (por ejemplo, notas simultáneas a distancia de segunda menor). No se empieza antes de la hora 20 si el resto no está listo.

---

## 6. Datos (piezas semilla)

Meta: **30–50 piezas**, foco en salsa romántica.

| Fuente | Uso | Licencia |
| --- | --- | --- |
| Groove MIDI Dataset (Google Magenta) | Piezas de ritmo: cortar 2–4 compases por estilo | CC BY 4.0 |
| Creadas durante el evento | Progresiones, montunos, bajos y melodías de salsa | Propias |
| PDMX (MuseScore, dominio público) | Melodías si hiciera falta | CC BY |
| Lakh MIDI Dataset | **No usar** (contiene muchas obras con copyright) | — |

- CC BY exige atribución: cada pieza importada lleva `autor`, `licencia` y `fuente`. Esto aparece en el árbol y es parte de la demo.
- **No incluir melodías ni letras de canciones conocidas.** Progresiones de acordes y ritmos básicos sí se pueden usar.

---

## 7. Reglas del hackathon (DurHack, evento MLH)

- DurHack dura **24 horas**. Todo el **código se escribe durante el evento**.
- Se permiten librerías, frameworks, código open source y material público con licencia abierta.
- Antes del evento solo se prepara lo que no es código: reglas, decisiones, wireframes, guion, este archivo.
- Pendiente confirmar en las reglas oficiales: fecha exacta, tamaño máximo de equipo, criterios de evaluación y si se pueden llevar datos o mockups preparados.

---

## 8. Equipo, roles y ramas

| Rol | Responsable | Construye | Rama |
| --- | --- | --- | --- |
| A — Frontend y audio | _(nombre)_ | Interfaz React, reproducción con Tone.js, editor de pistas, piano roll, diff visual | `a/frontend` |
| B — Backend y copiloto | _(nombre)_ | Base de datos, API, importador MIDI → JSON, fork, diff, datos del árbol, copiloto | `b/backend` |
| C — Música, datos y producto | _(nombre)_ | Piezas semilla y metadatos, canción de demo, prompt del copiloto, vista del árbol (React Flow), pitch y video | `c/datos` |

- **Dueño de la integración:** B. Une las ramas a `main` cada 3–4 horas. `main` siempre debe funcionar.
- **Dueño de la demo:** C. Tiene la última palabra sobre qué se ve en los 2 minutos y puede pedir recortes.
- Si una tarea necesita una rama aparte, usar `a/<tarea>`, `b/<tarea>` o `c/<tarea>`.

### Forma de trabajar
- **Datos falsos primero:** A no espera la API de B; usa piezas de ejemplo en un archivo local que cumpla el contrato 4.1.
- Commits pequeños y frecuentes, mensajes claros.
- Bloqueado más de 30 minutos → pedir ayuda a un compañero o mentor.
- Nada nuevo después de la hora 22: solo arreglos.
- Dormir por turnos, nunca los tres a la vez.
- Las claves de la API nunca van al repositorio.

---

## 9. Cronograma y controles

| Horas | Hito |
| --- | --- |
| 0–1 | Repo funcionando en los 3 computadores |
| 1–4 | Se escucha una pieza real en el navegador |
| 4–8 | Una canción de varias piezas suena junta |
| 8–12 | **Control 1:** flujo completo buscar → elegir → fork → editar → árbol |
| 12–16 | Diff visible y copiloto sugiriendo piezas reales |
| 16–20 | **Control 2:** la canción de demo se arma dentro de la app |
| 20–22 | Solo arreglos; video de respaldo grabado; **congelamiento de código a la hora 22** |
| 22–24 | Entrega, README y demo ensayada 2 veces |

**Recortes si vamos atrasados (en este orden):** merge → copiloto → piano roll editable. Lo último que se recorta es el **árbol de origen y el diff**.

---

## 10. Demo (2 minutos)

1. **0:00–0:15** — El problema: en música se reutilizan ideas todo el tiempo, pero se pierde quién hizo qué.
2. **0:15–0:40** — "Quiero una salsa romántica, bien movida, para una canción de desamor." El copiloto propone ritmo, montuno y bajo y explica por qué.
3. **0:40–1:05** — El usuario elige y hace fork del montuno; edita notas en el piano roll.
4. **1:05–1:20** — "¿Qué cambié?" → diff con colores.
5. **1:20–1:40** — Suena la canción completa.
6. **1:40–2:00** — Árbol de origen: "Esta canción tiene 4 piezas de 3 autores, y esto es lo tuyo." Cierre:
   > "Composition is how we build software, how we combine data, and how we make music. Lineage lets you do all three, and you stay the composer."

---

## 11. Instrucciones para asistentes de código (Claude Code u otros)

- Respetar los contratos de la sección 4 al pie de la letra (nombres de campos en español, unidades en pulsos).
- No agregar dependencias pesadas sin necesidad; preferir las del stack.
- No implementar nada de la lista "Fuera" de la sección 2.
- El copiloto nunca debe generar canciones completas ni notas nuevas: solo buscar y explicar piezas existentes.
- No escribir claves ni secretos en el código; usar variables de entorno.
- Mantener el código simple y legible: es un hackathon de 24 horas, se prioriza que funcione de punta a punta.
