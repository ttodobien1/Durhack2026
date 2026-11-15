// What the connected database supports, found when the schema is applied (migrate.js applyExtras).
//   vectores:  pgvector columns exist (fingerprint similarity in SQL, semantic search)
//   timescale: the events table is a TimescaleDB hypertable with the eventos_hora continuous aggregate (TigerData)
export const features = { vectores: false, timescale: false };
