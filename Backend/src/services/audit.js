const { db } = require("../db/connection");

async function logAudit({ actorUserId, action, entity, entityId = null, before = null, after = null }) {
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, before_json, after_json)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      actorUserId || null,
      action,
      entity,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ]
  );
}

module.exports = { logAudit };
