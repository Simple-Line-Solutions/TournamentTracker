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

function createGroups(tournament) {
  const distribution = buildZoneDistribution(tournament.planned_pairs);
  const tx = db.transaction(() => {
    distribution.forEach((size, idx) => {
      db.prepare("INSERT INTO groups (tournament_id, name, size) VALUES (?, ?, ?)").run(
        tournament.id,
        GROUP_NAMES[idx],
        size
      );
    });
  });
  tx();
}

function assignPairsAndGenerateZones(tournamentId) {
  const tournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(tournamentId);
  if (!tournament) throw new Error("Torneo no encontrado");
  if (tournament.zonas_generadas) return false;

  const pairs = shuffle(
    db
    .prepare("SELECT id FROM pairs WHERE tournament_id = ? ORDER BY id ASC")
    .all(tournamentId)
  );
  if (pairs.length !== tournament.planned_pairs) {
    throw new Error("No estan todas las parejas cargadas para iniciar el torneo");
  }

  const groups = db
    .prepare("SELECT * FROM groups WHERE tournament_id = ? ORDER BY name ASC")
    .all(tournamentId);

  let cursor = 0;
  const tx = db.transaction(() => {
    for (const group of groups) {
      const groupPairs = pairs.slice(cursor, cursor + group.size);
      cursor += group.size;

      groupPairs.forEach((pair) => {
        db.prepare("UPDATE pairs SET group_id = ? WHERE id = ?").run(group.id, pair.id);
        db.prepare("INSERT INTO group_standings (group_id, pair_id) VALUES (?, ?)").run(group.id, pair.id);
      });

      if (group.size === 3) {
        const [p1, p2, p3] = groupPairs.map((p) => p.id);
        db.prepare(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES (?, 'zona', 'r1', ?, ?, ?)"
        ).run(tournamentId, group.id, p1, p2);
        db.prepare(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES (?, 'zona', 'r1', ?, ?, ?)"
        ).run(tournamentId, group.id, p1, p3);
        db.prepare(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES (?, 'zona', 'r1', ?, ?, ?)"
        ).run(tournamentId, group.id, p2, p3);
      } else {
        const [p1, p2, p3, p4] = groupPairs.map((p) => p.id);
        const m1 = db
          .prepare(
            "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES (?, 'zona', 'r1', ?, ?, ?)"
          )
          .run(tournamentId, group.id, p1, p3).lastInsertRowid;
        const m2 = db
          .prepare(
            "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES (?, 'zona', 'r1', ?, ?, ?)"
          )
          .run(tournamentId, group.id, p2, p4).lastInsertRowid;

        db.prepare(
          "INSERT INTO matches (tournament_id, stage, round, group_id, slot1_source_match_id, slot2_source_match_id) VALUES (?, 'zona', 'r2w', ?, ?, ?)"
        ).run(tournamentId, group.id, m1, m2);

        db.prepare(
          "INSERT INTO matches (tournament_id, stage, round, group_id, slot1_source_match_id, slot2_source_match_id) VALUES (?, 'zona', 'r2l', ?, ?, ?)"
        ).run(tournamentId, group.id, m1, m2);
      }
    }

    db.prepare("UPDATE tournaments SET zonas_generadas = 1 WHERE id = ?").run(tournamentId);
  });

  tx();
  return true;
}

function createBracketTree(tournament) {
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

  const tx = db.transaction(() => {
    rounds.forEach((round) => {
      const rows = [];
      for (let i = 0; i < round.matches; i += 1) {
        const name = round.size <= 2 ? "final" : roundNames[Math.min(roundNames.length - 1, round.roundIndex)];
        const id = db
          .prepare(
            "INSERT INTO matches (tournament_id, stage, round, pair1_id, pair2_id) VALUES (?, 'eliminatoria', ?, NULL, NULL)"
          )
          .run(tournament.id, name).lastInsertRowid;
        rows.push(id);
      }
      allRoundRows.push(rows);
    });

    for (let r = 0; r < allRoundRows.length - 1; r += 1) {
      const current = allRoundRows[r];
      const next = allRoundRows[r + 1];
      for (let i = 0; i < current.length; i += 2) {
        const target = next[Math.floor(i / 2)];
        db.prepare(
          "UPDATE matches SET slot1_source_match_id = ?, slot2_source_match_id = ? WHERE id = ?"
        ).run(current[i], current[i + 1], target);
      }
    }
  });

  tx();
}

