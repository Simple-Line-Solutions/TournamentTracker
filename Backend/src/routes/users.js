const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { db } = require("../db/connection");
const { requireRole } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { logAudit } = require("../services/audit");

const router = express.Router();

router.get("/", requireRole("admin", "superadmin"), async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, username, role, nombre, activo, created_at FROM users ORDER BY id DESC"
  );
  res.json(rows);
});

router.post(
  "/",
  requireRole("admin", "superadmin"),
  validate(
    z.object({
      body: z.object({
        username: z.string().min(3),
        password: z.string().min(6),
        role: z.enum(["admin", "asistente", "superadmin", "Player"]),
        nombre: z.string().min(1),
        activo: z.boolean().default(true),
      }),
      params: z.object({}),
      query: z.object({}),
    })
  ),
  async (req, res) => {
    const { username, password, role, nombre, activo } = req.validated.body;

    if (req.user.role !== "superadmin" && role === "superadmin") {
      return res.status(403).json({ error: "Sin permisos para crear usuario superadmin" });
    }

    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await db.query(
      "INSERT INTO users (username, password_hash, role, nombre, activo) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [username, hash, role, nombre, activo]
    );
    const id = rows[0].id;

    await logAudit({
      actorUserId: req.user.id,
      action: "create",
      entity: "users",
      entityId: id,
      after: { username, role, nombre, activo },
    });

    res.status(201).json({ id });
  }
);

router.put(
  "/:id",
  requireRole("admin", "superadmin"),
  validate(
    z.object({
      body: z.object({
        nombre: z.string().min(1),
        role: z.enum(["admin", "asistente", "superadmin", "Player"]),
        activo: z.boolean(),
        password: z.string().min(6).optional(),
      }),
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({}),
    })
  ),
  async (req, res) => {
    const { id } = req.validated.params;
    const { nombre, role, activo, password } = req.validated.body;
    const { rows: beforeRows } = await db.query(
      "SELECT id, nombre, role, activo FROM users WHERE id = $1",
      [id]
    );
    const before = beforeRows[0];
    if (!before) return res.status(404).json({ error: "Usuario no encontrado" });

    if (req.user.role !== "superadmin" && before.role === "superadmin") {
      return res.status(403).json({ error: "Sin permisos para editar usuario superadmin" });
    }
    if (req.user.role !== "superadmin" && role === "superadmin") {
      return res.status(403).json({ error: "Sin permisos para asignar rol superadmin" });
    }

    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await db.query(
        "UPDATE users SET nombre = $1, role = $2, activo = $3, password_hash = $4, session_version = session_version + 1 WHERE id = $5",
        [nombre, role, activo, hash, id]
      );
    } else {
      await db.query(
        "UPDATE users SET nombre = $1, role = $2, activo = $3 WHERE id = $4",
        [nombre, role, activo, id]
      );
    }

    await logAudit({
      actorUserId: req.user.id,
      action: "update",
      entity: "users",
      entityId: id,
      before,
      after: { nombre, role, activo },
    });

    res.json({ ok: true });
  }
);

router.delete("/:id", requireRole("admin", "superadmin"), async (req, res) => {
  const id = Number(req.params.id);
  const { rows: beforeRows } = await db.query(
    "SELECT id, username, role FROM users WHERE id = $1",
    [id]
  );
  const before = beforeRows[0];
  if (!before) return res.status(404).json({ error: "Usuario no encontrado" });

  if (req.user.role !== "superadmin" && before.role === "superadmin") {
    return res.status(403).json({ error: "Sin permisos para eliminar usuario superadmin" });
  }
  if (before.id === req.user.id) {
    return res.status(400).json({ error: "No puedes eliminar tu propia cuenta" });
  }

  await db.query("DELETE FROM users WHERE id = $1", [id]);

  await logAudit({
    actorUserId: req.user.id,
    action: "delete",
    entity: "users",
    entityId: id,
    before,
  });

  res.json({ ok: true });
});

module.exports = router;
