// Loads backend/.env for local runs (server and scripts). Import it before anything that reads
// process.env. On Vercel the variables come from the project settings and .env does not exist.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
