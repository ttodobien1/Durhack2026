import cors from 'cors';
import express from 'express';
import { databaseKind, db } from './db/client.js';
import { ensureSchema } from './db/migrate.js';
import { authenticate } from './lib/auth.js';
import auth from './routes/auth.js';
import canciones from './routes/canciones.js';
import comentarios from './routes/comentarios.js';
import copiloto from './routes/copiloto.js';
import invitaciones from './routes/invitaciones.js';
import mensajes from './routes/mensajes.js';
import piezas from './routes/piezas.js';
import usos from './routes/usos.js';
import usuarios from './routes/usuarios.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({ name: 'Stemma API', status: 'ok', docs: 'See backend/README.md' });
});

// Creates missing tables/columns after a deploy (one cheap check per server instance), then reads the
// Bearer token, if any, into req.usuario.
app.use(async (req, res, next) => {
  await ensureSchema();
  next();
});
app.use(authenticate);

// Health check: confirms the database answers and shows how much data there is.
app.get('/health', async (req, res) => {
  const result = await db.query(
    `SELECT (SELECT COUNT(*) FROM piezas) AS piezas, (SELECT COUNT(*) FROM canciones WHERE borrada_at IS NULL) AS canciones,
            (SELECT COUNT(*) FROM usuarios) AS usuarios`,
  );
  const { piezas: totalPiezas, canciones: totalCanciones, usuarios: totalUsuarios } = result.rows[0];
  res.json({
    status: 'ok',
    database: databaseKind,
    piezas: Number(totalPiezas),
    canciones: Number(totalCanciones),
    usuarios: Number(totalUsuarios),
    copiloto: Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY),
  });
});

app.use(usos); // GET /usos and GET /piezas/:id/usos (before the /piezas router, which has /:id)
app.use('/auth', auth);
app.use('/usuarios', usuarios);
app.use('/piezas', piezas);
app.use('/canciones', canciones);
app.use('/copiloto', copiloto);
app.use('/comentarios', comentarios);
app.use('/invitaciones', invitaciones);
app.use('/mensajes', mensajes);

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// Every error ends here and is returned as { "error": "message" }.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error(err);
  const hideDetails = status >= 500 && !err.expose && process.env.NODE_ENV === 'production';
  res.status(status).json({ error: hideDetails ? 'Internal server error' : err.message });
});

export default app;
