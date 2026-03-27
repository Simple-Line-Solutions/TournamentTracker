const express = require("express");
const { z } = require("zod");
const { db } = require("../db/connection");
const { config } = require("../config");
const { validate } = require("../middleware/validate");
const { logAudit } = require("../services/audit");
const { createGroups, assignPairsAndGenerateZones, createBracketTree, syncBracketFirstRound } = require("../services/tournamentSetup");
const { recalcGroupStandings } = require("../logic/standings");
const { normalizeEstadoForTransactions } = require("../logic/payments");
const { buildWOSets } = require("../logic/wo");
const { queueMatch, removeFromQueue, reorderQueue } = require("../logic/courts");
const { seedEntries, buildSlots } = require("../logic/bracket");
const { rankQualified } = require("../logic/seeding");
const { getZonesCount } = require("../logic/zonas");

const router = express.Router();

function courtScopeFilter(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return config.isCircuitMode ? `${prefix}club_id IS NOT NULL` : `${prefix}club_id IS NULL`;
}

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    tipo_torneo: z.string().min(1).optional(),
    clasifican_de_zona_3: z.number().int().min(1).max(3).default(2),
    clasifican_de_zona_4: z.number().int().min(1).max(4).default(3),
    global_court_ids: z.array(z.number().int().positive()).min(1),
    enabled_payment_method_ids: z.array(z.number().int().positive()).min(1),
  }),
  params: z.object({}),
  query: z.object({}),
});

function normalizePhone(phone) {
  return phone.replace(/\s+/g, "");
}

function validatePhone(phone) {
  return /^\+\d{8,15}$/.test(phone);
}

function pairSummarySql() {
  return `
    SELECT
      p.id,
      p.tournament_id,
      p.group_id,
      p.presente,
      p.presente_at,
      pl1.id AS player1_id,
      pl1.nombre AS player1_nombre,
      pl1.apellido AS player1_apellido,
      pl1.telefono AS player1_telefono,
      pl2.id AS player2_id,
      pl2.nombre AS player2_nombre,
      pl2.apellido AS player2_apellido,
      pl2.telefono AS player2_telefono
    FROM pairs p
    INNER JOIN pair_players pp1 ON pp1.pair_id = p.id AND pp1.player_num = 1
    INNER JOIN players pl1 ON pl1.id = pp1.player_id
    INNER JOIN pair_players pp2 ON pp2.pair_id = p.id AND pp2.player_num = 2
    INNER JOIN players pl2 ON pl2.id = pp2.player_id
  `;
}

function getFirstRoundMatches(tournamentId) {
  return db
    .prepare(
      `SELECT id FROM matches
       WHERE tournament_id = ? AND stage = 'eliminatoria'
       AND slot1_source_match_id IS NULL
       AND slot2_source_match_id IS NULL
       ORDER BY id ASC`
    )
    .all(tournamentId);
}

function buildProjectedQualifiedRows(tournamentId, tournament) {
  const groups = db
    .prepare(
      `SELECT id, name, size
       FROM groups
       WHERE tournament_id = ?
       ORDER BY name ASC`
    )
    .all(tournamentId);

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

  const positionedRows = db
    .prepare(
      `SELECT
        gs.pair_id,
        gs.points,
        gs.games_won,
        gs.games_lost,
        gs.position,
        g.id AS group_id,
        g.name AS group_name,
        g.size AS group_size
       FROM group_standings gs
       INNER JOIN groups g ON g.id = gs.group_id
       WHERE g.tournament_id = ?
         AND gs.position IS NOT NULL`
    )
    .all(tournamentId);

  const byGroupAndPosition = new Map(
    positionedRows.map((row) => [`${row.group_id}:${row.position}`, row])
  );

  const projected = [];
  groups.forEach((group) => {
    const cutoff = group.size === 3 ? tournament.clasifican_de_zona_3 : tournament.clasifican_de_zona_4;
    for (let position = 1; position <= cutoff; position += 1) {
      const key = `${group.id}:${position}`;
      const actual = byGroupAndPosition.get(key);
      projected.push({
        pair_id: actual?.pair_id ?? `placeholder-${group.id}-${position}`,
        points: actual?.points ?? 0,
        games_won: actual?.games_won ?? 0,
        games_lost: actual?.games_lost ?? 0,
        position,
        group_name: group.name,
        group_id: group.id,
        group_size: group.size,
        previous_opponents:
          actual?.pair_id != null ? [...(opponentsByPair.get(actual.pair_id) || new Set())] : [],
      });
    }
  });

  return projected;
}

function buildEliminationSlotLabels(tournamentId) {
  const tournament = db
    .prepare(
      `SELECT id, clasifican_de_zona_3, clasifican_de_zona_4
       FROM tournaments
       WHERE id = ?`
    )
    .get(tournamentId);
  if (!tournament) return new Map();

  const projectedRows = buildProjectedQualifiedRows(tournamentId, tournament);
  const rankedRows = rankQualified(projectedRows, tournament);
  
  // Aplicar optimización de brackets para evitar rematches inmediatos
  const { slots, byePositions } = buildSlots(rankedRows);
  
  // Mapear pair_id a placeholder
  const pairToPlaceholder = new Map(
    rankedRows.map((row) => [row.pair_id, `${row.position}° Zona ${row.group_name}`])
  );

  const firstRound = getFirstRoundMatches(tournamentId);
  const labelsByMatchId = new Map();
  firstRound.forEach((m, idx) => {
    const pos1 = idx * 2;
    const pos2 = idx * 2 + 1;
    labelsByMatchId.set(m.id, {
      pair1_placeholder: byePositions.has(pos1) ? "BYE" : (pairToPlaceholder.get(slots[pos1]) || "Por definir"),
      pair2_placeholder: byePositions.has(pos2) ? "BYE" : (pairToPlaceholder.get(slots[pos2]) || "Por definir"),
    });
  });

  return labelsByMatchId;
}

