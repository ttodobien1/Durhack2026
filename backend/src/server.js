// Local entry point: npm run dev / npm start
import './loadEnv.js';
import app from './app.js';

const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(`Stemma API listening on http://localhost:${port}`);
});
