import cors from 'cors';
import express from 'express';
import { databaseKind, db } from './db/client.js';
import canciones from './routes/canciones.js';
import copiloto from './routes/copiloto.js';
import piezas from './routes/piezas.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({ name: 'Lineage API', status: 'ok', docs: 'See backend/README.md' });
});

// Health check: confirms the database answers and shows how much data there is.
app.get('/health', async (req, res) => {
  const result = await db.query(
    'SELECT (SELECT COUNT(*) FROM piezas) AS piezas, (SELECT COUNT(*) FROM canciones) AS canciones',
  );
  const { piezas: totalPiezas, canciones: totalCanciones } = result.rows[0];
  res.json({
    status: 'ok',
    database: databaseKind,
    piezas: Number(totalPiezas),
    canciones: Number(totalCanciones),
    copiloto: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.use('/piezas', piezas);
app.use('/canciones', canciones);
app.use('/copiloto', copiloto);

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
