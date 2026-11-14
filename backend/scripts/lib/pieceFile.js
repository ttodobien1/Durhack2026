// Pretty JSON for piece files: metadata indented, one note per line (diff-friendly in git).
export function formatPieza(pieza) {
  const { notas = [], ...meta } = pieza;
  const lines = Object.entries(meta).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const notes = notas.map((nota) => `    ${JSON.stringify(nota)}`).join(',\n');
  lines.push(`  "notas": [${notas.length ? `\n${notes}\n  ` : ''}]`);
  return `{\n${lines.join(',\n')}\n}\n`;
}
