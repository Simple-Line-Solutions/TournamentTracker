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

async function getFirstRoundMatches(tournamentId) {
  const result = await db.query(
    `SELECT id FROM matches
     WHERE tournament_id = $1 AND stage = 'eliminatoria'
     AND slot1_source_match_id IS NULL
     AND slot2_source_match_id IS NULL
     ORDER BY id ASC`,
    [tournamentId]
  );
  return result.rows;
}

async function buildProjectedQualifiedRows(tournamentId, tournament) {
  const groups = (await db.query(
    `SELECT id, name, size
     FROM groups
     WHERE tournament_id = $1
     ORDER BY name ASC`,
    [tournamentId]
  )).rows;

  const zoneMatches = (await db.query(
    `SELECT pair1_id, pair2_id
     FROM matches
     WHERE tournament_id = $1
       AND stage = 'zona'
       AND winner_id IS NOT NULL
       AND pair1_id IS NOT NULL
       AND pair2_id IS NOT NULL`,
    [tournamentId]
  )).rows;

  const opponentsByPair = new Map();
  zoneMatches.forEach((m) => {
    if (!opponentsByPair.has(m.pair1_id)) opponentsByPair.set(m.pair1_id, new Set());
    if (!opponentsByPair.has(m.pair2_id)) opponentsByPair.set(m.pair2_id, new Set());
    opponentsByPair.get(m.pair1_id).add(m.pair2_id);
    opponentsByPair.get(m.pair2_id).add(m.pair1_id);
  });

  const positionedRows = (await db.query(
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
     WHERE g.tournament_id = $1
       AND gs.position IS NOT NULL`,
    [tournamentId]
  )).rows;

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

async function buildEliminationSlotLabels(tournamentId) {
  const tournament = (await db.query(
    `SELECT id, clasifican_de_zona_3, clasifican_de_zona_4
     FROM tournaments
     WHERE id = $1`,
    [tournamentId]
  )).rows[0];
  if (!tournament) return new Map();

  const projectedRows = await buildProjectedQualifiedRows(tournamentId, tournament);
  const rankedRows = rankQualified(projectedRows, tournament);

  // Aplicar optimización de brackets para evitar rematches inmediatos
  const { slots, byePositions } = buildSlots(rankedRows);

  // Mapear pair_id a placeholder
  const pairToPlaceholder = new Map(
    rankedRows.map((row) => [row.pair_id, `${row.position}° Zona ${row.group_name}`])
  );

  const firstRound = await getFirstRoundMatches(tournamentId);
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

async function getBracketSyncDiagnostics(tournamentId, sync) {
  const tournament = (await db.query(
    `SELECT id, clasifican_de_zona_3, clasifican_de_zona_4
     FROM tournaments
     WHERE id = $1`,
    [tournamentId]
  )).rows[0];

  const pendingZoneRes = await db.query(
    `SELECT COUNT(*) AS total
     FROM matches
     WHERE tournament_id = $1 AND stage = 'zona' AND winner_id IS NULL`,
    [tournamentId]
  );
  const pendingZoneMatches = parseInt(pendingZoneRes.rows[0]?.total || 0);

  const zonesWithoutPositions = (await db.query(
    `SELECT g.name AS zone_name
     FROM groups g
     WHERE g.tournament_id = $1
       AND EXISTS (
         SELECT 1
         FROM group_standings gs
         WHERE gs.group_id = g.id AND gs.position IS NULL
       )
     ORDER BY g.name ASC`,
    [tournamentId]
  )).rows.map((row) => row.zone_name);

  const firstRoundSummaryRes = await db.query(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN is_bye = false AND (pair1_id IS NULL OR pair2_id IS NULL) THEN 1 ELSE 0 END) AS unresolved
     FROM matches
     WHERE tournament_id = $1
       AND stage = 'eliminatoria'
       AND slot1_source_match_id IS NULL
       AND slot2_source_match_id IS NULL`,
    [tournamentId]
  );
  const firstRoundSummary = firstRoundSummaryRes.rows[0] || { total: 0, unresolved: 0 };

  const expectedQualifiedRes = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN size = 3 THEN $1 ELSE $2 END), 0) AS total
     FROM groups
     WHERE tournament_id = $3`,
    [tournament?.clasifican_de_zona_3 || 0, tournament?.clasifican_de_zona_4 || 0, tournamentId]
  );
  const expectedQualified = parseInt(expectedQualifiedRes.rows[0]?.total || 0);

  const qualifiedRowsAll = (await db.query(
    `SELECT gs.position, g.size AS group_size
     FROM group_standings gs
     INNER JOIN groups g ON g.id = gs.group_id
     WHERE g.tournament_id = $1 AND gs.position IS NOT NULL`,
    [tournamentId]
  )).rows;

  const qualifiedRows = qualifiedRowsAll.filter((row) => {
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

async function computePairPaymentStates(tournamentId, pairIds) {
  const states = new Map();
  for (const pairId of pairIds) {
    const rows = (await db.query(
      "SELECT estado FROM payments WHERE tournament_id = $1 AND pair_id = $2 ORDER BY player_num",
      [tournamentId, pairId]
    )).rows;
    states.set(pairId, rows);
  }
  return states;
}

router.post("/", validate(createSchema), async (req, res) => {
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

  const courtPlaceholders = data.global_court_ids.map((_, i) => `$${i + 1}`).join(",");
  const globalCourts = (await db.query(
    `SELECT id, nombre, descripcion
     FROM global_courts
     WHERE activo = true
       AND ${courtScopeFilter()}
       AND id IN (${courtPlaceholders})
     ORDER BY id ASC`,
    data.global_court_ids
  )).rows;
  if (globalCourts.length !== data.global_court_ids.length) {
    return res.status(400).json({ error: "Una o mas canchas globales no existen o estan inactivas" });
  }

  const pmPlaceholders = data.enabled_payment_method_ids.map((_, i) => `$${i + 1}`).join(",");
  const paymentMethods = (await db.query(
    `SELECT id
     FROM payment_methods
     WHERE activo = true
       AND id IN (${pmPlaceholders})
     ORDER BY id ASC`,
    data.enabled_payment_method_ids
  )).rows;
  if (paymentMethods.length !== data.enabled_payment_method_ids.length) {
    return res.status(400).json({ error: "Uno o mas medios de pago no existen o estan inactivos" });
  }

  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const tournamentRes = await client.query(
      `INSERT INTO tournaments
       (name, planned_pairs, tipo_torneo, match_format, clasifican_de_zona_3, clasifican_de_zona_4)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [data.name, 0, selectedType, selectedMatchFormat, data.clasifican_de_zona_3, data.clasifican_de_zona_4]
    );
    const tournamentId = tournamentRes.rows[0].id;

    for (const court of globalCourts) {
      await client.query(
        "INSERT INTO courts (tournament_id, identificador, descripcion) VALUES ($1, $2, $3)",
        [tournamentId, court.nombre, court.descripcion || null]
      );
    }

    for (const method of paymentMethods) {
      await client.query(
        "INSERT INTO tournament_payment_methods (tournament_id, payment_method_id, enabled, sort_order) VALUES ($1, $2, true, $3)",
        [tournamentId, method.id, method.id]
      );
    }

    await client.query("COMMIT");

    await logAudit({
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

    res.status(201).json({ id: tournamentId });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message || "No se pudo crear el torneo" });
  } finally {
    client.release();
  }
});

