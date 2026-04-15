/**
 * Crea un torneo de prueba con 11 parejas, genera zonas y bracket
 * pero NO simula resultados de zona — quedan abiertas para ver placeholders.
 *
 * Uso: node create-test-tournament-open.js
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
      ["Test Placeholders 11p", "activo", 11, "americano", "best_of_3", 3, 4]
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
          [`J${p}${String.fromCharCode(64 + pn)}`, `Open`, `2200${p}${pn}`, `${50000000 + p * 10 + pn}`]
        );
        await client.query(
          "INSERT INTO pair_players (pair_id, player_id, player_num) VALUES ($1, $2, $3)",
          [pair.id, plRows[0].id, pn]
        );
      }
    }
    console.log(`   Creadas ${pairs.length} parejas (${pairs.length * 2} jugadores)`);

    // 4. Asignar parejas a zonas y crear partidos de zona
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
    console.log(`   Zonas generadas y partidos de zona creados (SIN resultados)`);

    // 5. Crear bracket de eliminatoria (vacio, para ver placeholders)
    const setup = calcTorneo(tournament);
    const roundNames = ["r1", "octavos", "cuartos", "semis", "final"];
    let sz = setup.bracketSize;
    let roundIndex = 0;
    const allRounds = [];
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
    for (let r = 1; r < allRoundRows.length; r++) {
      const prev = allRoundRows[r - 1];
      const curr = allRoundRows[r];
      for (let m = 0; m < curr.length; m++) {
        await client.query(
          "UPDATE matches SET slot1_source_match_id = $1, slot2_source_match_id = $2 WHERE id = $3",
          [prev[m * 2], prev[m * 2 + 1], curr[m]]
        );
      }
    }
    console.log(`   Bracket eliminatoria creado (${setup.bracketSize} slots, ${setup.byes} BYEs)`);

    await client.query("COMMIT");

    // Mostrar info de zonas
    for (const group of groups) {
      const { rows: gPairs } = await db.query(
        `SELECT p.id, pp1.nombre AS j1, pp2.nombre AS j2
         FROM pairs p
         LEFT JOIN (SELECT pp.pair_id, pl.nombre FROM pair_players pp JOIN players pl ON pl.id = pp.player_id WHERE pp.player_num = 1) pp1 ON pp1.pair_id = p.id
         LEFT JOIN (SELECT pp.pair_id, pl.nombre FROM pair_players pp JOIN players pl ON pl.id = pp.player_id WHERE pp.player_num = 2) pp2 ON pp2.pair_id = p.id
         WHERE p.group_id = $1 ORDER BY p.id`,
        [group.id]
      );
      console.log(`\n   Zona ${group.name} (${group.size} parejas):`);
      gPairs.forEach(p => console.log(`     Pair ${p.id}: ${p.j1} / ${p.j2}`));
    }

    console.log(`\n${"=".repeat(55)}`);
    console.log(`Torneo ID ${tournament.id} — zonas ABIERTAS (sin resultados)`);
    console.log(`Andá a http://localhost:5173 y mirá los placeholders`);
    console.log(`${"=".repeat(55)}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", err);
  } finally {
    client.release();
    process.exit(0);
  }
}

main();
