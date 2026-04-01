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
  async (req, res) => {
    if (!config.isCircuitMode) {
      return res.status(403).json({ error: "Registro de jugadores disponible solo en modo circuito" });
    }

    const { nombre, apellido, telefono, dni, email, categoria, fecha_nacimiento, password } =
      req.validated.body;

    const { rows: existingEmailRows } = await db.query(
      "SELECT id FROM users WHERE username = $1",
      [email.toLowerCase()]
    );
    if (existingEmailRows[0]) {
      return res.status(409).json({ error: "Ya existe un usuario con ese e-mail" });
    }

    const { rows: existingPlayerRows } = await db.query(
      "SELECT id FROM players WHERE dni = $1 OR email = $2",
      [dni, email.toLowerCase()]
    );
    if (existingPlayerRows[0]) {
      return res.status(409).json({ error: "Ya existe un jugador registrado con ese DNI o e-mail" });
    }

    const hash = bcrypt.hashSync(password, 10);
    const client = await db.getClient();
    let created;
    try {
      await client.query("BEGIN");

      const { rows: userRows } = await client.query(
        "INSERT INTO users (username, password_hash, role, nombre, activo) VALUES ($1, $2, 'Player', $3, TRUE) RETURNING id",
        [email.toLowerCase(), hash, `${nombre} ${apellido}`.trim()]
      );
      const userId = userRows[0].id;

      const { rows: catRows } = await client.query(
        "SELECT id FROM categories WHERE code = $1",
        [categoria]
      );
      const categoryId = catRows[0]?.id || null;

      const { rows: playerRows } = await client.query(
        `INSERT INTO players (user_id, nombre, apellido, telefono, dni, email, category_id, fecha_nacimiento)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [userId, nombre, apellido, telefono, dni, email.toLowerCase(), categoryId, fecha_nacimiento]
      );
      const playerId = playerRows[0].id;

      await client.query("COMMIT");
      created = { userId, playerId };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const { rows: userRows } = await db.query(
      `SELECT u.id, u.username, u.role, u.nombre, u.activo, u.session_version,
              p.id AS player_id
       FROM users u
       LEFT JOIN players p ON p.user_id = u.id
       WHERE u.id = $1`,
      [created.userId]
    );
    const user = userRows[0];

    await logAudit({
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
  async (req, res) => {
    const { username, password } = req.validated.body;
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.password_hash, u.role, u.nombre, u.activo, u.session_version,
              p.id AS player_id
       FROM users u
       LEFT JOIN players p ON p.user_id = u.id
       WHERE u.username = $1`,
      [username]
    );
    const user = rows[0];

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

router.post("/logout", requireAuth, async (req, res) => {
  await db.query(
    "UPDATE users SET session_version = session_version + 1 WHERE id = $1",
    [req.user.id]
  );
  await logAudit({
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
  async (req, res) => {
    const { currentPassword, newPassword } = req.validated.body;

    const { rows } = await db.query(
      "SELECT id, password_hash FROM users WHERE id = $1",
      [req.user.id]
    );
    const user = rows[0];

    const ok = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!ok) return res.status(400).json({ error: "La contraseña actual es incorrecta" });

    const newHash = bcrypt.hashSync(newPassword, 10);
    await db.query(
      "UPDATE users SET password_hash = $1, session_version = session_version + 1 WHERE id = $2",
      [newHash, req.user.id]
    );

    const { rows: updatedRows } = await db.query(
      "SELECT id, username, role, nombre, activo, session_version FROM users WHERE id = $1",
      [req.user.id]
    );
    const token = signToken(updatedRows[0]);

    await logAudit({
      actorUserId: req.user.id,
      action: "change_password",
      entity: "auth",
      entityId: req.user.id,
    });

    res.json({ ok: true, token });
  }
);

module.exports = router;