router.get("/opciones-creacion", async (req, res) => {
  const paymentMethods = (await db.query(
    `SELECT id, nombre, descripcion, activo
     FROM payment_methods
     WHERE activo = true
     ORDER BY id ASC`
  )).rows;

  const globalCourts = (await db.query(
    `SELECT gc.id, gc.nombre, gc.descripcion, gc.club_id, gcl.nombre AS club_nombre, gc.activo,
            CASE WHEN gc.club_id IS NULL THEN 'local' ELSE 'club' END AS scope_type
     FROM global_courts gc
     LEFT JOIN global_clubs gcl ON gcl.id = gc.club_id
     WHERE gc.activo = true
       AND ${courtScopeFilter("gc")}
     ORDER BY gc.id ASC`
  )).rows;

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

router.get("/", async (req, res) => {
  const isSuperAdmin = req.user?.role === "superadmin";

  let sql = "SELECT * FROM tournaments";

  if (!isSuperAdmin) {
    sql += " WHERE status = 'activo'";
  }

  sql += " ORDER BY id DESC";

  const rows = (await db.query(sql)).rows;
  res.json(rows);
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const tournament = (await db.query("SELECT * FROM tournaments WHERE id = $1", [id])).rows[0];
  if (!tournament) return res.status(404).json({ error: "Torneo no encontrado" });
  res.json(tournament);
});

router.get("/:id/medios-pago", async (req, res) => {
  const id = Number(req.params.id);
  const enabledOnly = String(req.query.enabledOnly || "") === "1";
  const tournament = (await db.query("SELECT * FROM tournaments WHERE id = $1", [id])).rows[0];
  if (!tournament) return res.status(404).json({ error: "Torneo no encontrado" });

  const rows = (await db.query(
    `SELECT
      pm.id,
      pm.nombre,
      pm.descripcion,
      pm.activo,
      COALESCE(tpm.enabled, false) AS enabled,
      COALESCE(tpm.sort_order, pm.id) AS sort_order
     FROM payment_methods pm
     LEFT JOIN tournament_payment_methods tpm
       ON tpm.payment_method_id = pm.id
      AND tpm.tournament_id = $1
     ORDER BY COALESCE(tpm.sort_order, pm.id) ASC, pm.id ASC`,
    [id]
  )).rows;

  const data = enabledOnly ? rows.filter((r) => r.activo && r.enabled) : rows;
  res.json(data);
});

router.put("/:id/medios-pago", async (req, res) => {
  const id = Number(req.params.id);
  const enabledIds = Array.isArray(req.body?.enabled_ids)
    ? [...new Set(req.body.enabled_ids.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))]
    : null;

  if (!enabledIds) {
    return res.status(400).json({ error: "enabled_ids debe ser un array" });
  }

  const before = (await db.query("SELECT * FROM tournaments WHERE id = $1", [id])).rows[0];
  if (!before) return res.status(404).json({ error: "Torneo no encontrado" });

  let valid = [];
  if (enabledIds.length > 0) {
    const placeholders = enabledIds.map((_, i) => `$${i + 1}`).join(",");
    valid = (await db.query(
      `SELECT id FROM payment_methods WHERE id IN (${placeholders})`,
      enabledIds
    )).rows.map((r) => r.id);
  }

  if (valid.length !== enabledIds.length) {
    return res.status(400).json({ error: "Uno o mas medios de pago no existen" });
  }

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM tournament_payment_methods WHERE tournament_id = $1", [id]);
    for (const [idx, methodId] of enabledIds.entries()) {
      await client.query(
        "INSERT INTO tournament_payment_methods (tournament_id, payment_method_id, enabled, sort_order) VALUES ($1, $2, true, $3)",
        [id, methodId, idx + 1]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }

  await logAudit({
    actorUserId: req.user.id,
    action: "update",
    entity: "tournament_payment_methods",
    entityId: id,
    before: { tournamentId: id },
    after: { enabledIds },
  });

  res.json({ ok: true });
});

router.put("/:id/finalizar", async (req, res) => {
  const id = Number(req.params.id);
  const before = (await db.query("SELECT * FROM tournaments WHERE id = $1", [id])).rows[0];
  if (!before) return res.status(404).json({ error: "Torneo no encontrado" });

  const final = (await db.query(
    "SELECT winner_id FROM matches WHERE tournament_id = $1 AND stage = 'eliminatoria' AND round = 'final' LIMIT 1",
    [id]
  )).rows[0];
  if (!final || !final.winner_id) {
    return res.status(400).json({ error: "No se puede finalizar sin resultado de final" });
  }

  await db.query("UPDATE tournaments SET status = 'finalizado' WHERE id = $1", [id]);

  await logAudit({
    actorUserId: req.user.id,
    action: "finalize",
    entity: "tournaments",
    entityId: id,
    before,
    after: { status: "finalizado" },
  });

  res.json({ ok: true });
});

router.put("/:id/iniciar", async (req, res) => {
  const id = Number(req.params.id);
  const force = Boolean(req.body?.force);
  const before = (await db.query("SELECT * FROM tournaments WHERE id = $1", [id])).rows[0];
  if (!before) return res.status(404).json({ error: "Torneo no encontrado" });
  if (before.zonas_generadas) {
    return res.status(400).json({ error: "El torneo ya fue iniciado" });
  }

  const pairCountRes = await db.query("SELECT COUNT(*) AS total FROM pairs WHERE tournament_id = $1", [id]);
  const pairCount = parseInt(pairCountRes.rows[0].total);

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

  const ausentesRes = await db.query(
    `SELECT COUNT(*) AS total
     FROM pairs
     WHERE tournament_id = $1 AND COALESCE(presente, false) <> true`,
    [id]
  );
  const ausentes = parseInt(ausentesRes.rows[0].total);

  const conSaldoRes = await db.query(
    `SELECT COUNT(*) AS total
     FROM (
       SELECT pair_id
       FROM payments
       WHERE tournament_id = $1
       GROUP BY pair_id
       HAVING SUM(CASE WHEN estado = 'pagado' THEN 1 ELSE 0 END) < 2
     ) x`,
    [id]
  );
  const conSaldo = parseInt(conSaldoRes.rows[0].total);

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

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE tournaments SET planned_pairs = $1 WHERE id = $2", [pairCount, id]);
    await client.query("DELETE FROM matches WHERE tournament_id = $1 AND stage = 'eliminatoria'", [id]);
    await client.query("DELETE FROM groups WHERE tournament_id = $1", [id]);
    await client.query("UPDATE pairs SET group_id = NULL WHERE tournament_id = $1", [id]);

    const updatedTournamentRes = await client.query("SELECT * FROM tournaments WHERE id = $1", [id]);
    const updatedTournament = updatedTournamentRes.rows[0];

    await createGroups(updatedTournament, client);
    await createBracketTree(updatedTournament);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err.message || "No se pudo iniciar torneo" });
  } finally {
    client.release();
  }

  try {
    await assignPairsAndGenerateZones(id);
    await logAudit({
      actorUserId: req.user.id,
      action: "start",
      entity: "tournaments",
      entityId: id,
      before,
      after: { zonas_generadas: true, planned_pairs: pairCount },
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
  async (req, res) => {
    const tournamentId = req.validated.params.id;
    const tournament = (await db.query("SELECT * FROM tournaments WHERE id = $1", [tournamentId])).rows[0];
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

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      const pairCountRes = await client.query(
        "SELECT COUNT(*) AS total FROM pairs WHERE tournament_id = $1",
        [tournamentId]
      );
      if (parseInt(pairCountRes.rows[0].total) >= config.maxTournamentPairs) {
        throw new Error(`Se alcanzo el limite de parejas permitido (${config.maxTournamentPairs})`);
      }

      async function upsertPlayer(player) {
        const found = (await client.query(
          "SELECT * FROM players WHERE nombre = $1 AND apellido = $2 AND telefono = $3",
          [player.nombre, player.apellido, player.telefono]
        )).rows[0];
        if (found) return found.id;
        const result = await client.query(
          "INSERT INTO players (nombre, apellido, telefono) VALUES ($1, $2, $3) RETURNING id",
          [player.nombre, player.apellido, player.telefono]
        );
        return result.rows[0].id;
      }

      const player1Id = await upsertPlayer(p1);
      const player2Id = await upsertPlayer(p2);

      const existingInTournament = (await client.query(
        `SELECT 1
         FROM pairs p
         INNER JOIN pair_players pp ON pp.pair_id = p.id
         WHERE p.tournament_id = $1 AND pp.player_id IN ($2, $3)
         LIMIT 1`,
        [tournamentId, player1Id, player2Id]
      )).rows[0];
      if (existingInTournament) {
        throw new Error("Los jugadores deben ser unicos dentro del torneo");
      }

      const pairRes = await client.query(
        "INSERT INTO pairs (tournament_id) VALUES ($1) RETURNING id",
        [tournamentId]
      );
      const pairId = pairRes.rows[0].id;

      await client.query(
        "INSERT INTO pair_players (pair_id, player_id, player_num) VALUES ($1, $2, 1)",
        [pairId, player1Id]
      );
      await client.query(
        "INSERT INTO pair_players (pair_id, player_id, player_num) VALUES ($1, $2, 2)",
        [pairId, player2Id]
      );

      await client.query(
        "INSERT INTO payments (tournament_id, pair_id, player_num, estado) VALUES ($1, $2, 1, 'sin_pago')",
        [tournamentId, pairId]
      );
      await client.query(
        "INSERT INTO payments (tournament_id, pair_id, player_num, estado) VALUES ($1, $2, 2, 'sin_pago')",
        [tournamentId, pairId]
      );

      await client.query("COMMIT");

      await logAudit({
        actorUserId: req.user.id,
        action: "create",
        entity: "pairs",
        entityId: pairId,
        after: { tournamentId, p1, p2 },
      });

      res.status(201).json({ id: pairId });
    } catch (err) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: err.message || "No se pudo crear la pareja" });
    } finally {
      client.release();
    }
  }
);

