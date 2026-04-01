const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { db } = require("./connection");
const { config } = require("../config");

async function runMigrations() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDir = path.resolve(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    // Solo ejecutar la migración de Postgres, ignorar las de SQLite
    const isPostgresMigration = file === "001_init_postgres.sql";
    const isSQLiteMigration = !isPostgresMigration && file.endsWith(".sql");
    if (isSQLiteMigration) continue;

    const { rows } = await db.query(
      "SELECT id FROM schema_migrations WHERE name = $1",
      [file]
    );
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`✓ Migración ejecutada: ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // Seed: admin inicial
  const { rows: usersRows } = await db.query("SELECT COUNT(*) as total FROM users");
  if (parseInt(usersRows[0].total) === 0) {
    const hash = bcrypt.hashSync(config.adminPassword, 10);
    await db.query(
      "INSERT INTO users (username, password_hash, role, nombre, activo) VALUES ($1, $2, 'admin', $3, TRUE)",
      [config.adminUser, hash, config.adminName]
    );
  }

  // Seed: superadmin
  const { rows: superRows } = await db.query(
    "SELECT id FROM users WHERE role = 'superadmin' LIMIT 1"
  );
  if (superRows.length === 0) {
    let superPassword = config.superadminPassword;
    if (!superPassword) {
      const rnd = () => Math.random().toString(36).slice(2, 8);
      superPassword = `${rnd()}-${rnd()}-${rnd()}`;
      console.warn(
        "\n⚠️  SUPERADMIN_PASSWORD no configurado en variables de entorno." +
        `\n   Contraseña de primer acceso: ${superPassword}` +
        "\n   Cambiala desde la aplicación ni bien ingreses.\n"
      );
    }
    const superHash = bcrypt.hashSync(superPassword, 10);
    await db.query(
      "INSERT INTO users (username, password_hash, role, nombre, activo) VALUES ($1, $2, 'superadmin', $3, TRUE)",
      [config.superadminUser, superHash, config.superadminName]
    );
  }
}

module.exports = { runMigrations };