function getBracketSyncDiagnostics(tournamentId, sync) {
  const tournament = db
    .prepare(
      `SELECT id, clasifican_de_zona_3, clasifican_de_zona_4
       FROM tournaments
       WHERE id = ?`
    )
    .get(tournamentId);

  const pendingZoneMatches = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM matches
       WHERE tournament_id = ? AND stage = 'zona' AND winner_id IS NULL`
    )
    .get(tournamentId)?.total || 0;

  const zonesWithoutPositions = db
    .prepare(
      `SELECT g.name AS zone_name
       FROM groups g
       WHERE g.tournament_id = ?
         AND EXISTS (
           SELECT 1
           FROM group_standings gs
           WHERE gs.group_id = g.id AND gs.position IS NULL
         )
       ORDER BY g.name ASC`
    )
    .all(tournamentId)
    .map((row) => row.zone_name);

  const firstRoundSummary = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN is_bye = 0 AND (pair1_id IS NULL OR pair2_id IS NULL) THEN 1 ELSE 0 END) AS unresolved
       FROM matches
       WHERE tournament_id = ?
         AND stage = 'eliminatoria'
         AND slot1_source_match_id IS NULL
         AND slot2_source_match_id IS NULL`
    )
    .get(tournamentId) || { total: 0, unresolved: 0 };

  const expectedQualified = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN size = 3 THEN ? ELSE ? END), 0) AS total
       FROM groups
       WHERE tournament_id = ?`
    )
    .get(tournament?.clasifican_de_zona_3 || 0, tournament?.clasifican_de_zona_4 || 0, tournamentId)?.total || 0;

  const qualifiedRows = db
    .prepare(
      `SELECT gs.position, g.size AS group_size
       FROM group_standings gs
       INNER JOIN groups g ON g.id = gs.group_id
       WHERE g.tournament_id = ? AND gs.position IS NOT NULL`
    )
    .all(tournamentId)
    .filter((row) => {
      if (row.group_size === 3) return row.position <= (tournament?.clasifican_de_zona_3 || 0);
      return row.position <= (tournament?.clasifican_de_zona_4 || 0);
    });

  const reasons = [];
  if (sync?.blocked && sync?.message) reasons.push(sync.message);
  if (Array.isArray(sync?.seeding_warnings) && sync.seeding_warnings.length > 0) {
    sync.seeding_warnings.forEach((warning) => reasons.push(warning));
  }
  if (Array.isArray(sync?.tie_conflicts) && sync.tie_conflicts.length > 0) {
    sync.tie_conflicts.forEach((conflict) => {
      reasons.push(
        `Empate en Zona ${conflict.zone_name}: ${conflict.pair1_position}° (${conflict.pair1_label}) vs ${conflict.pair2_position}° (${conflict.pair2_label}) · PTS ${conflict.points} · DG ${conflict.dg}.`
      );
    });
  }
  if (pendingZoneMatches > 0) {
    reasons.push(`Hay ${pendingZoneMatches} partido(s) de zona sin resultado.`);
  }
  if (zonesWithoutPositions.length > 0) {
    reasons.push(`Hay zonas sin posiciones finales: ${zonesWithoutPositions.join(", ")}.`);
  }
  if (expectedQualified > 0 && qualifiedRows.length < expectedQualified) {
    reasons.push(`Hay ${qualifiedRows.length}/${expectedQualified} clasificados definidos para la llave.`);
  }
  if ((firstRoundSummary.unresolved || 0) > 0) {
    reasons.push(`Hay ${firstRoundSummary.unresolved} cruce(s) de primera ronda sin parejas definidas.`);
  }

  return {
    pending_zone_matches: pendingZoneMatches,
    zones_without_positions: zonesWithoutPositions,
    tie_conflicts: Array.isArray(sync?.tie_conflicts) ? sync.tie_conflicts : [],
    seeding_warnings: Array.isArray(sync?.seeding_warnings) ? sync.seeding_warnings : [],
    expected_qualified: expectedQualified,
    current_qualified: qualifiedRows.length,
    first_round_total: Number(firstRoundSummary.total || 0),
    first_round_unresolved: Number(firstRoundSummary.unresolved || 0),
    reasons,
  };
}

function computePairPaymentStates(tournamentId, pairIds) {
  const states = new Map();
  for (const pairId of pairIds) {
    const rows = db
      .prepare("SELECT estado FROM payments WHERE tournament_id = ? AND pair_id = ? ORDER BY player_num")
      .all(tournamentId, pairId);
    states.set(pairId, rows);
  }
  return states;
}

router.post("/", validate(createSchema), (req, res) => {
  const data = req.validated.body;

  const requestedType = (data.tipo_torneo || config.defaultTournamentType || "").toLowerCase();
  const selectedProfile = config.tournamentProfiles[requestedType];
  const selectedType = selectedProfile?.code;
  const selectedMatchFormat = selectedProfile?.matchFormat;

  if (!selectedType || !selectedMatchFormat) {
    return res.status(400).json({
      error: "Tipo de torneo no habilitado en esta instalacion",
      allowed: config.allowedTournamentTypes,
      default: config.defaultTournamentType,
    });
  }

  const globalCourts = db
    .prepare(
      `SELECT id, nombre, descripcion
       FROM global_courts
       WHERE activo = 1
         AND ${courtScopeFilter()}
         AND id IN (${data.global_court_ids.map(() => "?").join(",")})
       ORDER BY id ASC`
    )
    .all(...data.global_court_ids);
  if (globalCourts.length !== data.global_court_ids.length) {
    return res.status(400).json({ error: "Una o mas canchas globales no existen o estan inactivas" });
  }

  const paymentMethods = db
    .prepare(
      `SELECT id
       FROM payment_methods
       WHERE activo = 1
         AND id IN (${data.enabled_payment_method_ids.map(() => "?").join(",")})
       ORDER BY id ASC`
    )
    .all(...data.enabled_payment_method_ids);
  if (paymentMethods.length !== data.enabled_payment_method_ids.length) {
    return res.status(400).json({ error: "Uno o mas medios de pago no existen o estan inactivos" });
  }

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO tournaments
         (name, planned_pairs, tipo_torneo, match_format, clasifican_de_zona_3, clasifican_de_zona_4)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.name,
        0,
        selectedType,
        selectedMatchFormat,
        data.clasifican_de_zona_3,
        data.clasifican_de_zona_4
      );

    const tournamentId = result.lastInsertRowid;

    for (const court of globalCourts) {
      db.prepare("INSERT INTO courts (tournament_id, identificador, descripcion) VALUES (?, ?, ?)").run(
        tournamentId,
        court.nombre,
        court.descripcion || null
      );
    }

    for (const method of paymentMethods) {
      db.prepare(
        "INSERT INTO tournament_payment_methods (tournament_id, payment_method_id, enabled, sort_order) VALUES (?, ?, 1, ?)"
      ).run(tournamentId, method.id, method.id);
    }

    logAudit({
      actorUserId: req.user.id,
      action: "create",
      entity: "tournaments",
      entityId: tournamentId,
      after: {
        ...data,
        planned_pairs: 0,
        tipo_torneo: selectedType,
        match_format: selectedMatchFormat,
        play_mode: selectedProfile.playMode,
      },
    });

    return tournamentId;
  });

  const tournamentId = tx();
  res.status(201).json({ id: tournamentId });
});

router.get("/opciones-creacion", (req, res) => {
  const paymentMethods = db
    .prepare(
      `SELECT id, nombre, descripcion, activo
       FROM payment_methods
       WHERE activo = 1
       ORDER BY id ASC`
    )
    .all();

  const globalCourts = db
    .prepare(
      `SELECT gc.id, gc.nombre, gc.descripcion, gc.club_id, gcl.nombre AS club_nombre, gc.activo,
              CASE WHEN gc.club_id IS NULL THEN 'local' ELSE 'club' END AS scope_type
       FROM global_courts gc
       LEFT JOIN global_clubs gcl ON gcl.id = gc.club_id
       WHERE gc.activo = 1
         AND ${courtScopeFilter("gc")}
       ORDER BY gc.id ASC`
    )
    .all();

  const tournamentTypes = Object.values(config.tournamentProfiles).map((profile) => ({
    code: profile.code,
    label: profile.label,
    description: profile.description,
    match_format: profile.matchFormat,
    play_mode: profile.playMode,
  }));

  res.json({
    default_tournament_type: config.defaultTournamentType,
    min_pairs: config.minTournamentPairs,
    max_pairs: config.maxTournamentPairs,
    tournament_types: tournamentTypes,
    global_courts: globalCourts,
    payment_methods: paymentMethods,
  });
});

router.get("/", (req, res) => {
  // Superadmin ve todos, otros solo ven activos
  const isSuperAdmin = req.user?.role === "superadmin";
  
  let sql = "SELECT * FROM tournaments";
  
  if (!isSuperAdmin) {
    sql += " WHERE status = 'activo'";
  }
  
  sql += " ORDER BY id DESC";
  
  const rows = db.prepare(sql).all();
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const tournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id);
  if (!tournament) return res.status(404).json({ error: "Torneo no encontrado" });
  res.json(tournament);
});

router.get("/:id/medios-pago", (req, res) => {
  const id = Number(req.params.id);
  const enabledOnly = String(req.query.enabledOnly || "") === "1";
  const tournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id);
  if (!tournament) return res.status(404).json({ error: "Torneo no encontrado" });

  const rows = db
    .prepare(
      `SELECT
        pm.id,
        pm.nombre,
        pm.descripcion,
        pm.activo,
        COALESCE(tpm.enabled, 0) AS enabled,
        COALESCE(tpm.sort_order, pm.id) AS sort_order
       FROM payment_methods pm
       LEFT JOIN tournament_payment_methods tpm
         ON tpm.payment_method_id = pm.id
        AND tpm.tournament_id = ?
       ORDER BY COALESCE(tpm.sort_order, pm.id) ASC, pm.id ASC`
    )
    .all(id);

  const data = enabledOnly ? rows.filter((r) => Number(r.activo) === 1 && Number(r.enabled) === 1) : rows;
  res.json(data);
});

router.put("/:id/medios-pago", (req, res) => {
  const id = Number(req.params.id);
  const enabledIds = Array.isArray(req.body?.enabled_ids)
    ? [...new Set(req.body.enabled_ids.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))]
    : null;

  if (!enabledIds) {
    return res.status(400).json({ error: "enabled_ids debe ser un array" });
  }

  const before = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id);
  if (!before) return res.status(404).json({ error: "Torneo no encontrado" });

  const valid = db
    .prepare(
      `SELECT id
       FROM payment_methods
       WHERE id IN (${enabledIds.length ? enabledIds.map(() => "?").join(",") : "NULL"})`
    )
    .all(...enabledIds)
    .map((r) => r.id);

  if (valid.length !== enabledIds.length) {
    return res.status(400).json({ error: "Uno o mas medios de pago no existen" });
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM tournament_payment_methods WHERE tournament_id = ?").run(id);
    enabledIds.forEach((methodId, idx) => {
      db.prepare(
        "INSERT INTO tournament_payment_methods (tournament_id, payment_method_id, enabled, sort_order) VALUES (?, ?, 1, ?)"
      ).run(id, methodId, idx + 1);
    });
  });

  tx();
  logAudit({
    actorUserId: req.user.id,
    action: "update",
    entity: "tournament_payment_methods",
    entityId: id,
    before: { tournamentId: id },
    after: { enabledIds },
  });

  res.json({ ok: true });
});

router.put("/:id/finalizar", (req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id);
  if (!before) return res.status(404).json({ error: "Torneo no encontrado" });

  const final = db
    .prepare("SELECT winner_id FROM matches WHERE tournament_id = ? AND stage = 'eliminatoria' AND round = 'final' LIMIT 1")
    .get(id);
  if (!final || !final.winner_id) {
    return res.status(400).json({ error: "No se puede finalizar sin resultado de final" });
  }

  db.prepare("UPDATE tournaments SET status = 'finalizado' WHERE id = ?").run(id);

  logAudit({
    actorUserId: req.user.id,
    action: "finalize",
    entity: "tournaments",
    entityId: id,
    before,
    after: { status: "finalizado" },
  });

  res.json({ ok: true });
});

router.put("/:id/iniciar", (req, res) => {
  const id = Number(req.params.id);
  const force = Boolean(req.body?.force);
  const before = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id);
  if (!before) return res.status(404).json({ error: "Torneo no encontrado" });
  if (before.zonas_generadas) {
    return res.status(400).json({ error: "El torneo ya fue iniciado" });
  }

  const pairCount = db.prepare("SELECT COUNT(*) AS total FROM pairs WHERE tournament_id = ?").get(id).total;
  if (pairCount < config.minTournamentPairs) {
    return res.status(400).json({
      error: `Debes cargar al menos ${config.minTournamentPairs} parejas para iniciar (actual: ${pairCount})`,
      code: "MISSING_PAIRS",
    });
  }

  if (pairCount > config.maxTournamentPairs) {
    return res.status(400).json({
      error: `Se excedio el maximo permitido (${config.maxTournamentPairs}) para iniciar (actual: ${pairCount})`,
      code: "MAX_PAIRS_EXCEEDED",
    });
  }

  try {
    getZonesCount(pairCount);
  } catch (err) {
    return res.status(400).json({
      error: `La cantidad actual (${pairCount}) todavia no esta soportada para generar zonas/eliminatorias`,
      code: "UNSUPPORTED_PAIR_COUNT",
    });
  }

  const ausentes = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM pairs
       WHERE tournament_id = ? AND COALESCE(presente, 0) <> 1`
    )
    .get(id).total;

  const conSaldo = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT pair_id
         FROM payments
         WHERE tournament_id = ?
         GROUP BY pair_id
         HAVING SUM(CASE WHEN estado = 'pagado' THEN 1 ELSE 0 END) < 2
       ) x`
    )
    .get(id).total;

  if (!force && (ausentes > 0 || conSaldo > 0)) {
    return res.json({
      ok: false,
      error: "Hay parejas ausentes o con saldo pendiente",
      requires_confirmation: true,
      warnings: { ausentes, conSaldo },
      message:
        "No todas las parejas estan presentes o con pagos saldados. Si continuas, igual se iniciara el torneo.",
    });
  }

  try {
    const startTx = db.transaction(() => {
      db.prepare("UPDATE tournaments SET planned_pairs = ? WHERE id = ?").run(pairCount, id);
      db.prepare("DELETE FROM matches WHERE tournament_id = ? AND stage = 'eliminatoria'").run(id);
      db.prepare("DELETE FROM groups WHERE tournament_id = ?").run(id);
      db.prepare("UPDATE pairs SET group_id = NULL WHERE tournament_id = ?").run(id);

      const updatedTournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id);
      createGroups(updatedTournament);
      createBracketTree(updatedTournament);
    });

    startTx();
    assignPairsAndGenerateZones(id);
    logAudit({
      actorUserId: req.user.id,
      action: "start",
      entity: "tournaments",
      entityId: id,
      before,
      after: { zonas_generadas: 1, planned_pairs: pairCount },
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err.message || "No se pudo iniciar torneo" });
  }
});

router.post(
  "/:id/parejas",
  validate(
    z.object({
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({}),
      body: z.object({
        player1: z.object({ nombre: z.string().min(1), apellido: z.string().min(1), telefono: z.string().min(8) }),
        player2: z.object({ nombre: z.string().min(1), apellido: z.string().min(1), telefono: z.string().min(8) }),
      }),
    })
  ),
  (req, res) => {
    const tournamentId = req.validated.params.id;
    const tournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(tournamentId);
    if (!tournament) return res.status(404).json({ error: "Torneo no encontrado" });
    if (tournament.zonas_generadas) {
      return res.status(400).json({ error: "No se pueden agregar parejas luego de generar zonas" });
    }

    const p1 = { ...req.validated.body.player1, telefono: normalizePhone(req.validated.body.player1.telefono) };
    const p2 = { ...req.validated.body.player2, telefono: normalizePhone(req.validated.body.player2.telefono) };

    if (!validatePhone(p1.telefono) || !validatePhone(p2.telefono)) {
      return res.status(400).json({ error: "Telefono invalido. Formato esperado: +5491122334455" });
    }

    if (
      p1.nombre.toLowerCase() === p2.nombre.toLowerCase() &&
      p1.apellido.toLowerCase() === p2.apellido.toLowerCase() &&
      p1.telefono === p2.telefono
    ) {
      return res.status(400).json({ error: "Una pareja no puede repetir el mismo jugador" });
    }

    const tx = db.transaction(() => {
      const pairCount = db
        .prepare("SELECT COUNT(*) as total FROM pairs WHERE tournament_id = ?")
        .get(tournamentId).total;
      if (pairCount >= config.maxTournamentPairs) {
        throw new Error(`Se alcanzo el limite de parejas permitido (${config.maxTournamentPairs})`);
      }

      function upsertPlayer(player) {
        const found = db
          .prepare("SELECT * FROM players WHERE nombre = ? AND apellido = ? AND telefono = ?")
          .get(player.nombre, player.apellido, player.telefono);
        if (found) return found.id;
        return db
          .prepare("INSERT INTO players (nombre, apellido, telefono) VALUES (?, ?, ?)")
          .run(player.nombre, player.apellido, player.telefono).lastInsertRowid;
      }

      const player1Id = upsertPlayer(p1);
      const player2Id = upsertPlayer(p2);

      const existingInTournament = db
        .prepare(
          `SELECT 1
           FROM pairs p
           INNER JOIN pair_players pp ON pp.pair_id = p.id
           WHERE p.tournament_id = ? AND pp.player_id IN (?, ?)
           LIMIT 1`
        )
        .get(tournamentId, player1Id, player2Id);
      if (existingInTournament) {
        throw new Error("Los jugadores deben ser unicos dentro del torneo");
      }

      const pairId = db.prepare("INSERT INTO pairs (tournament_id) VALUES (?)").run(tournamentId).lastInsertRowid;
      db.prepare("INSERT INTO pair_players (pair_id, player_id, player_num) VALUES (?, ?, 1)").run(
        pairId,
        player1Id
      );
      db.prepare("INSERT INTO pair_players (pair_id, player_id, player_num) VALUES (?, ?, 2)").run(
        pairId,
        player2Id
      );

      db.prepare(
        "INSERT INTO payments (tournament_id, pair_id, player_num, estado) VALUES (?, ?, 1, 'sin_pago')"
      ).run(tournamentId, pairId);
      db.prepare(
        "INSERT INTO payments (tournament_id, pair_id, player_num, estado) VALUES (?, ?, 2, 'sin_pago')"
      ).run(tournamentId, pairId);

      logAudit({
        actorUserId: req.user.id,
        action: "create",
        entity: "pairs",
        entityId: pairId,
        after: { tournamentId, p1, p2 },
      });
      return pairId;
    });

    try {
      const pairId = tx();
      res.status(201).json({ id: pairId });
    } catch (err) {
      res.status(400).json({ error: err.message || "No se pudo crear la pareja" });
    }
  }
);

router.get("/:id/parejas", (req, res) => {
  const tournamentId = Number(req.params.id);
  const rows = db.prepare(`${pairSummarySql()} WHERE p.tournament_id = ? ORDER BY p.id ASC`).all(tournamentId);
  const states = computePairPaymentStates(
    tournamentId,
    rows.map((r) => r.id)
  );

  const data = rows.map((r) => {
    const payments = states.get(r.id) || [];
    const warningPago = payments.some((p) => p.estado !== "pagado");
    return { ...r, warning_pago: warningPago };
  });

  res.json(data);
});

router.put("/:id/parejas/:pairId", (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);
  const tournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(tournamentId);
  if (!tournament) return res.status(404).json({ error: "Torneo no encontrado" });
  if (tournament.zonas_generadas) {
    return res.status(400).json({ error: "No se pueden editar parejas luego de generar zonas" });
  }

  const { player1, player2 } = req.body || {};
  if (!player1 || !player2) {
    return res.status(400).json({ error: "player1 y player2 son requeridos" });
  }

  const p1 = { ...player1, telefono: normalizePhone(player1.telefono || "") };
  const p2 = { ...player2, telefono: normalizePhone(player2.telefono || "") };
  if (!validatePhone(p1.telefono) || !validatePhone(p2.telefono)) {
    return res.status(400).json({ error: "Telefono invalido. Formato esperado: +5491122334455" });
  }

  const pair = db.prepare("SELECT * FROM pairs WHERE id = ? AND tournament_id = ?").get(pairId, tournamentId);
  if (!pair) return res.status(404).json({ error: "Pareja no encontrada" });

  const tx = db.transaction(() => {
    function upsertPlayer(player) {
      const found = db
        .prepare("SELECT * FROM players WHERE nombre = ? AND apellido = ? AND telefono = ?")
        .get(player.nombre, player.apellido, player.telefono);
      if (found) return found.id;
      return db
        .prepare("INSERT INTO players (nombre, apellido, telefono) VALUES (?, ?, ?)")
        .run(player.nombre, player.apellido, player.telefono).lastInsertRowid;
    }

    const player1Id = upsertPlayer(p1);
    const player2Id = upsertPlayer(p2);

    const existingInTournament = db
      .prepare(
        `SELECT 1
         FROM pairs p
         INNER JOIN pair_players pp ON pp.pair_id = p.id
         WHERE p.tournament_id = ? AND p.id <> ? AND pp.player_id IN (?, ?)
         LIMIT 1`
      )
      .get(tournamentId, pairId, player1Id, player2Id);
    if (existingInTournament) {
      throw new Error("Los jugadores deben ser unicos dentro del torneo");
    }

    db.prepare("UPDATE pair_players SET player_id = ? WHERE pair_id = ? AND player_num = 1").run(
      player1Id,
      pairId
    );
    db.prepare("UPDATE pair_players SET player_id = ? WHERE pair_id = ? AND player_num = 2").run(
      player2Id,
      pairId
    );

    logAudit({
      actorUserId: req.user.id,
      action: "update",
      entity: "pairs",
      entityId: pairId,
      after: { player1: p1, player2: p2 },
    });
  });

  try {
    tx();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "No se pudo editar la pareja" });
  }
});

router.delete("/:id/parejas/:pairId", (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);
  const tournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(tournamentId);
  if (!tournament) return res.status(404).json({ error: "Torneo no encontrado" });
  if (tournament.zonas_generadas) {
    return res.status(400).json({ error: "No se pueden eliminar parejas luego de generar zonas" });
  }

  const before = db.prepare("SELECT id FROM pairs WHERE id = ? AND tournament_id = ?").get(pairId, tournamentId);
  if (!before) return res.status(404).json({ error: "Pareja no encontrada" });

  db.prepare("DELETE FROM pairs WHERE id = ? AND tournament_id = ?").run(pairId, tournamentId);
  logAudit({
    actorUserId: req.user.id,
    action: "delete",
    entity: "pairs",
    entityId: pairId,
    before,
  });
  res.json({ ok: true });
});

router.put("/:id/parejas/:pairId/presente", (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);

  const playing = db
    .prepare(
      `SELECT id FROM matches
       WHERE tournament_id = ? AND (pair1_id = ? OR pair2_id = ?)
       AND started_at IS NOT NULL AND finished_at IS NULL
       LIMIT 1`
    )
    .get(tournamentId, pairId, pairId);

  if (playing) {
    return res.status(400).json({ error: "No se puede cambiar el estado de una pareja en juego" });
  }

  db.prepare("UPDATE pairs SET presente = 1, presente_at = CURRENT_TIMESTAMP WHERE id = ? AND tournament_id = ?").run(
    pairId,
    tournamentId
  );

  res.json({ ok: true });
});

router.put("/:id/parejas/:pairId/ausente", (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);

  const playing = db
    .prepare(
      `SELECT id FROM matches
       WHERE tournament_id = ? AND (pair1_id = ? OR pair2_id = ?)
       AND started_at IS NOT NULL AND finished_at IS NULL
       LIMIT 1`
    )
    .get(tournamentId, pairId, pairId);
  if (playing) {
    return res.status(400).json({ error: "No se puede cambiar el estado de una pareja en juego" });
  }

  const woSets = buildWOSets();

  const tx = db.transaction(() => {
    db.prepare("UPDATE pairs SET presente = 0, presente_at = CURRENT_TIMESTAMP WHERE id = ? AND tournament_id = ?").run(
      pairId,
      tournamentId
    );

    const pendingMatches = db
      .prepare(
        `SELECT * FROM matches
         WHERE tournament_id = ?
         AND (pair1_id = ? OR pair2_id = ?)
         AND winner_id IS NULL
         AND (started_at IS NULL OR finished_at IS NULL)`
      )
      .all(tournamentId, pairId, pairId);

    for (const match of pendingMatches) {
      const winnerId = match.pair1_id === pairId ? match.pair2_id : match.pair1_id;
      if (!winnerId) continue;
      if (match.started_at && !match.finished_at) continue;

      const p1won = match.pair1_id === winnerId;
      db.prepare(
        `UPDATE matches SET
          set1_pair1 = ?, set1_pair2 = ?,
          set2_pair1 = NULL, set2_pair2 = NULL,
          supertb_pair1 = NULL, supertb_pair2 = NULL,
          winner_id = ?, is_wo = 1, finished_at = CURRENT_TIMESTAMP, played_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        p1won ? woSets.set1_pair1 : woSets.set1_pair2,
        p1won ? woSets.set1_pair2 : woSets.set1_pair1,
        winnerId,
        match.id
      );

      if (match.group_id) {
        recalcGroupStandings(match.group_id);
      }
    }
  });

  tx();
  res.json({ ok: true });
});