router.get("/:id/parejas", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const rows = (await db.query(
    `${pairSummarySql()} WHERE p.tournament_id = $1 ORDER BY p.id ASC`,
    [tournamentId]
  )).rows;
  const states = await computePairPaymentStates(tournamentId, rows.map((r) => r.id));

  const data = rows.map((r) => {
    const payments = states.get(r.id) || [];
    const warningPago = payments.some((p) => p.estado !== "pagado");
    return { ...r, warning_pago: warningPago };
  });

  res.json(data);
});

router.put("/:id/parejas/:pairId", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);
  const tournament = (await db.query("SELECT * FROM tournaments WHERE id = $1", [tournamentId])).rows[0];
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

  const pair = (await db.query(
    "SELECT * FROM pairs WHERE id = $1 AND tournament_id = $2",
    [pairId, tournamentId]
  )).rows[0];
  if (!pair) return res.status(404).json({ error: "Pareja no encontrada" });

  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    async function upsertPlayer(player) {
      const found = (await client.query(
        "SELECT * FROM players WHERE nombre = $1 AND apellido = $2 AND telefono = $3",
        [player.nombre, player.apellido, player.telefono]
      )).rows[0];
      if (found) return found.id;
      const result = await client.query(
        "INSERT INTO players (nombre, apellido, telefono) VALUES ($1, $2, $3) RETURNING id",
        [player.nombre, player.apellido, player.telefono]
      );
      return result.rows[0].id;
    }

    const player1Id = await upsertPlayer(p1);
    const player2Id = await upsertPlayer(p2);

    const existingInTournament = (await client.query(
      `SELECT 1
       FROM pairs p
       INNER JOIN pair_players pp ON pp.pair_id = p.id
       WHERE p.tournament_id = $1 AND p.id <> $2 AND pp.player_id IN ($3, $4)
       LIMIT 1`,
      [tournamentId, pairId, player1Id, player2Id]
    )).rows[0];
    if (existingInTournament) {
      throw new Error("Los jugadores deben ser unicos dentro del torneo");
    }

    await client.query(
      "UPDATE pair_players SET player_id = $1 WHERE pair_id = $2 AND player_num = 1",
      [player1Id, pairId]
    );
    await client.query(
      "UPDATE pair_players SET player_id = $1 WHERE pair_id = $2 AND player_num = 2",
      [player2Id, pairId]
    );

    await client.query("COMMIT");

    await logAudit({
      actorUserId: req.user.id,
      action: "update",
      entity: "pairs",
      entityId: pairId,
      after: { player1: p1, player2: p2 },
    });

    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message || "No se pudo editar la pareja" });
  } finally {
    client.release();
  }
});

