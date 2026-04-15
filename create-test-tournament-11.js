/**
 * Crea un torneo de prueba con 11 parejas, genera zonas,
 * simula resultados completos de zona y sincroniza el bracket.
 *
 * Uso: DATABASE_URL=postgresql://postgres:Admin123@localhost:5432/t_tracker node create-test-tournament-11.js
 */
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:Admin123@localhost:5432/t_tracker";
process.env.DATABASE_URL = DATABASE_URL;

const { db } = require("./Backend/src/db/connection");
const { buildZoneDistribution, calcTorneo } = require("./Backend/src/logic/zonas");

const GROUP_NAMES = ["A", "B", "C", "D", "E", "F"];

async function main() {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    // 1. Crear torneo
    const { rows: tRows } = await client.query(
      `INSERT INTO tournaments (name, status, planned_pairs, tipo_torneo, match_format,
        clasifican_de_zona_3, clasifican_de_zona_4, zonas_generadas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE) RETURNING *`,
      ["Test Seeding 11p", "activo", 11, "americano", "best_of_3", 3, 4]
    );
    const tournament = tRows[0];
    console.log(`✅ Torneo creado: id=${tournament.id}, name="${tournament.name}"`);

    // 2. Crear zonas [4, 4, 3]
    const dist = buildZoneDistribution(11);
    console.log(`   Zonas: [${dist.join(", ")}]`);
    const groups = [];
    for (let i = 0; i < dist.length; i++) {
      const { rows } = await client.query(
        "INSERT INTO groups (tournament_id, name, size) VALUES ($1, $2, $3) RETURNING *",
        [tournament.id, GROUP_NAMES[i], dist[i]]
      );
      groups.push(rows[0]);
    }

    // 3. Crear 22 jugadores y 11 parejas
    const pairs = [];
    for (let p = 1; p <= 11; p++) {
      const { rows: pairRows } = await client.query(
        "INSERT INTO pairs (tournament_id) VALUES ($1) RETURNING *",
        [tournament.id]
      );
      const pair = pairRows[0];
      pairs.push(pair);

      for (let pn = 1; pn <= 2; pn++) {
        const { rows: plRows } = await client.query(
          "INSERT INTO players (nombre, apellido, telefono, dni) VALUES ($1, $2, $3, $4) RETURNING *",
          [`Jugador${p}${String.fromCharCode(64 + pn)}`, `Test`, `1100${p}${pn}`, `${30000000 + p * 10 + pn}`]
        );
        await client.query(
          "INSERT INTO pair_players (pair_id, player_id, player_num) VALUES ($1, $2, $3)",
          [pair.id, plRows[0].id, pn]
        );
      }
    }
    console.log(`   Creadas ${pairs.length} parejas (${pairs.length * 2} jugadores)`);

    // 4. Asignar parejas a zonas
    let cursor = 0;
    for (const group of groups) {
      const zonePairs = pairs.slice(cursor, cursor + group.size);
      cursor += group.size;

      for (const pair of zonePairs) {
        await client.query("UPDATE pairs SET group_id = $1 WHERE id = $2", [group.id, pair.id]);
        pair.group_id = group.id;
        await client.query(
          "INSERT INTO group_standings (group_id, pair_id) VALUES ($1, $2)",
          [group.id, pair.id]
        );
      }

      // 5. Crear partidos de zona
      if (group.size === 3) {
        const [p1, p2, p3] = zonePairs.map((p) => p.id);
        await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES ($1, 'zona', 'r1', $2, $3, $4)",
          [tournament.id, group.id, p1, p2]
        );
        await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES ($1, 'zona', 'r1', $2, $3, $4)",
          [tournament.id, group.id, p1, p3]
        );
        await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES ($1, 'zona', 'r1', $2, $3, $4)",
          [tournament.id, group.id, p2, p3]
        );
      } else {
        const [p1, p2, p3, p4] = zonePairs.map((p) => p.id);
        const { rows: m1 } = await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES ($1, 'zona', 'r1', $2, $3, $4) RETURNING id",
          [tournament.id, group.id, p1, p3]
        );
        const { rows: m2 } = await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, pair1_id, pair2_id) VALUES ($1, 'zona', 'r1', $2, $3, $4) RETURNING id",
          [tournament.id, group.id, p2, p4]
        );
        await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, slot1_source_match_id, slot2_source_match_id) VALUES ($1, 'zona', 'r2w', $2, $3, $4)",
          [tournament.id, group.id, m1[0].id, m2[0].id]
        );
        await client.query(
          "INSERT INTO matches (tournament_id, stage, round, group_id, slot1_source_match_id, slot2_source_match_id) VALUES ($1, 'zona', 'r2l', $2, $3, $4)",
          [tournament.id, group.id, m1[0].id, m2[0].id]
        );
      }
    }
    await client.query("UPDATE tournaments SET zonas_generadas = TRUE WHERE id = $1", [tournament.id]);
    console.log(`   Zonas generadas y partidos de zona creados`);

    // 6. Simular resultados de zona (el 1ro gana todo, el 2do le gana al 3ro, etc.)
    const { rows: zoneMatches } = await client.query(
      `SELECT m.*, g.name as group_name, g.size as group_size
       FROM matches m JOIN groups g ON m.group_id = g.id
       WHERE m.tournament_id = $1 AND m.stage = 'zona'
       ORDER BY g.name, m.round, m.id`,
      [tournament.id]
    );

    // Para zonas de 3: round-robin directo, ya tienen pair1/pair2
    // Para zonas de 4: r1 tiene pair1/pair2, r2w/r2l se actualizan despues
    for (const m of zoneMatches) {
      if (m.round === 'r1' && m.pair1_id && m.pair2_id) {
        // El primero en la lista siempre gana (determinístico)
        const winner = m.pair1_id;
        await client.query(
          `UPDATE matches SET winner_id = $1, set1_pair1 = 6, set1_pair2 = 3,
           finished_at = NOW() WHERE id = $2`,
          [winner, m.id]
        );
      }
    }

    // Ahora resolver r2w y r2l para zonas de 4
    const { rows: r2Matches } = await client.query(
      `SELECT * FROM matches
       WHERE tournament_id = $1 AND stage = 'zona' AND round IN ('r2w', 'r2l')
       ORDER BY id`,
      [tournament.id]
    );
    for (const m of r2Matches) {
      const { rows: src1 } = await client.query("SELECT * FROM matches WHERE id = $1", [m.slot1_source_match_id]);
      const { rows: src2 } = await client.query("SELECT * FROM matches WHERE id = $1", [m.slot2_source_match_id]);
      let p1, p2;
      if (m.round === 'r2w') {
        p1 = src1[0].winner_id;
        p2 = src2[0].winner_id;
      } else {
        // r2l: los perdedores
        p1 = src1[0].pair1_id === src1[0].winner_id ? src1[0].pair2_id : src1[0].pair1_id;
        p2 = src2[0].pair1_id === src2[0].winner_id ? src2[0].pair2_id : src2[0].pair1_id;
      }
      const winner = p1; // el primero siempre gana
      await client.query(
        `UPDATE matches SET pair1_id = $1, pair2_id = $2, winner_id = $3,
         set1_pair1 = 6, set1_pair2 = 4, finished_at = NOW() WHERE id = $4`,
        [p1, p2, winner, m.id]
      );
    }
    console.log(`   Resultados de zona simulados`);

    // 7. Calcular standings
    for (const group of groups) {
      const { rows: gMatches } = await client.query(
        `SELECT * FROM matches WHERE group_id = $1 AND stage = 'zona' AND finished_at IS NOT NULL`,
        [group.id]
      );
      const stats = {};
      for (const m of gMatches) {
        for (const pid of [m.pair1_id, m.pair2_id]) {
          if (!pid) continue;
          if (!stats[pid]) stats[pid] = { wins: 0, gw: 0, gl: 0 };
        }
        if (m.winner_id) {
          stats[m.winner_id].wins += 1;
          const loser = m.pair1_id === m.winner_id ? m.pair2_id : m.pair1_id;
          // Score
          const s1p1 = m.set1_pair1 || 0;
          const s1p2 = m.set1_pair2 || 0;
          if (m.pair1_id === m.winner_id) {
            stats[m.winner_id].gw += s1p1;
            stats[m.winner_id].gl += s1p2;
            if (stats[loser]) { stats[loser].gw += s1p2; stats[loser].gl += s1p1; }
          } else {
            stats[m.winner_id].gw += s1p2;
            stats[m.winner_id].gl += s1p1;
            if (stats[loser]) { stats[loser].gw += s1p1; stats[loser].gl += s1p2; }
          }
        }
      }
      // Sort by wins desc, game diff desc
      const sorted = Object.entries(stats)
        .sort(([, a], [, b]) => b.wins - a.wins || (b.gw - b.gl) - (a.gw - a.gl));

      for (let pos = 0; pos < sorted.length; pos++) {
        const [pairId, st] = sorted[pos];
        await client.query(
          `UPDATE group_standings SET points = $1, games_won = $2, games_lost = $3, position = $4
           WHERE group_id = $5 AND pair_id = $6`,
          [st.wins * 3, st.gw, st.gl, pos + 1, group.id, Number(pairId)]
        );
      }
    }
    console.log(`   Standings calculados`);

    // 8. Crear bracket de eliminatoria
    const setup = calcTorneo(tournament);
    const roundNames = ["r1", "octavos", "cuartos", "semis", "final"];
    let bracketSize = setup.bracketSize;
    let roundIndex = 0;
    const allRounds = [];
    let sz = bracketSize;
    while (sz >= 2) {
      allRounds.push({ roundIndex, matches: sz / 2, size: sz });
      sz /= 2;
      roundIndex++;
    }
    const allRoundRows = [];
    for (const round of allRounds) {
      const rows = [];
      for (let i = 0; i < round.matches; i++) {
        const name = round.size <= 2 ? "final" : roundNames[Math.min(roundNames.length - 1, round.roundIndex)];
        const { rows: ins } = await client.query(
          "INSERT INTO matches (tournament_id, stage, round) VALUES ($1, 'eliminatoria', $2) RETURNING id",
          [tournament.id, name]
        );
        rows.push(ins[0].id);
      }
      allRoundRows.push(rows);
    }
    // Link rounds
    for (let r = 1; r < allRoundRows.length; r++) {
      const prev = allRoundRows[r - 1];
      const curr = allRoundRows[r];
      for (let m = 0; m < curr.length; m++) {
        const src1 = prev[m * 2];
        const src2 = prev[m * 2 + 1];
        await client.query(
          "UPDATE matches SET slot1_source_match_id = $1, slot2_source_match_id = $2 WHERE id = $3",
          [src1, src2, curr[m]]
        );
      }
    }
    console.log(`   Bracket eliminatoria creado (${bracketSize} slots, ${setup.byes} BYEs)`);

    await client.query("COMMIT");

    // 9. Sincronizar primera ronda del bracket (fuera de transaccion)
    const { syncBracketFirstRound } = require("./Backend/src/services/tournamentSetup");
    const syncResult = await syncBracketFirstRound(tournament.id);
    console.log(`   Bracket sincronizado:`, syncResult);

    // 10. Mostrar resultado
    const { rows: firstRound } = await db.query(
      `SELECT m.id, m.round, m.pair1_id, m.pair2_id, m.is_bye, m.winner_id,
              p1pp.nombre AS p1_nombre, p2pp.nombre AS p2_nombre,
              g1.name AS g1_zona, g2.name AS g2_zona,
              gs1.position AS pos1, gs2.position AS pos2
       FROM matches m
       LEFT JOIN pairs pr1 ON m.pair1_id = pr1.id
       LEFT JOIN pairs pr2 ON m.pair2_id = pr2.id
       LEFT JOIN groups g1 ON pr1.group_id = g1.id
       LEFT JOIN groups g2 ON pr2.group_id = g2.id
       LEFT JOIN group_standings gs1 ON gs1.pair_id = pr1.id
       LEFT JOIN group_standings gs2 ON gs2.pair_id = pr2.id
       LEFT JOIN pair_players pp1 ON pp1.pair_id = pr1.id AND pp1.player_num = 1
       LEFT JOIN players p1pp ON p1pp.id = pp1.player_id
       LEFT JOIN pair_players pp2 ON pp2.pair_id = pr2.id AND pp2.player_num = 1
       LEFT JOIN players p2pp ON p2pp.id = pp2.player_id
       WHERE m.tournament_id = $1 AND m.stage = 'eliminatoria' AND m.round = 'r1'
       ORDER BY m.id`,
      [tournament.id]
    );

    console.log(`\n${"=".repeat(65)}`);
    console.log(`CUADRO ELIMINATORIA — Torneo ID ${tournament.id} (11 parejas, pasan todos)`);
    console.log(`${"=".repeat(65)}`);
    firstRound.forEach((m, i) => {
      const left = m.pair1_id
        ? `${m.pos1}°Z${m.g1_zona} (pair ${m.pair1_id})`
        : "---";
      const right = m.pair2_id
        ? `${m.pos2}°Z${m.g2_zona} (pair ${m.pair2_id})`
        : (m.is_bye ? "BYE" : "---");
      const bye = m.is_bye ? " [BYE]" : "";
      console.log(`  Match ${i + 1}: ${left.padEnd(25)} vs ${right}${bye}`);
    });

    console.log(`\n✅ Torneo listo. Abrí http://localhost:5173 y buscá torneo ID ${tournament.id}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", err);
  } finally {
    client.release();
    process.exit(0);
  }
}

main();