router.get("/:id/pagos", (req, res) => {
  const tournamentId = Number(req.params.id);
  const rows = db
    .prepare(
      `SELECT p.*, t.id as tx_id, t.payment_method_id, t.monto, t.created_at as tx_created_at
       FROM payments p
       LEFT JOIN payment_transactions t ON t.payment_id = p.id
       WHERE p.tournament_id = ?
       ORDER BY p.pair_id, p.player_num, t.id`
    )
    .all(tournamentId);

  res.json(rows);
});

router.post("/:id/pagos/:pairId/jugador/:playerNum/transaccion", (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);
  const playerNum = Number(req.params.playerNum);
  const { payment_method_id, monto } = req.body;

  const payment = db
    .prepare("SELECT * FROM payments WHERE tournament_id = ? AND pair_id = ? AND player_num = ?")
    .get(tournamentId, pairId, playerNum);
  if (!payment) return res.status(404).json({ error: "Pago no encontrado" });

  db.prepare(
    "INSERT INTO payment_transactions (payment_id, payment_method_id, monto) VALUES (?, ?, ?)"
  ).run(payment.id, Number(payment_method_id), Number(monto));

  const sum = db
    .prepare("SELECT COALESCE(SUM(monto), 0) as total FROM payment_transactions WHERE payment_id = ?")
    .get(payment.id).total;

  const estado = normalizeEstadoForTransactions(sum);
  db.prepare("UPDATE payments SET estado = ? WHERE id = ?").run(estado, payment.id);
  res.status(201).json({ ok: true });
});