router.delete("/:id/parejas/:pairId", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);
  const tournament = (await db.query("SELECT * FROM tournaments WHERE id = $1", [tournamentId])).rows[0];
  if (!tournament) return res.status(404).json({ error: "Torneo no encontrado" });
  if (tournament.zonas_generadas) {
    return res.status(400).json({ error: "No se pueden eliminar parejas luego de generar zonas" });
  }

  const before = (await db.query(
    "SELECT id FROM pairs WHERE id = $1 AND tournament_id = $2",
    [pairId, tournamentId]
  )).rows[0];
  if (!before) return res.status(404).json({ error: "Pareja no encontrada" });

  await db.query("DELETE FROM pairs WHERE id = $1 AND tournament_id = $2", [pairId, tournamentId]);

  await logAudit({
    actorUserId: req.user.id,
    action: "delete",
    entity: "pairs",
    entityId: pairId,
    before,
  });

  res.json({ ok: true });
});

router.put("/:id/parejas/:pairId/presente", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);

  const playing = (await db.query(
    `SELECT id FROM matches
     WHERE tournament_id = $1 AND (pair1_id = $2 OR pair2_id = $2)
     AND started_at IS NOT NULL AND finished_at IS NULL
     LIMIT 1`,
    [tournamentId, pairId]
  )).rows[0];

  if (playing) {
    return res.status(400).json({ error: "No se puede cambiar el estado de una pareja en juego" });
  }

  await db.query(
    "UPDATE pairs SET presente = true, presente_at = NOW() WHERE id = $1 AND tournament_id = $2",
    [pairId, tournamentId]
  );

  res.json({ ok: true });
});

