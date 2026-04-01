const jwt = require("jsonwebtoken");
const { config } = require("../config");
const { db } = require("../db/connection");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Token requerido" });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.role, u.nombre, u.activo, u.session_version,
              p.id AS player_id
       FROM users u
       LEFT JOIN players p ON p.user_id = u.id
       WHERE u.id = $1`,
      [payload.sub]
    );
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    if (!user.activo) {
      return res.status(401).json({ error: "Usuario inactivo" });
    }

    if (user.role === "Player" && !config.isCircuitMode) {
      return res.status(403).json({ error: "Acceso de jugadores disponible solo en modo circuito" });
    }

    if (payload.sv !== user.session_version) {
      return res.status(401).json({ error: "Sesion invalida" });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalido" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "No autenticado" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Sin permisos" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
