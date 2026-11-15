import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Repo-level /data folder (seed pieces, songs, MIDI files). Override with DATA_DIR.
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(here, '..', '..', '..', 'data'));