router.put("/:id/parejas/:pairId/ausente", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);

  const playing = (await db.query(
    `SELECT id FROM matches
     WHERE tournament_id = $1 AND (pair1_id = $2 OR pair2_id = $2)
     AND started_at IS NOT NULL AND finished_at IS NULL
     LIMIT 1`,
    [tournamentId, pairId]
  )).rows[0];
  if (playing) {
    return res.status(400).json({ error: "No se puede cambiar el estado de una pareja en juego" });
  }

  const woSets = buildWOSets();

  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    await client.query(
      "UPDATE pairs SET presente = false, presente_at = NOW() WHERE id = $1 AND tournament_id = $2",
      [pairId, tournamentId]
    );

    const pendingMatches = (await client.query(
      `SELECT * FROM matches
       WHERE tournament_id = $1
       AND (pair1_id = $2 OR pair2_id = $2)
       AND winner_id IS NULL
       AND (started_at IS NULL OR finished_at IS NULL)`,
      [tournamentId, pairId]
    )).rows;

    for (const match of pendingMatches) {
      const winnerId = match.pair1_id === pairId ? match.pair2_id : match.pair1_id;
      if (!winnerId) continue;
      if (match.started_at && !match.finished_at) continue;

      const p1won = match.pair1_id === winnerId;
      await client.query(
        `UPDATE matches SET
          set1_pair1 = $1, set1_pair2 = $2,
          set2_pair1 = NULL, set2_pair2 = NULL,
          supertb_pair1 = NULL, supertb_pair2 = NULL,
          winner_id = $3, is_wo = true, finished_at = NOW(), played_at = NOW()
         WHERE id = $4`,
        [
          p1won ? woSets.set1_pair1 : woSets.set1_pair2,
          p1won ? woSets.set1_pair2 : woSets.set1_pair1,
          winnerId,
          match.id,
        ]
      );

      if (match.group_id) {
        await recalcGroupStandings(match.group_id);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }

  res.json({ ok: true });
});

