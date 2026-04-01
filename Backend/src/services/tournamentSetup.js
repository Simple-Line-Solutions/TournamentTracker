const { db } = require("../db/connection");
const { buildZoneDistribution, calcTorneo } = require("../logic/zonas");
const { buildSlots } = require("../logic/bracket");
const { rankQualified } = require("../logic/seeding");

const GROUP_NAMES = ["A", "B", "C", "D", "E", "F"];

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function createGroups(tournament, client) {
  const q = client || db;
  const distribution = buildZoneDistribution(tournament.planned_pairs);
  for (let idx = 0; idx < distribution.length; idx++) {
    await q.query(
      "INSERT INTO groups (tournament_id, name, size) VALUES ($1, $2, $3)",
      [tournament.id, GROUP_NAMES[idx], distribution[idx]]
    );
  }
}

async function assignPairsAndGenerateZones(tournamentId) {
  const { rows: tRows } = await db.query("SELECT * FROM tournaments WHERE id = $1", [tournamentId]);
  const tournament = tRows[0];
  if (!tournament) throw new Error("Torneo no encontrado");
  if (tournament.zonas_generadas) return false;

  const { rows: allPairs } = await db.query(
    "SELECT id FROM pairs WHERE tournament_id = $1 ORDER BY id ASC",
    [tournamentId]
  );
  const pairs = shuffle(allPairs);
  if (pairs.length !== tournament.planned_pairs) {
    throw new Error("No estan todas las parejas cargadas para iniciar el torneo");
  }

  const { rows: groups } = await db.query(
    "SELECT * FROM groups WHERE tournament_id = $1 ORDER BY name ASC",
    [tournamentId]
  );

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    let cursor = 0;
    for (const group of groups) {
      const groupPairs = pairs.slice(cursor, cursor + group.size);
      cursor += group.size;

      for (const pair of groupPairs) {
        await client.query("UPDATE pairs SET group_id = $1 WHERE id = $2", [group.id, pair.id]);
        await client.query(
          "INSERT INTO group_standings (group_id, pair_id) VALUES ($1, $2)",
          [group.id, pair.id]
        );
      }

      if (group.size === 3) {
        const [p1, p2, p3] = groupPairs.map((p) => p.id);
        await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES ($1, 'zona', 'r1', $2, $3, $4)",
          [tournamentId, group.id, p1, p2]
        );
        await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES ($1, 'zona', 'r1', $2, $3, $4)",
          [tournamentId, group.id, p1, p3]
        );
        await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES ($1, 'zona', 'r1', $2, $3, $4)",
          [tournamentId, group.id, p2, p3]
        );
      } else {
        const [p1, p2, p3, p4] = groupPairs.map((p) => p.id);
        const { rows: m1Rows } = await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES ($1, 'zona', 'r1', $2, $3, $4) RETURNING id",
          [tournamentId, group.id, p1, p3]
        );
        const m1 = m1Rows[0].id;
        const { rows: m2Rows } = await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES ($1, 'zona', 'r1', $2, $3, $4) RETURNING id",
          [tournamentId, group.id, p2, p4]
        );
        const m2 = m2Rows[0].id;

        await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, slot1_source_match_id, slot2_source_match_id) VALUES ($1, 'zona', 'r2w', $2, $3, $4)",
          [tournamentId, group.id, m1, m2]
        );
        await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, slot1_source_match_id, slot2_source_match_id) VALUES ($1, 'zona', 'r2l', $2, $3, $4)",
          [tournamentId, group.id, m1, m2]
        );
      }
    }
    await client.query("UPDATE tournaments SET zonas_generadas = TRUE WHERE id = $1", [tournamentId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return true;
}

async function createBracketTree(tournament) {
  const setup = calcTorneo(tournament);
  const rounds = [];
  let size = setup.bracketSize;
  let roundIndex = 0;
  while (size >= 2) {
    rounds.push({ roundIndex, matches: size / 2, size });
    size /= 2;
    roundIndex += 1;
  }

  const roundNames = ["r1", "octavos", "cuartos", "semis", "final"];
  const allRoundRows = [];

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    for (const round of rounds) {
      const rows = [];
      for (let i = 0; i < round.matches; i += 1) {
        const name = round.size <= 2 ? "final" : roundNames[Math.min(roundNames.length - 1, round.roundIndex)];
        const { rows: inserted } = await client.query(
          "INSERT INTO matches (tournament_id, stage, round, pair1_id, pair2_id) VALUES ($1, 'eliminatoria', $2, NULL, NULL) RETURNING id",
          [tournament.id, name]
        );
        rows.push(inserted[0].id);
      }
      allRoundRows.push(rows);
    }

    for (let r = 0; r < allRoundRows.length - 1; r += 1) {
      const current = allRoundRows[r];
      const next = allRoundRows[r + 1];
      for (let i = 0; i < current.length; i += 2) {
        const target = next[Math.floor(i / 2)];
        await client.query(
          "UPDATE matches SET slot1_source_match_id = $1, slot2_source_match_id = $2 WHERE id = $3",
          [current[i], current[i + 1], target]
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getQualifiedRows(tournamentId) {
  const { rows: tRows } = await db.query("SELECT * FROM tournaments WHERE id = $1", [tournamentId]);
  const tournament = tRows[0];

  const { rows: zoneMatches } = await db.query(
    `SELECT pair1_id, pair2_id FROM matches
     WHERE tournament_id = $1 AND stage = 'zona'
       AND winner_id IS NOT NULL AND pair1_id IS NOT NULL AND pair2_id IS NOT NULL`,
    [tournamentId]
  );

  const opponentsByPair = new Map();
  zoneMatches.forEach((m) => {
    if (!opponentsByPair.has(m.pair1_id)) opponentsByPair.set(m.pair1_id, new Set());
    if (!opponentsByPair.has(m.pair2_id)) opponentsByPair.set(m.pair2_id, new Set());
    opponentsByPair.get(m.pair1_id).add(m.pair2_id);
    opponentsByPair.get(m.pair2_id).add(m.pair1_id);
  });

  const { rows: allRows } = await db.query(
    `SELECT gs.pair_id, gs.points, gs.games_won, gs.games_lost, gs.position,
            g.size AS group_size, g.name AS group_name, g.id AS group_id
     FROM group_standings gs
     INNER JOIN groups g ON g.id = gs.group_id
     WHERE g.tournament_id = $1 AND gs.position IS NOT NULL`,
    [tournamentId]
  );

  const rows = allRows
    .filter((r) => {
      if (r.group_size === 3) return r.position <= tournament.clasifican_de_zona_3;
      return r.position <= tournament.clasifican_de_zona_4;
    })
    .map((r) => ({
      ...r,
      previous_opponents: [...(opponentsByPair.get(r.pair_id) || new Set())],
    }));

  return rankQualified(rows, tournament);
}

async function getExpectedQualifiedCount(tournamentId, tournament) {
  const { rows: groups } = await db.query(
    "SELECT size FROM groups WHERE tournament_id = $1",
    [tournamentId]
  );
  return groups.reduce((total, group) => {
    if (group.size === 3) return total + tournament.clasifican_de_zona_3;
    return total + tournament.clasifican_de_zona_4;
  }, 0);
}

async function getPairLabelMap(tournamentId) {
  const { rows } = await db.query(
    `SELECT p.id AS pair_id,
            pl1.nombre AS p1_nombre, pl1.apellido AS p1_apellido,
            pl2.nombre AS p2_nombre, pl2.apellido AS p2_apellido
     FROM pairs p
     INNER JOIN pair_players pp1 ON pp1.pair_id = p.id AND pp1.player_num = 1
     INNER JOIN players pl1 ON pl1.id = pp1.player_id
     INNER JOIN pair_players pp2 ON pp2.pair_id = p.id AND pp2.player_num = 2
     INNER JOIN players pl2 ON pl2.id = pp2.player_id
     WHERE p.tournament_id = $1`,
    [tournamentId]
  );
  const map = new Map();
  rows.forEach((row) => {
    map.set(row.pair_id, `${row.p1_nombre} ${row.p1_apellido} / ${row.p2_nombre} ${row.p2_apellido}`);
  });
  return map;
}

async function getZoneTieConflicts(tournamentId) {
  const { rows: tRows } = await db.query(
    "SELECT id, clasifican_de_zona_3, clasifican_de_zona_4 FROM tournaments WHERE id = $1",
    [tournamentId]
  );
  const tournament = tRows[0];
  if (!tournament) return [];

  const { rows } = await db.query(
    `SELECT gs.pair_id, gs.position, gs.position_override, gs.points,
            gs.games_won, gs.games_lost, g.name AS group_name, g.size AS group_size
     FROM group_standings gs
     INNER JOIN groups g ON g.id = gs.group_id
     WHERE g.tournament_id = $1`,
    [tournamentId]
  );

  const pairLabelMap = await getPairLabelMap(tournamentId);
  const byZone = new Map();
  rows.forEach((row) => {
    const key = row.group_name;
    if (!byZone.has(key)) byZone.set(key, []);
    byZone.get(key).push(row);
  });

  const conflicts = [];

  byZone.forEach((zoneRows, zoneName) => {
    if (!zoneRows.length) return;
    const fullyOverridden = zoneRows.every((row) => row.position_override);
    if (fullyOverridden) return;

    const cutoff = zoneRows[0].group_size === 3
      ? tournament.clasifican_de_zona_3
      : tournament.clasifican_de_zona_4;

    const sorted = [...zoneRows].sort((a, b) => {
      if (a.points !== b.points) return b.points - a.points;
      const dgA = a.games_won - a.games_lost;
      const dgB = b.games_won - b.games_lost;
      if (dgA !== dgB) return dgB - dgA;
      return (a.position || 999) - (b.position || 999);
    });

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a.points !== b.points) continue;
      const diffA = a.games_won - a.games_lost;
      const diffB = b.games_won - b.games_lost;
      if (diffA !== diffB) continue;
      const affectsQualifiedSlots =
        (Number(a.position || 999) <= cutoff) || (Number(b.position || 999) <= cutoff);
      if (!affectsQualifiedSlots) continue;
      conflicts.push({
        zone_name: zoneName,
        points: a.points,
        dg: diffA,
        pair1_id: a.pair_id,
        pair1_label: pairLabelMap.get(a.pair_id) || `Pareja ${a.pair_id}`,
        pair1_position: a.position,
        pair2_id: b.pair_id,
        pair2_label: pairLabelMap.get(b.pair_id) || `Pareja ${b.pair_id}`,
        pair2_position: b.position,
      });
    }
  });

  return conflicts;
}

async function syncBracketFirstRound(tournamentId) {
  const { rows: tRows } = await db.query("SELECT * FROM tournaments WHERE id = $1", [tournamentId]);
  const tournament = tRows[0];

  const { rows: firstRound } = await db.query(
    `SELECT id FROM matches
     WHERE tournament_id = $1 AND stage = 'eliminatoria'
       AND slot1_source_match_id IS NULL AND slot2_source_match_id IS NULL
     ORDER BY id ASC`,
    [tournamentId]
  );

  if (!firstRound.length) return;

  const tieConflicts = await getZoneTieConflicts(tournamentId);
  if (tieConflicts.length > 0) {
    return {
      blocked: true,
      message: "Hay empates en zonas (puntos y DG). Define posiciones manuales y cerra zonas.",
      tie_conflicts: tieConflicts,
    };
  }

  const qualified = await getQualifiedRows(tournamentId);
  const expectedQualified = await getExpectedQualifiedCount(tournamentId, tournament);

  if (qualified.length < expectedQualified) {
    return {
      blocked: true,
      message: `Hay ${qualified.length}/${expectedQualified} clasificados definidos para la llave.`,
    };
  }

  const { slots, warnings } = buildSlots(qualified);

  for (const [idx, match] of firstRound.entries()) {
    const pair1 = slots[idx * 2] || null;
    const pair2 = slots[idx * 2 + 1] || null;
    const isBye = !pair1 || !pair2;
    const winnerId = isBye ? (pair1 || pair2) : null;

    if (isBye && winnerId) {
      await db.query(
        `UPDATE matches SET pair1_id = $1, pair2_id = $2, is_bye = TRUE,
          winner_id = $3, finished_at = COALESCE(finished_at, NOW())
         WHERE id = $4`,
        [pair1, pair2, winnerId, match.id]
      );

      const { rows: nextRows } = await db.query(
        `SELECT * FROM matches
         WHERE (slot1_source_match_id = $1 OR slot2_source_match_id = $1) LIMIT 1`,
        [match.id]
      );
      const nextMatch = nextRows[0];
      if (nextMatch && !nextMatch.finished_at) {
        if (nextMatch.slot1_source_match_id === match.id) {
          await db.query("UPDATE matches SET pair1_id = $1 WHERE id = $2", [winnerId, nextMatch.id]);
        } else {
          await db.query("UPDATE matches SET pair2_id = $1 WHERE id = $2", [winnerId, nextMatch.id]);
        }
      }
    } else {
      await db.query(
        `UPDATE matches SET pair1_id = $1, pair2_id = $2, is_bye = FALSE
         WHERE id = $3 AND started_at IS NULL AND finished_at IS NULL`,
        [pair1, pair2, match.id]
      );
    }
  }

  return {
    blocked: false,
    seeding_warnings: Array.isArray(warnings) ? warnings : [],
  };
}

module.exports = {
  createGroups,
  assignPairsAndGenerateZones,
  createBracketTree,
  syncBracketFirstRound,
};
