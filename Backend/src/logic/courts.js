const { db } = require("../db/connection");

async function ensureMatchNotPlaying(matchId, client) {
  const q = client || db;
  const { rows } = await q.query(
    "SELECT started_at, finished_at FROM matches WHERE id = $1",
    [matchId]
  );
  const match = rows[0];
  if (!match) throw new Error("Partido no encontrado");
  if (match.finished_at) throw new Error("No se puede reasignar un partido finalizado");
  if (match.started_at && !match.finished_at) throw new Error("No se puede reasignar un partido en juego");
}

async function normalizeQueue(courtId, client) {
  const q = client || db;
  const { rows } = await q.query(
    "SELECT id FROM court_queue WHERE court_id = $1 ORDER BY orden ASC, id ASC",
    [courtId]
  );
  for (const [index, row] of rows.entries()) {
    await q.query("UPDATE court_queue SET orden = $1 WHERE id = $2", [index + 1, row.id]);
  }
}

async function queueMatch(courtId, matchId, client) {
  const q = client || db;
  await ensureMatchNotPlaying(matchId, q);

  const { rows: existing } = await q.query(
    "SELECT id FROM court_queue WHERE match_id = $1",
    [matchId]
  );
  if (existing[0]) throw new Error("El partido ya esta asignado a una cancha");

  const { rows: maxRows } = await q.query(
    "SELECT COALESCE(MAX(orden), 0) as max_orden FROM court_queue WHERE court_id = $1",
    [courtId]
  );
  const maxOrder = Number(maxRows[0].max_orden);

  await q.query(
    "INSERT INTO court_queue (court_id, match_id, orden) VALUES ($1, $2, $3)",
    [courtId, matchId, maxOrder + 1]
  );
}

async function upsertQueuedMatch(courtId, matchId) {
  await ensureMatchNotPlaying(matchId);

  const { rows: existingRows } = await db.query(
    "SELECT court_id FROM court_queue WHERE match_id = $1",
    [matchId]
  );
  const existing = existingRows[0];
  if (existing?.court_id === courtId) return;

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    if (existing) {
      await client.query("DELETE FROM court_queue WHERE match_id = $1", [matchId]);
      await normalizeQueue(existing.court_id, client);
    }
    await queueMatch(courtId, matchId, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function removeFromQueue(courtId, matchId, client) {
  const q = client || db;
  await q.query(
    "DELETE FROM court_queue WHERE court_id = $1 AND match_id = $2",
    [courtId, matchId]
  );
  await normalizeQueue(courtId, q);
}

async function removeQueuedMatch(matchId, client) {
  const q = client || db;
  const { rows: existingRows } = await q.query(
    "SELECT court_id FROM court_queue WHERE match_id = $1",
    [matchId]
  );
  const existing = existingRows[0];
  if (!existing) return;

  await q.query("DELETE FROM court_queue WHERE match_id = $1", [matchId]);
  await normalizeQueue(existing.court_id, q);
}

async function reorderQueue(courtId, matchIds, client) {
  const q = client || db;
  for (const [idx, matchId] of matchIds.entries()) {
    await q.query(
      "UPDATE court_queue SET orden = $1 WHERE court_id = $2 AND match_id = $3",
      [idx + 1, courtId, matchId]
    );
  }
}

async function promoteNext(courtId, client) {
  const q = client || db;
  const { rows } = await q.query(
    `SELECT cq.match_id
     FROM court_queue cq
     WHERE cq.court_id = $1
     ORDER BY cq.orden ASC
     LIMIT 1`,
    [courtId]
  );
  if (!rows[0]) return null;
  return rows[0].match_id;
}

module.exports = {
  queueMatch,
  upsertQueuedMatch,
  removeFromQueue,
  removeQueuedMatch,
  reorderQueue,
  promoteNext,
};
