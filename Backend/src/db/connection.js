const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL no está configurada en las variables de entorno");
}

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Error inesperado en cliente de pool de Postgres", err);
});

console.log("📦 Conectando a Postgres via DATABASE_URL");

// Wrapper para queries: db.query(sql, params) — igual interfaz que pg
const db = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};

module.exports = { db };
