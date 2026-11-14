// Text helpers shared by validation, search and the copilot tools.

// "Romántica " -> "romantica"
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// "salsa romántica, Bolero" -> ["salsa", "romantica", "bolero"]
export function splitTags(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,;]/);
  return list
    .flatMap((item) => normalizeText(item).split(/[\s-]+/))
    .filter(Boolean);
}

const NOTE_NAMES = {
  c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', a: 'A', b: 'B',
  do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B',
};

// Accepts "Am", "a minor", "La menor", "F# major", "Sib", "C#m"... and returns the
// short notation used in the data ("Am", "F#", "Bb", "C#m"). Unknown input is returned trimmed.
export function normalizeKey(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const text = normalizeText(raw).replace(/♯/g, '#').replace(/♭/g, 'b');
  const match = text.match(
    /^(do|re|mi|fa|sol|la|si|[a-g])\s*(#|b|sostenido|bemol|sharp|flat)?\s*(m|min|minor|menor|maj|major|mayor)?$/,
  );
  if (!match) return raw;

  const [, note, accidental, mode] = match;
  let result = NOTE_NAMES[note];
  if (accidental === '#' || accidental === 'sostenido' || accidental === 'sharp') result += '#';
  if (accidental === 'b' || accidental === 'bemol' || accidental === 'flat') result += 'b';
  if (mode && ['m', 'min', 'minor', 'menor'].includes(mode)) result += 'm';
  return result;
}

// Builds the normalized text stored in piezas.busqueda.
export function searchableText(pieza) {
  return normalizeText(
    [pieza.nombre, pieza.autor, pieza.tipo, pieza.tonalidad, pieza.fuente, ...(pieza.estilo ?? [])]
      .filter(Boolean)
      .join(' '),
  );
}
