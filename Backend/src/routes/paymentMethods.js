const express = require("express");
const { z } = require("zod");
const { db } = require("../db/connection");
const { requireRole } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { logAudit } = require("../services/audit");

const router = express.Router();

router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM payment_methods ORDER BY id DESC");
  res.json(rows);
});

router.post(
  "/",
  requireRole("admin"),
  validate(
    z.object({
      body: z.object({
        nombre: z.string().min(1),
        descripcion: z.string().optional(),
        activo: z.boolean().default(true),
      }),
      params: z.object({}),
      query: z.object({}),
    })
  ),
  async (req, res) => {
    const { nombre, descripcion, activo } = req.validated.body;
    const { rows } = await db.query(
      "INSERT INTO payment_methods (nombre, descripcion, activo) VALUES ($1, $2, $3) RETURNING id",
      [nombre, descripcion || null, activo]
    );
    const id = rows[0].id;

    await logAudit({
      actorUserId: req.user.id,
      action: "create",
      entity: "payment_methods",
      entityId: id,
      after: { nombre, descripcion, activo },
    });

    res.status(201).json({ id });
  }
);

router.put(
  "/:id",
  requireRole("admin"),
  validate(
    z.object({
      body: z.object({
        nombre: z.string().min(1),
        descripcion: z.string().nullable().optional(),
        activo: z.boolean(),
      }),
      params: z.object({ id: z.coerce.number().positive() }),
      query: z.object({}),
    })
  ),
  async (req, res) => {
    const id = req.validated.params.id;
    const { nombre, descripcion, activo } = req.validated.body;
    const { rows: beforeRows } = await db.query("SELECT * FROM payment_methods WHERE id = $1", [id]);
    const before = beforeRows[0];
    if (!before) return res.status(404).json({ error: "Medio no encontrado" });

    await db.query(
      "UPDATE payment_methods SET nombre = $1, descripcion = $2, activo = $3 WHERE id = $4",
      [nombre, descripcion || null, activo, id]
    );

    await logAudit({
      actorUserId: req.user.id,
      action: "update",
      entity: "payment_methods",
      entityId: id,
      before,
      after: { nombre, descripcion, activo },
    });

    res.json({ ok: true });
  }
);

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const { rows: beforeRows } = await db.query("SELECT * FROM payment_methods WHERE id = $1", [id]);
  const before = beforeRows[0];
  if (!before) return res.status(404).json({ error: "Medio no encontrado" });

  await db.query("DELETE FROM payment_methods WHERE id = $1", [id]);
  await logAudit({
    actorUserId: req.user.id,
    action: "delete",
    entity: "payment_methods",
    entityId: id,
    before,
  });
  res.json({ ok: true });
});

module.exports = router;