router.put("/:id/pagos/:pairId/jugador/:playerNum/estado", (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);
  const playerNum = Number(req.params.playerNum);
  const { estado } = req.body;

  if (!["sin_pago", "parcial", "pagado"].includes(estado)) {
    return res.status(400).json({ error: "Estado invalido" });
  }

  db.prepare("UPDATE payments SET estado = ? WHERE tournament_id = ? AND pair_id = ? AND player_num = ?").run(
    estado,
    tournamentId,
    pairId,
    playerNum
  );

  res.json({ ok: true });
});

router.put("/:id/pagos/transacciones/:txId", (req, res) => {
  const tournamentId = Number(req.params.id);
  const txId = Number(req.params.txId);
  const { monto } = req.body;

  const txRow = db
    .prepare(
      `SELECT t.*, p.id AS payment_id
       FROM payment_transactions t
       INNER JOIN payments p ON p.id = t.payment_id
       WHERE t.id = ? AND p.tournament_id = ?`
    )
    .get(txId, tournamentId);
  if (!txRow) return res.status(404).json({ error: "Transaccion no encontrada" });

  db.prepare("UPDATE payment_transactions SET monto = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    Number(monto),
    txId
  );

  const sum = db
    .prepare("SELECT COALESCE(SUM(monto), 0) AS total FROM payment_transactions WHERE payment_id = ?")
    .get(txRow.payment_id).total;
  const estado = normalizeEstadoForTransactions(sum);
  db.prepare("UPDATE payments SET estado = ? WHERE id = ?").run(estado, txRow.payment_id);

  res.json({ ok: true });
});

