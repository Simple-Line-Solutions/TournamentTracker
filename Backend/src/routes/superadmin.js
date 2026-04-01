const express = require("express");
const { z } = require("zod");
const { db } = require("../db/connection");
const { requireRole } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { logAudit } = require("../services/audit");

const router = express.Router();

router.use(requireRole("superadmin"));

// ─── Jugadores ────────────────────────────────────────────────────────────────

router.get("/jugadores", async (req, res) => {
  const q = String(req.query.q || "").trim();
  let result;
  if (q) {
    result = await db.query(
      `SELECT * FROM players
       WHERE nombre ILIKE $1 OR apellido ILIKE $1 OR dni ILIKE $1 OR email ILIKE $1
       ORDER BY apellido, nombre`,
      [`%${q}%`]
    );
  } else {
    result = await db.query("SELECT * FROM players ORDER BY apellido, nombre");
  }
  res.json(result.rows);
});

router.put(
  "/jugadores/:id",
  validate(
    z.object({
      body: z.object({
        nombre: z.string().min(1),
        apellido: z.string().min(1),
        telefono: z.string().min(1),
        dni: z.string().min(1).nullable().optional(),
        email: z.string().email().nullable().optional(),
        categoria: z.string().min(1).nullable().optional(),
        fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({}),
    })
  ),
  async (req, res) => {
    const { id } = req.validated.params;
    const { nombre, apellido, telefono, dni = null, email = null, categoria = null, fecha_nacimiento = null } =
      req.validated.body;

    const { rows: beforeRows } = await db.query("SELECT * FROM players WHERE id = $1", [id]);
    const before = beforeRows[0];
    if (!before) return res.status(404).json({ error: "Jugador no encontrado" });

    let categoryId = null;
    if (categoria) {
      const { rows: catRows } = await db.query(
        "SELECT id FROM categories WHERE code = $1",
        [categoria]
      );
      categoryId = catRows[0]?.id || null;
    }

    await db.query(
      `UPDATE players
       SET nombre = $1, apellido = $2, telefono = $3, dni = $4, email = $5,
           category_id = $6, fecha_nacimiento = $7
       WHERE id = $8`,
      [nombre, apellido, telefono, dni, email, categoryId, fecha_nacimiento, id]
    );

    await logAudit({
      actorUserId: req.user.id,
      action: "update",
      entity: "players",
      entityId: id,
      before,
      after: { nombre, apellido, telefono, dni, email, categoria, fecha_nacimiento },
    });

    res.json({ ok: true });
  }
);

// ─── Auditoría ────────────────────────────────────────────────────────────────

router.get("/auditoria", async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = 50;
  const offset = (page - 1) * limit;
  const entity = req.query.entity || null;
  const action = req.query.action || null;

  const conditions = [];
  const whereParams = [];
  let paramIdx = 1;

  if (entity) {
    conditions.push(`a.entity = $${paramIdx++}`);
    whereParams.push(entity);
  }
  if (action) {
    conditions.push(`a.action = $${paramIdx++}`);
    whereParams.push(action);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await db.query(
    `SELECT COUNT(*) as c FROM audit_logs a ${where}`,
    whereParams
  );
  const total = Number(countResult.rows[0].c);

  const rowsResult = await db.query(
    `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id,
            a.before_json, a.after_json,
            u.username, u.nombre as actor_nombre
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     ${where}
     ORDER BY a.id DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...whereParams, limit, offset]
  );

  res.json({ rows: rowsResult.rows, total, page, pages: Math.ceil(total / limit) });
});

// ─── Torneos ─────────────────────────────────────────────────────────────────

router.post("/torneos/:id/cancelar", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await db.query("SELECT * FROM tournaments WHERE id = $1", [id]);
  const t = rows[0];
  if (!t) return res.status(404).json({ error: "Torneo no encontrado" });
  if (t.status === "cancelado") {
    return res.status(400).json({ error: "El torneo ya está cancelado" });
  }

  await db.query("UPDATE tournaments SET status = 'cancelado' WHERE id = $1", [id]);

  await logAudit({
    actorUserId: req.user.id,
    action: "cancelar",
    entity: "tournaments",
    entityId: id,
    before: { status: t.status },
    after: { status: "cancelado" },
  });

  res.json({ ok: true });
});

router.post("/torneos/:id/reset", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await db.query("SELECT * FROM tournaments WHERE id = $1", [id]);
  const t = rows[0];
  if (!t) return res.status(404).json({ error: "Torneo no encontrado" });

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM matches WHERE tournament_id = $1", [id]);
    await client.query(
      "DELETE FROM group_standings WHERE group_id IN (SELECT id FROM groups WHERE tournament_id = $1)",
      [id]
    );
    await client.query("DELETE FROM groups WHERE tournament_id = $1", [id]);
    await client.query(
      "UPDATE pairs SET group_id = NULL, seed_rank = NULL WHERE tournament_id = $1",
      [id]
    );
    await client.query(
      "UPDATE tournaments SET zonas_generadas = FALSE, status = 'activo' WHERE id = $1",
      [id]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await logAudit({
    actorUserId: req.user.id,
    action: "reset",
    entity: "tournaments",
    entityId: id,
    before: { status: t.status, zonas_generadas: t.zonas_generadas },
    after: { status: "activo", zonas_generadas: false },
  });

  res.json({ ok: true });
});

module.exports = router;