router.get("/:id/pagos", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const rows = (await db.query(
    `SELECT p.*, t.id as tx_id, t.payment_method_id, t.monto, t.created_at as tx_created_at
     FROM payments p
     LEFT JOIN payment_transactions t ON t.payment_id = p.id
     WHERE p.tournament_id = $1
     ORDER BY p.pair_id, p.player_num, t.id`,
    [tournamentId]
  )).rows;

  res.json(rows);
});

router.post("/:id/pagos/:pairId/jugador/:playerNum/transaccion", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);
  const playerNum = Number(req.params.playerNum);
  const { payment_method_id, monto } = req.body;

  const payment = (await db.query(
    "SELECT * FROM payments WHERE tournament_id = $1 AND pair_id = $2 AND player_num = $3",
    [tournamentId, pairId, playerNum]
  )).rows[0];
  if (!payment) return res.status(404).json({ error: "Pago no encontrado" });

  await db.query(
    "INSERT INTO payment_transactions (payment_id, payment_method_id, monto) VALUES ($1, $2, $3)",
    [payment.id, Number(payment_method_id), Number(monto)]
  );

  const sumRes = await db.query(
    "SELECT COALESCE(SUM(monto), 0) AS total FROM payment_transactions WHERE payment_id = $1",
    [payment.id]
  );
  const sum = parseFloat(sumRes.rows[0].total);

  const estado = normalizeEstadoForTransactions(sum);
  await db.query("UPDATE payments SET estado = $1 WHERE id = $2", [estado, payment.id]);

  res.status(201).json({ ok: true });
});

router.put("/:id/pagos/:pairId/jugador/:playerNum/estado", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const pairId = Number(req.params.pairId);
  const playerNum = Number(req.params.playerNum);
  const { estado } = req.body;

  if (!["sin_pago", "parcial", "pagado"].includes(estado)) {
    return res.status(400).json({ error: "Estado invalido" });
  }

  await db.query(
    "UPDATE payments SET estado = $1 WHERE tournament_id = $2 AND pair_id = $3 AND player_num = $4",
    [estado, tournamentId, pairId, playerNum]
  );

  res.json({ ok: true });
});

router.put("/:id/pagos/transacciones/:txId", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const txId = Number(req.params.txId);
  const { monto } = req.body;

  const txRow = (await db.query(
    `SELECT t.*, p.id AS payment_id
     FROM payment_transactions t
     INNER JOIN payments p ON p.id = t.payment_id
     WHERE t.id = $1 AND p.tournament_id = $2`,
    [txId, tournamentId]
  )).rows[0];
  if (!txRow) return res.status(404).json({ error: "Transaccion no encontrada" });

  await db.query(
    "UPDATE payment_transactions SET monto = $1, updated_at = NOW() WHERE id = $2",
    [Number(monto), txId]
  );

  const sumRes = await db.query(
    "SELECT COALESCE(SUM(monto), 0) AS total FROM payment_transactions WHERE payment_id = $1",
    [txRow.payment_id]
  );
  const sum = parseFloat(sumRes.rows[0].total);

  const estado = normalizeEstadoForTransactions(sum);
  await db.query("UPDATE payments SET estado = $1 WHERE id = $2", [estado, txRow.payment_id]);

  res.json({ ok: true });
});