function getQualifiedRows(tournamentId) {
  const tournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(tournamentId);
  const zoneMatches = db
    .prepare(
      `SELECT pair1_id, pair2_id
       FROM matches
       WHERE tournament_id = ?
         AND stage = 'zona'
         AND winner_id IS NOT NULL
         AND pair1_id IS NOT NULL
         AND pair2_id IS NOT NULL`
    )
    .all(tournamentId);

  const opponentsByPair = new Map();
  zoneMatches.forEach((m) => {
    if (!opponentsByPair.has(m.pair1_id)) opponentsByPair.set(m.pair1_id, new Set());
    if (!opponentsByPair.has(m.pair2_id)) opponentsByPair.set(m.pair2_id, new Set());
    opponentsByPair.get(m.pair1_id).add(m.pair2_id);
    opponentsByPair.get(m.pair2_id).add(m.pair1_id);
  });

  const rows = db
    .prepare(
      `SELECT gs.pair_id, gs.points, gs.games_won, gs.games_lost, gs.position, g.size AS group_size, g.name AS group_name, g.id AS group_id
       FROM group_standings gs
       INNER JOIN groups g ON g.id = gs.group_id
       WHERE g.tournament_id = ? AND gs.position IS NOT NULL`
    )
    .all(tournamentId)
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

function getExpectedQualifiedCount(tournamentId, tournament) {
  const groups = db
    .prepare(
      `SELECT size
       FROM groups
       WHERE tournament_id = ?`
    )
    .all(tournamentId);

  return groups.reduce((total, group) => {
    if (group.size === 3) return total + tournament.clasifican_de_zona_3;
    return total + tournament.clasifican_de_zona_4;
  }, 0);
}

function getPairLabelMap(tournamentId) {
  const rows = db
    .prepare(
      `SELECT
        p.id AS pair_id,
        pl1.nombre AS p1_nombre,
        pl1.apellido AS p1_apellido,
        pl2.nombre AS p2_nombre,
        pl2.apellido AS p2_apellido
       FROM pairs p
       INNER JOIN pair_players pp1 ON pp1.pair_id = p.id AND pp1.player_num = 1
       INNER JOIN players pl1 ON pl1.id = pp1.player_id
       INNER JOIN pair_players pp2 ON pp2.pair_id = p.id AND pp2.player_num = 2
       INNER JOIN players pl2 ON pl2.id = pp2.player_id
       WHERE p.tournament_id = ?`
    )
    .all(tournamentId);

  const map = new Map();
  rows.forEach((row) => {
    map.set(row.pair_id, `${row.p1_nombre} ${row.p1_apellido} / ${row.p2_nombre} ${row.p2_apellido}`);
  });
  return map;
}

function getZoneTieConflicts(tournamentId) {
  const tournament = db
    .prepare(
      `SELECT id, clasifican_de_zona_3, clasifican_de_zona_4
       FROM tournaments
       WHERE id = ?`
    )
    .get(tournamentId);
  if (!tournament) return [];

  const rows = db
    .prepare(
      `SELECT
        gs.pair_id,
        gs.position,
        gs.position_override,
        gs.points,
        gs.games_won,
        gs.games_lost,
        g.name AS group_name,
        g.size AS group_size
       FROM group_standings gs
       INNER JOIN groups g ON g.id = gs.group_id
       WHERE g.tournament_id = ?`
    )
    .all(tournamentId);

  const pairLabelMap = getPairLabelMap(tournamentId);
  const byZone = new Map();
  rows.forEach((row) => {
    const key = row.group_name;
    if (!byZone.has(key)) byZone.set(key, []);
    byZone.get(key).push(row);
  });

  const conflicts = [];

  byZone.forEach((zoneRows, zoneName) => {
    if (!zoneRows.length) return;

    const fullyOverridden = zoneRows.every((row) => Number(row.position_override) === 1);
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
        (Number(a.position || 999) <= cutoff) ||
        (Number(b.position || 999) <= cutoff);
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

function syncBracketFirstRound(tournamentId) {
  const tournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(tournamentId);
  const firstRound = db
    .prepare(
      `SELECT id FROM matches
       WHERE tournament_id = ? AND stage = 'eliminatoria'
       AND slot1_source_match_id IS NULL
       AND slot2_source_match_id IS NULL
       ORDER BY id ASC`
    )
    .all(tournamentId);

  if (!firstRound.length) return;

  const tieConflicts = getZoneTieConflicts(tournamentId);
  if (tieConflicts.length > 0) {
    return {
      blocked: true,
      message: "Hay empates en zonas (puntos y DG). Define posiciones manuales y cerra zonas.",
      tie_conflicts: tieConflicts,
    };
  }

  const qualified = getQualifiedRows(tournamentId);
  const expectedQualified = getExpectedQualifiedCount(tournamentId, tournament);

  if (qualified.length < expectedQualified) {
    return {
      blocked: true,
      message: `Hay ${qualified.length}/${expectedQualified} clasificados definidos para la llave.`,
    };
  }

  const { slots, warnings } = buildSlots(qualified);
  const tx = db.transaction(() => {
    firstRound.forEach((match, idx) => {
      const pair1 = slots[idx * 2] || null;
      const pair2 = slots[idx * 2 + 1] || null;
      const isBye = !pair1 || !pair2 ? 1 : 0;
      const winnerId = isBye ? (pair1 || pair2) : null;

      if (isBye && winnerId) {
        db.prepare(
          `UPDATE matches SET pair1_id = ?, pair2_id = ?, is_bye = 1,
            winner_id = ?,
            finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
           WHERE id = ?`
        ).run(pair1, pair2, winnerId, match.id);

        // Propagate bye winner to the next round match
        const nextMatch = db
          .prepare(
            `SELECT * FROM matches
             WHERE (slot1_source_match_id = ? OR slot2_source_match_id = ?)
             LIMIT 1`
          )
          .get(match.id, match.id);

        if (nextMatch && !nextMatch.finished_at) {
          if (nextMatch.slot1_source_match_id === match.id) {
            db.prepare("UPDATE matches SET pair1_id = ? WHERE id = ?").run(winnerId, nextMatch.id);
          } else {
            db.prepare("UPDATE matches SET pair2_id = ? WHERE id = ?").run(winnerId, nextMatch.id);
          }
        }
      } else {
        db.prepare(
          `UPDATE matches
           SET pair1_id = ?, pair2_id = ?, is_bye = 0
           WHERE id = ? AND started_at IS NULL AND finished_at IS NULL`
        ).run(pair1, pair2, match.id);
      }
    });
  });
  tx();
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