router.get("/:id/zonas", (req, res) => {
  const tournamentId = Number(req.params.id);
  const groups = db
    .prepare("SELECT * FROM groups WHERE tournament_id = ? ORDER BY name ASC")
    .all(tournamentId);

  const result = groups.map((group) => {
    const matches = db
      .prepare(
        `SELECT m.*,
          (SELECT cq.court_id FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_court_id,
          (SELECT cq.orden FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_orden
         FROM matches m
         WHERE m.group_id = ?
         ORDER BY m.id ASC`
      )
      .all(group.id);
    const calc = recalcGroupStandings(group.id);
    return {
      group,
      matches,
      standings: calc.standings,
      has_tie_warning: calc.ties.length > 0,
    };
  });

  res.json(result);
});

router.put("/:id/zonas/:zonaId/posiciones", (req, res) => {
  const zonaId = Number(req.params.zonaId);
  const positions = req.body.positions || req.body.ordered_pair_ids;
  if (!Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: "positions es requerido" });
  }

  const tx = db.transaction(() => {
    positions.forEach((pairId, idx) => {
      db.prepare(
        "UPDATE group_standings SET position = ?, position_override = 1 WHERE group_id = ? AND pair_id = ?"
      ).run(idx + 1, zonaId, pairId);
    });
  });
  tx();

  const tournamentId = Number(req.params.id);
  const sync = syncBracketFirstRound(tournamentId);
  if (sync && sync.blocked) {
    return res.status(409).json(sync);
  }

  res.json({ ok: true });
});

