const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { db } = require("../db/connection");
const { config } = require("../config");
const { signToken } = require("../services/auth");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { logAudit } = require("../services/audit");

const router = express.Router();
const playerRegistrationSchema = z.object({
  nombre: z.string().min(1),
  apellido: z.string().min(1),
  telefono: z.string().min(1),
  dni: z.string().min(1),
  email: z.string().email(),
  categoria: z.string().min(1),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  password: z.string().min(6),
});

router.post(
  "/register-player",
  validate(
    z.object({
      body: playerRegistrationSchema,
      params: z.object({}),
      query: z.object({}),
    })
  ),
  (req, res) => {
    if (!config.isCircuitMode) {
      return res.status(403).json({ error: "Registro de jugadores disponible solo en modo circuito" });
    }

    const { nombre, apellido, telefono, dni, email, categoria, fecha_nacimiento, password } =
      req.validated.body;

    const existingEmail = db.prepare("SELECT id FROM users WHERE username = ?").get(email.toLowerCase());
    if (existingEmail) {
      return res.status(409).json({ error: "Ya existe un usuario con ese e-mail" });
    }

    const existingPlayer = db
      .prepare("SELECT id FROM players WHERE dni = ? OR email = ?")
      .get(dni, email.toLowerCase());
    if (existingPlayer) {
      return res.status(409).json({ error: "Ya existe un jugador registrado con ese DNI o e-mail" });
    }

    const hash = bcrypt.hashSync(password, 10);
    const tx = db.transaction(() => {
      const userResult = db
        .prepare(
          "INSERT INTO users (username, password_hash, role, nombre, activo) VALUES (?, ?, 'Player', ?, 1)"
        )
        .run(email.toLowerCase(), hash, `${nombre} ${apellido}`.trim());

      // Lookup category_id based on code
      const categoryRecord = db
        .prepare("SELECT id FROM categories WHERE code = ?")
        .get(categoria);
      const categoryId = categoryRecord ? categoryRecord.id : null;

      const playerResult = db
        .prepare(
          `INSERT INTO players (
             user_id, nombre, apellido, telefono, dni, email, category_id, fecha_nacimiento
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          userResult.lastInsertRowid,
          nombre,
          apellido,
          telefono,
          dni,
          email.toLowerCase(),
          categoryId,
          fecha_nacimiento
        );

      return {
        userId: userResult.lastInsertRowid,
        playerId: playerResult.lastInsertRowid,
      };
    });

    const created = tx();
    const user = db
      .prepare(
        `SELECT u.id, u.username, u.role, u.nombre, u.activo, u.session_version,
                p.id AS player_id
         FROM users u
         LEFT JOIN players p ON p.user_id = u.id
         WHERE u.id = ?`
      )
      .get(created.userId);

    logAudit({
      actorUserId: created.userId,
      action: "register",
      entity: "players",
      entityId: created.playerId,
      after: { nombre, apellido, telefono, dni, email: email.toLowerCase(), categoria, fecha_nacimiento },
    });

    const token = signToken(user);
    return res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        nombre: user.nombre,
        playerId: user.player_id,
      },
    });
  }
);

router.post(
  "/login",
  validate(
    z.object({
      body: z.object({ username: z.string().min(1), password: z.string().min(1) }),
      params: z.object({}),
      query: z.object({}),
    })
  ),
  (req, res) => {
    const { username, password } = req.validated.body;
    const user = db
      .prepare(
        `SELECT u.id, u.username, u.password_hash, u.role, u.nombre, u.activo, u.session_version,
                p.id AS player_id
         FROM users u
         LEFT JOIN players p ON p.user_id = u.id
         WHERE u.username = ?`
      )
      .get(username);

    if (!user) return res.status(401).json({ error: "Credenciales invalidas" });
    if (!user.activo) return res.status(401).json({ error: "Usuario inactivo" });
    if (user.role === "Player" && !config.isCircuitMode) {
      return res.status(403).json({ error: "Acceso de jugadores disponible solo en modo circuito" });
    }

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciales invalidas" });

    const token = signToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        nombre: user.nombre,
        playerId: user.player_id,
      },
    });
  }
);

router.post("/logout", requireAuth, (req, res) => {
  db.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").run(req.user.id);
  logAudit({
    actorUserId: req.user.id,
    action: "logout",
    entity: "auth",
  });
  res.json({ ok: true });
});

router.post(
  "/change-password",
  requireAuth,
  validate(
    z.object({
      body: z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(6),
      }),
      params: z.object({}),
      query: z.object({}),
    })
  ),
  (req, res) => {
    const { currentPassword, newPassword } = req.validated.body;

    const user = db
      .prepare("SELECT id, password_hash FROM users WHERE id = ?")
      .get(req.user.id);

    const ok = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!ok) return res.status(400).json({ error: "La contraseña actual es incorrecta" });

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare(
      "UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?"
    ).run(newHash, req.user.id);

    const updated = db
      .prepare("SELECT id, username, role, nombre, activo, session_version FROM users WHERE id = ?")
      .get(req.user.id);

    const token = signToken(updated);

    logAudit({
      actorUserId: req.user.id,
      action: "change_password",
      entity: "auth",
      entityId: req.user.id,
    });

    res.json({ ok: true, token });
  }
);

// TEMPORAL - Eliminar después de usar
router.post("/reset-secret", (req, res) => {
  const { secret, username, newPassword } = req.body;
  if (!secret || secret !== process.env.JWT_SECRET) {
    return res.status(403).json({ error: "No autorizado" });
  }
  if (!username || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Datos inválidos" });
  }
  const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?").run(hash, user.id);

  res.json({ ok: true, message: `Contraseña de '${username}' actualizada. ELIMINAR ESTE ENDPOINT.` });
});

module.exports = router;
