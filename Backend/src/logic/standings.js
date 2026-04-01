const { db } = require("../db/connection");

function gamesFromMatchForPair(match, pairId) {
  const isPair1 = match.pair1_id === pairId;
  const pairGames = [
    isPair1 ? match.set1_pair1 : match.set1_pair2,
    isPair1 ? match.set2_pair1 : match.set2_pair2,
    isPair1 ? match.supertb_pair1 : match.supertb_pair2,
  ];
  const opponentGames = [
    isPair1 ? match.set1_pair2 : match.set1_pair1,
    isPair1 ? match.set2_pair2 : match.set2_pair1,
    isPair1 ? match.supertb_pair2 : match.supertb_pair1,
  ];
  const gw = pairGames.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const gl = opponentGames.reduce((sum, value) => sum + (Number(value) || 0), 0);
  return { gw, gl };
}

async function recalcGroupStandings(groupId, client) {
  const q = client || db;
  const { rows: groupRows } = await q.query("SELECT * FROM groups WHERE id = $1", [groupId]);
  const group = groupRows[0];
  if (!group) return { ties: [], standings: [] };

  const { rows } = await q.query(
    `SELECT gs.id, gs.pair_id, gs.position_override
     FROM group_standings gs
     WHERE gs.group_id = $1`,
    [groupId]
  );

  const { rows: matches } = await q.query(
    `SELECT * FROM matches WHERE group_id = $1 AND winner_id IS NOT NULL`,
    [groupId]
  );

  for (const row of rows) {
    let points = 0;
    let gamesWon = 0;
    let gamesLost = 0;

    for (const match of matches) {
      if (match.pair1_id !== row.pair_id && match.pair2_id !== row.pair_id) continue;
      if (match.winner_id === row.pair_id) points += 2;

      const g = gamesFromMatchForPair(match, row.pair_id);
      gamesWon += g.gw;
      gamesLost += g.gl;
    }

    await q.query(
      `UPDATE group_standings SET points = $1, games_won = $2, games_lost = $3 WHERE id = $4`,
      [points, gamesWon, gamesLost, row.id]
    );
  }

  const { rows: allStandings } = await q.query(
    `SELECT * FROM group_standings WHERE group_id = $1`,
    [groupId]
  );
  const ordered = allStandings.sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    const diffA = a.games_won - a.games_lost;
    const diffB = b.games_won - b.games_lost;
    if (diffA !== diffB) return diffB - diffA;
    return a.id - b.id;
  });

  const hasOverride = ordered.some((r) => r.position_override);
  if (!hasOverride) {
    if (group.size === 4) {
      const { rows: winnersRows } = await q.query(
        `SELECT * FROM matches WHERE group_id = $1 AND round = 'r2w' LIMIT 1`,
        [groupId]
      );
      const { rows: losersRows } = await q.query(
        `SELECT * FROM matches WHERE group_id = $1 AND round = 'r2l' LIMIT 1`,
        [groupId]
      );
      const winnersMatch = winnersRows[0];
      const losersMatch = losersRows[0];

      if (winnersMatch?.winner_id && losersMatch?.winner_id) {
        const second =
          winnersMatch.pair1_id === winnersMatch.winner_id
            ? winnersMatch.pair2_id
            : winnersMatch.pair1_id;
        const fourth =
          losersMatch.pair1_id === losersMatch.winner_id
            ? losersMatch.pair2_id
            : losersMatch.pair1_id;

        const forced = [
          winnersMatch.winner_id,
          second,
          losersMatch.winner_id,
          fourth,
        ].filter(Boolean);

        for (const [idx, pairId] of forced.entries()) {
          await q.query(
            "UPDATE group_standings SET position = $1 WHERE group_id = $2 AND pair_id = $3",
            [idx + 1, groupId, pairId]
          );
        }
      } else {
        for (const [idx, row] of ordered.entries()) {
          await q.query(
            "UPDATE group_standings SET position = $1 WHERE id = $2",
            [idx + 1, row.id]
          );
        }
      }
    } else {
      for (const [idx, row] of ordered.entries()) {
        await q.query(
          "UPDATE group_standings SET position = $1 WHERE id = $2",
          [idx + 1, row.id]
        );
      }
    }
  }

  const { rows: finalStandings } = await q.query(
    `SELECT * FROM group_standings
     WHERE group_id = $1
     ORDER BY CASE WHEN position IS NULL THEN 999 ELSE position END ASC, id ASC`,
    [groupId]
  );

  const ties = [];
  if (group.size === 3) {
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const a = ordered[i];
      const b = ordered[i + 1];
      const diffA = a.games_won - a.games_lost;
      const diffB = b.games_won - b.games_lost;
      if (a.points === b.points && diffA === diffB) {
        ties.push([a.pair_id, b.pair_id]);
      }
    }
  }

  return { ties, standings: finalStandings };
}

module.exports = { recalcGroupStandings };