router.put("/:id/zonas/cerrar", (req, res) => {
  const tournamentId = Number(req.params.id);
  const orderedByZone = req.body?.ordered_by_zone || {};

  const tournament = db.prepare("SELECT id FROM tournaments WHERE id = ?").get(tournamentId);
  if (!tournament) return res.status(404).json({ error: "Torneo no encontrado" });

  const groups = db
    .prepare("SELECT id, name FROM groups WHERE tournament_id = ? ORDER BY name ASC")
    .all(tournamentId);

  try {
    const tx = db.transaction(() => {
      groups.forEach((group) => {
        recalcGroupStandings(group.id);

        const groupPairIds = db
          .prepare("SELECT pair_id FROM group_standings WHERE group_id = ?")
          .all(group.id)
          .map((row) => Number(row.pair_id));

        const providedOrder = orderedByZone[group.id] || orderedByZone[String(group.id)];
        const fallbackOrder = db
          .prepare(
            `SELECT pair_id
             FROM group_standings
             WHERE group_id = ?
             ORDER BY CASE WHEN position IS NULL THEN 999 ELSE position END ASC, id ASC`
          )
          .all(group.id)
          .map((row) => Number(row.pair_id));

        const nextOrder = Array.isArray(providedOrder) && providedOrder.length
          ? providedOrder.map((value) => Number(value)).filter((value) => Number.isFinite(value))
          : fallbackOrder;

        const unique = new Set(nextOrder);
        const hasSameMembers = groupPairIds.every((pairId) => unique.has(pairId));
        if (!hasSameMembers || unique.size !== groupPairIds.length) {
          throw new Error(`El orden recibido para Zona ${group.name} es invalido`);
        }

        nextOrder.forEach((pairId, idx) => {
          db.prepare(
            "UPDATE group_standings SET position = ?, position_override = 1 WHERE group_id = ? AND pair_id = ?"
          ).run(idx + 1, group.id, pairId);
        });
      });
    });

    tx();
  } catch (err) {
    return res.status(400).json({ error: err.message || "No se pudieron cerrar las zonas" });
  }

  const sync = syncBracketFirstRound(tournamentId);
  if (sync && sync.blocked) {
    return res.status(409).json(sync);
  }

  return res.json({ ok: true });
});