router.get("/:id/zonas", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const groups = (await db.query(
    "SELECT * FROM groups WHERE tournament_id = $1 ORDER BY name ASC",
    [tournamentId]
  )).rows;

  const result = [];
  for (const group of groups) {
    const matches = (await db.query(
      `SELECT m.*,
        (SELECT cq.court_id FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_court_id,
        (SELECT cq.orden FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_orden
       FROM matches m
       WHERE m.group_id = $1
       ORDER BY m.id ASC`,
      [group.id]
    )).rows;

    const calc = await recalcGroupStandings(group.id);
    result.push({
      group,
      matches,
      standings: calc.standings,
      has_tie_warning: calc.ties.length > 0,
    });
  }

  res.json(result);
});

router.put("/:id/zonas/:zonaId/posiciones", async (req, res) => {
  const zonaId = Number(req.params.zonaId);
  const positions = req.body.positions || req.body.ordered_pair_ids;
  if (!Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: "positions es requerido" });
  }

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    for (const [idx, pairId] of positions.entries()) {
      await client.query(
        "UPDATE group_standings SET position = $1, position_override = true WHERE group_id = $2 AND pair_id = $3",
        [idx + 1, zonaId, pairId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }

  const tournamentId = Number(req.params.id);
  const sync = await syncBracketFirstRound(tournamentId);
  if (sync && sync.blocked) {
    return res.status(409).json(sync);
  }

  res.json({ ok: true });
});

router.put("/:id/zonas/cerrar", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const orderedByZone = req.body?.ordered_by_zone || {};

  const tournament = (await db.query("SELECT id FROM tournaments WHERE id = $1", [tournamentId])).rows[0];
  if (!tournament) return res.status(404).json({ error: "Torneo no encontrado" });

  const groups = (await db.query(
    "SELECT id, name FROM groups WHERE tournament_id = $1 ORDER BY name ASC",
    [tournamentId]
  )).rows;

  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    for (const group of groups) {
      await recalcGroupStandings(group.id);

      const groupPairIds = (await client.query(
        "SELECT pair_id FROM group_standings WHERE group_id = $1",
        [group.id]
      )).rows.map((row) => Number(row.pair_id));

      const providedOrder = orderedByZone[group.id] || orderedByZone[String(group.id)];
      const fallbackRows = (await client.query(
        `SELECT pair_id
         FROM group_standings
         WHERE group_id = $1
         ORDER BY CASE WHEN position IS NULL THEN 999 ELSE position END ASC, id ASC`,
        [group.id]
      )).rows;
      const fallbackOrder = fallbackRows.map((row) => Number(row.pair_id));

      const nextOrder = Array.isArray(providedOrder) && providedOrder.length
        ? providedOrder.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : fallbackOrder;

      const unique = new Set(nextOrder);
      const hasSameMembers = groupPairIds.every((pairId) => unique.has(pairId));
      if (!hasSameMembers || unique.size !== groupPairIds.length) {
        throw new Error(`El orden recibido para Zona ${group.name} es invalido`);
      }

      for (const [idx, pairId] of nextOrder.entries()) {
        await client.query(
          "UPDATE group_standings SET position = $1, position_override = true WHERE group_id = $2 AND pair_id = $3",
          [idx + 1, group.id, pairId]
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err.message || "No se pudieron cerrar las zonas" });
  } finally {
    client.release();
  }

  const sync = await syncBracketFirstRound(tournamentId);
  if (sync && sync.blocked) {
    return res.status(409).json(sync);
  }

  return res.json({ ok: true });
});

