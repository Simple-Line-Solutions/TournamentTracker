const express = require("express");
const { z } = require("zod");
const { db } = require("../db/connection");
const { requireRole } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { logAudit } = require("../services/audit");

const router = express.Router();

const clubSchema = z.object({
  body: z.object({
    nombre: z.string().min(1),
    descripcion: z.string().optional(),
    activo: z.boolean().default(true),
  }),
  params: z.object({}),
  query: z.object({}),
});

const updateSchema = z.object({
  body: z.object({
    nombre: z.string().min(1),
    descripcion: z.string().nullable().optional(),
    activo: z.boolean(),
  }),
  params: z.object({ id: z.coerce.number().positive() }),
  query: z.object({}),
});

router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM global_clubs ORDER BY id ASC");
  res.json(rows);
});

router.post("/", requireRole("admin"), validate(clubSchema), async (req, res) => {
  const { nombre, descripcion, activo } = req.validated.body;
  const { rows } = await db.query(
    "INSERT INTO global_clubs (nombre, descripcion, activo) VALUES ($1, $2, $3) RETURNING id",
    [nombre.trim(), (descripcion || "").trim() || null, activo]
  );
  const id = rows[0].id;

  await logAudit({
    actorUserId: req.user.id,
    action: "create",
    entity: "global_clubs",
    entityId: id,
    after: { nombre, descripcion, activo },
  });

  res.status(201).json({ id });
});

router.put("/:id", requireRole("admin"), validate(updateSchema), async (req, res) => {
  const id = req.validated.params.id;
  const { nombre, descripcion, activo } = req.validated.body;
  const { rows: beforeRows } = await db.query("SELECT * FROM global_clubs WHERE id = $1", [id]);
  const before = beforeRows[0];
  if (!before) return res.status(404).json({ error: "Club no encontrado" });

  await db.query(
    "UPDATE global_clubs SET nombre = $1, descripcion = $2, activo = $3 WHERE id = $4",
    [nombre.trim(), (descripcion || "").trim() || null, activo, id]
  );

  await logAudit({
    actorUserId: req.user.id,
    action: "update",
    entity: "global_clubs",
    entityId: id,
    before,
    after: { nombre, descripcion, activo },
  });

  res.json({ ok: true });
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const { rows: beforeRows } = await db.query("SELECT * FROM global_clubs WHERE id = $1", [id]);
  const before = beforeRows[0];
  if (!before) return res.status(404).json({ error: "Club no encontrado" });

  const { rows: usageRows } = await db.query(
    "SELECT COUNT(*) AS total FROM global_courts WHERE club_id = $1",
    [id]
  );
  if (Number(usageRows[0]?.total || 0) > 0) {
    return res.status(400).json({
      error: "No se puede eliminar el club porque esta asignado a una o mas canchas globales",
    });
  }

  await db.query("DELETE FROM global_clubs WHERE id = $1", [id]);
  await logAudit({
    actorUserId: req.user.id,
    action: "delete",
    entity: "global_clubs",
    entityId: id,
    before,
  });

  res.json({ ok: true });
});

module.exports = router;