router.get("/:id/cuadro", (req, res) => {
  const tournamentId = Number(req.params.id);
  const sync = syncBracketFirstRound(tournamentId);
  const slotLabels = buildEliminationSlotLabels(tournamentId);
  const diagnostics = getBracketSyncDiagnostics(tournamentId, sync);

  const rows = db
    .prepare(
      `SELECT m.*,
        (SELECT cq.court_id FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_court_id,
        (SELECT cq.orden FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_orden
       FROM matches m
       WHERE m.tournament_id = ? AND m.stage = 'eliminatoria'
       ORDER BY m.id ASC`
    )
    .all(tournamentId);

  const matches = rows.map((row) => ({
    ...row,
    ...(slotLabels.get(row.id) || {}),
  }));

  res.json({
    blocked: sync?.blocked || false,
    message: sync?.message || null,
    matches,
    diagnostics,
  });
});

router.post("/:id/canchas", (req, res) => {
  const tournamentId = Number(req.params.id);
  const nombre = String(req.body?.nombre || req.body?.identificador || "").trim();
  const descripcion = String(req.body?.descripcion || "").trim();
  if (!nombre) {
    return res.status(400).json({ error: "Nombre de cancha requerido" });
  }
  const result = db
    .prepare("INSERT INTO courts (tournament_id, identificador, descripcion) VALUES (?, ?, ?)")
    .run(tournamentId, nombre, descripcion || null);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.get("/:id/canchas", (req, res) => {
  const tournamentId = Number(req.params.id);
  const rows = db
    .prepare(
      `SELECT
        id,
        tournament_id,
        identificador,
        COALESCE(descripcion, '') AS descripcion,
        created_at
       FROM courts
       WHERE tournament_id = ?
       ORDER BY id ASC`
    )
    .all(tournamentId);
  res.json(
    rows.map((r) => ({
      ...r,
      nombre: r.identificador,
    }))
  );
});

router.put("/:id/canchas/:canchaId", (req, res) => {
  const tournamentId = Number(req.params.id);
  const canchaId = Number(req.params.canchaId);
  const nombre = String(req.body?.nombre || req.body?.identificador || "").trim();
  const descripcion = String(req.body?.descripcion || "").trim();

  if (!nombre) {
    return res.status(400).json({ error: "Nombre de cancha requerido" });
  }

  const result = db
    .prepare(
      `UPDATE courts
       SET identificador = ?, descripcion = ?
       WHERE id = ? AND tournament_id = ?`
    )
    .run(nombre, descripcion || null, canchaId, tournamentId);

  if (!result.changes) {
    return res.status(404).json({ error: "Cancha no encontrada" });
  }

  res.json({ ok: true });
});

router.delete("/:id/canchas/:canchaId", (req, res) => {
  res.status(400).json({ error: "No se permite eliminar canchas una vez creado el torneo" });
});

router.get("/:id/canchas/estado", (req, res) => {
  const tournamentId = Number(req.params.id);
  const courts = db.prepare("SELECT * FROM courts WHERE tournament_id = ? ORDER BY id ASC").all(tournamentId);

  const data = courts.map((court) => {
    const playing = db
      .prepare(
        `SELECT * FROM matches
         WHERE court_id = ? AND tournament_id = ? AND started_at IS NOT NULL AND finished_at IS NULL
         LIMIT 1`
      )
      .get(court.id, tournamentId);

    const queue = db
      .prepare(
        `SELECT cq.*, m.stage, m.round, m.pair1_id, m.pair2_id
         FROM court_queue cq
         INNER JOIN matches m ON m.id = cq.match_id
         WHERE cq.court_id = ? AND m.tournament_id = ?
         ORDER BY cq.orden ASC`
      )
      .all(court.id, tournamentId);

    return {
      court,
      estado: playing ? "ocupada" : queue.length ? "cola" : "libre",
      playing,
      queue,
    };
  });

  res.json(data);
});

router.get("/:id/partidos/pendientes", (req, res) => {
  const tournamentId = Number(req.params.id);
  const pending = db
    .prepare(
      `SELECT m.*,
        (SELECT cq.court_id FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_court_id,
        (SELECT cq.orden FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_orden
       FROM matches m
       WHERE m.tournament_id = ? AND m.winner_id IS NULL
       ORDER BY m.id ASC`
    )
    .all(tournamentId);

  const sinCancha = pending.filter((m) => !m.queue_court_id && !m.court_id);
  const conCancha = pending.filter((m) => m.queue_court_id && !m.started_at);

  res.json({ sinCancha, conCancha });
});

router.get("/:id/partidos", (req, res) => {
  const tournamentId = Number(req.params.id);
  const rows = db
    .prepare(
      `SELECT m.*,
        (SELECT cq.court_id FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_court_id,
        (SELECT cq.orden FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_orden
       FROM matches m
       WHERE tournament_id = ?
       ORDER BY stage ASC, id ASC`
    )
    .all(tournamentId);
  res.json(rows);
});

router.post("/canchas/:canchaId/cola", (req, res) => {
  const canchaId = Number(req.params.canchaId);
  const { match_id } = req.body;
  try {
    queueMatch(canchaId, Number(match_id));
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/canchas/:canchaId/cola/:matchId", (req, res) => {
  const canchaId = Number(req.params.canchaId);
  const matchId = Number(req.params.matchId);
  removeFromQueue(canchaId, matchId);
  res.json({ ok: true });
});

router.put("/canchas/:canchaId/cola/orden", (req, res) => {
  const canchaId = Number(req.params.canchaId);
  const { match_ids } = req.body;
  reorderQueue(canchaId, match_ids || []);
  res.json({ ok: true });
});

module.exports = router;