router.get("/:id/cuadro", async (req, res) => {
  const tournamentId = Number(req.params.id);

  // sync debe ir primero porque escribe en la BD
  const sync = await syncBracketFirstRound(tournamentId);

  // las tres operaciones siguientes son independientes entre sí → paralelo
  const [slotLabels, diagnostics, matchRows] = await Promise.all([
    buildEliminationSlotLabels(tournamentId),
    getBracketSyncDiagnostics(tournamentId, sync),
    db.query(
      `SELECT m.*,
        (SELECT cq.court_id FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_court_id,
        (SELECT cq.orden FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_orden
       FROM matches m
       WHERE m.tournament_id = $1 AND m.stage = 'eliminatoria'
       ORDER BY m.id ASC`,
      [tournamentId]
    ),
  ]);

  const matches = matchRows.rows.map((row) => ({
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

router.post("/:id/canchas", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const nombre = String(req.body?.nombre || req.body?.identificador || "").trim();
  const descripcion = String(req.body?.descripcion || "").trim();
  if (!nombre) {
    return res.status(400).json({ error: "Nombre de cancha requerido" });
  }

  const result = await db.query(
    "INSERT INTO courts (tournament_id, identificador, descripcion) VALUES ($1, $2, $3) RETURNING id",
    [tournamentId, nombre, descripcion || null]
  );
  res.status(201).json({ id: result.rows[0].id });
});

router.get("/:id/canchas", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const rows = (await db.query(
    `SELECT
      id,
      tournament_id,
      identificador,
      COALESCE(descripcion, '') AS descripcion,
      created_at
     FROM courts
     WHERE tournament_id = $1
     ORDER BY id ASC`,
    [tournamentId]
  )).rows;
  res.json(
    rows.map((r) => ({
      ...r,
      nombre: r.identificador,
    }))
  );
});

router.put("/:id/canchas/:canchaId", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const canchaId = Number(req.params.canchaId);
  const nombre = String(req.body?.nombre || req.body?.identificador || "").trim();
  const descripcion = String(req.body?.descripcion || "").trim();

  if (!nombre) {
    return res.status(400).json({ error: "Nombre de cancha requerido" });
  }

  const result = await db.query(
    `UPDATE courts
     SET identificador = $1, descripcion = $2
     WHERE id = $3 AND tournament_id = $4`,
    [nombre, descripcion || null, canchaId, tournamentId]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: "Cancha no encontrada" });
  }

  res.json({ ok: true });
});

router.delete("/:id/canchas/:canchaId", (req, res) => {
  res.status(400).json({ error: "No se permite eliminar canchas una vez creado el torneo" });
});

router.get("/:id/canchas/estado", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const courts = (await db.query(
    "SELECT * FROM courts WHERE tournament_id = $1 ORDER BY id ASC",
    [tournamentId]
  )).rows;

  const data = [];
  for (const court of courts) {
    const playing = (await db.query(
      `SELECT * FROM matches
       WHERE court_id = $1 AND tournament_id = $2 AND started_at IS NOT NULL AND finished_at IS NULL
       LIMIT 1`,
      [court.id, tournamentId]
    )).rows[0];

    const queue = (await db.query(
      `SELECT cq.*, m.stage, m.round, m.pair1_id, m.pair2_id
       FROM court_queue cq
       INNER JOIN matches m ON m.id = cq.match_id
       WHERE cq.court_id = $1 AND m.tournament_id = $2
       ORDER BY cq.orden ASC`,
      [court.id, tournamentId]
    )).rows;

    data.push({
      court,
      estado: playing ? "ocupada" : queue.length ? "cola" : "libre",
      playing: playing || null,
      queue,
    });
  }

  res.json(data);
});

router.get("/:id/partidos/pendientes", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const pending = (await db.query(
    `SELECT m.*,
      (SELECT cq.court_id FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_court_id,
      (SELECT cq.orden FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_orden
     FROM matches m
     WHERE m.tournament_id = $1 AND m.winner_id IS NULL
     ORDER BY m.id ASC`,
    [tournamentId]
  )).rows;

  const sinCancha = pending.filter((m) => !m.queue_court_id && !m.court_id);
  const conCancha = pending.filter((m) => m.queue_court_id && !m.started_at);

  res.json({ sinCancha, conCancha });
});

router.get("/:id/partidos", async (req, res) => {
  const tournamentId = Number(req.params.id);
  const rows = (await db.query(
    `SELECT m.*,
      (SELECT cq.court_id FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_court_id,
      (SELECT cq.orden FROM court_queue cq WHERE cq.match_id = m.id LIMIT 1) AS queue_orden
     FROM matches m
     WHERE tournament_id = $1
     ORDER BY stage ASC, id ASC`,
    [tournamentId]
  )).rows;
  res.json(rows);
});

router.post("/canchas/:canchaId/cola", async (req, res) => {
  const canchaId = Number(req.params.canchaId);
  const { match_id } = req.body;
  try {
    await queueMatch(canchaId, Number(match_id));
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/canchas/:canchaId/cola/:matchId", async (req, res) => {
  const canchaId = Number(req.params.canchaId);
  const matchId = Number(req.params.matchId);
  await removeFromQueue(canchaId, matchId);
  res.json({ ok: true });
});

router.put("/canchas/:canchaId/cola/orden", async (req, res) => {
  const canchaId = Number(req.params.canchaId);
  const { match_ids } = req.body;
  await reorderQueue(canchaId, match_ids || []);
  res.json({ ok: true });
});

module.exports = router;
