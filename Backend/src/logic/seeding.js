function getRankingScore(pair, tournament) {
  void tournament;
  // Punto de extension para ranking historico: reemplazar esta lectura por
  // logica combinada que consulte ranking acumulado de players.
  if (Number.isFinite(Number(pair?.score))) return Number(pair.score);
  if (Number.isFinite(Number(pair?.points_zona))) return Number(pair.points_zona);
  if (Number.isFinite(Number(pair?.points))) return Number(pair.points);
  return 0;
}

function compareSeeding(a, b) {
  if (a.position !== b.position) return a.position - b.position;
  if (a.score !== b.score) return b.score - a.score;
  const diffA = a.games_won - a.games_lost;
  const diffB = b.games_won - b.games_lost;
  if (diffA !== diffB) return diffB - diffA;
  return 0;
}

function classicSeedingPositions(size) {
  if (size === 1) return [0];
  if (size === 2) return [0, 1];

  const half = size / 2;
  const sub = classicSeedingPositions(half);
  const result = new Array(size);
  for (let index = 0; index < sub.length; index += 1) {
    result[index * 2] = sub[index];
    result[index * 2 + 1] = sub[index] + half;
  }
  return result;
}

function buildByePositions(seedOrder, byes) {
  const byePositions = new Set();
  for (let index = 0; index < byes; index += 1) {
    const seededPos = seedOrder[index];
    const opponentPos = seededPos % 2 === 0 ? seededPos + 1 : seededPos - 1;
    byePositions.add(opponentPos);
  }
  return byePositions;
}

function buildFirstRoundPairs(size, byePositions) {
  const pairs = [];
  for (let pos = 0; pos < size; pos += 2) {
    const pos1 = pos + 1;
    if (!byePositions.has(pos) && !byePositions.has(pos1)) {
      pairs.push([pos, pos1]);
    }
  }
  return pairs;
}

function getEntryForbiddenOpponents(entry) {
  if (!Array.isArray(entry?.previous_opponents)) return new Set();
  return new Set(entry.previous_opponents.map((id) => Number(id)).filter((id) => Number.isFinite(id)));
}

function compareCosts(a, b) {
  if (a.rematches !== b.rematches) return a.rematches - b.rematches;
  if (a.sameZone !== b.sameZone) return a.sameZone - b.sameZone;
  return a.deviation - b.deviation;
}

function evaluateFirstRoundCost(orderByEntryIdx, entries, baseOrderByEntryIdx, firstRoundPairs) {
  const entryIdxByPosition = new Map();
  for (let idx = 0; idx < orderByEntryIdx.length; idx += 1) {
    const pos = orderByEntryIdx[idx];
    entryIdxByPosition.set(pos, idx);
  }

  let rematches = 0;
  let sameZone = 0;

  for (const [p0, p1] of firstRoundPairs) {
    const idxA = entryIdxByPosition.get(p0);
    const idxB = entryIdxByPosition.get(p1);
    if (idxA == null || idxB == null) continue;

    const entryA = entries[idxA];
    const entryB = entries[idxB];
    if (!entryA || !entryB) continue;

    if (entryA.group_id != null && entryB.group_id != null && entryA.group_id === entryB.group_id) {
      sameZone += 1;
    }

    const forbidA = getEntryForbiddenOpponents(entryA);
    const forbidB = getEntryForbiddenOpponents(entryB);
    const pairA = Number(entryA.pair_id);
    const pairB = Number(entryB.pair_id);
    if ((Number.isFinite(pairB) && forbidA.has(pairB)) || (Number.isFinite(pairA) && forbidB.has(pairA))) {
      rematches += 1;
    }
  }

  let deviation = 0;
  for (let idx = 0; idx < orderByEntryIdx.length; idx += 1) {
    const basePos = baseOrderByEntryIdx[idx];
    const currentPos = orderByEntryIdx[idx];
    if (basePos != null && currentPos != null) {
      deviation += Math.abs(basePos - currentPos);
    }
  }

  return { rematches, sameZone, deviation };
}

function optimizeFirstRoundOrder(orderByEntryIdx, entries, firstRoundPairs) {
  const baseOrder = [...orderByEntryIdx];
  let bestOrder = [...orderByEntryIdx];
  let bestCost = evaluateFirstRoundCost(bestOrder, entries, baseOrder, firstRoundPairs);

  // Local search by pairwise swaps: prioritize no rematch, then same-zone, then minimal movement.
  let improved = true;
  while (improved) {
    improved = false;
    let localBestOrder = bestOrder;
    let localBestCost = bestCost;

    for (let i = 0; i < bestOrder.length - 1; i += 1) {
      for (let j = i + 1; j < bestOrder.length; j += 1) {
        const candidate = [...bestOrder];
        const temp = candidate[i];
        candidate[i] = candidate[j];
        candidate[j] = temp;

        const cost = evaluateFirstRoundCost(candidate, entries, baseOrder, firstRoundPairs);
        if (compareCosts(cost, localBestCost) < 0) {
          localBestCost = cost;
          localBestOrder = candidate;
          improved = true;
        }
      }
    }

    if (improved) {
      bestOrder = localBestOrder;
      bestCost = localBestCost;
    }
  }

  return { order: bestOrder, cost: bestCost };
}


function seedingPositions(size, entries = []) {
  const baseOrder = classicSeedingPositions(size);
  if (!Array.isArray(entries) || entries.length <= 1 || !entries.some((entry) => entry?.group_id != null)) {
    return { order: baseOrder, byePositions: new Set(), warnings: [] };
  }

  const total = entries.length;
  const byes = size - total;
  const warnings = [];
  const byeSeedSlots = baseOrder.slice(0, byes);
  const byePositions = buildByePositions(baseOrder, byes);
  const half = size / 2;

  // Do NOT re-sort; entries are already sorted best-to-worst from rankQualified
  const ranked = entries.map((entry, index) => ({
    ...entry,
    __idx: index,
    __groupKey: entry?.group_id == null ? `__ungrouped_${index}` : String(entry.group_id),
  }));

  // Group info
  const labelByGroup = new Map();
  ranked.forEach((entry) => {
    if (!labelByGroup.has(entry.__groupKey)) {
      labelByGroup.set(entry.__groupKey, entry?.group_name != null ? String(entry.group_name) : String(entry.__groupKey));
    }
  });

  // Find "real" match pairings (both positions are non-bye)
  const realMatchPairs = buildFirstRoundPairs(size, byePositions);

 // Build result: position for each entry
  const resultOrder = new Array(total);

  // Step 1: Assign bye positions to best seeds (entries[0..byes-1])
  for (let i = 0; i < byes; i += 1) {
    resultOrder[i] = byeSeedSlots[i];
  }

  // Step 2: For non-bye entries, place best vs worst in real match pairs when possible
  const nonByeEntries = ranked.slice(byes);
  const nonByeUsed = new Set();
  
  //Track groups in each half for separation
  const groupsFirstHalf = new Set();
  const groupsSecondHalf = new Set();
  for (let i = 0; i < byes; i += 1) {
    const slot = byeSeedSlots[i];
    const group = ranked[i].__groupKey;
    if (slot < half) groupsFirstHalf.add(group);
    else groupsSecondHalf.add(group);
  }

  // Try to fill real match pairs with zigzag (best vs worst)
  let leftIdx = 0;
  let rightIdx = nonByeEntries.length - 1;
  
  for (const [pos0, pos1] of realMatchPairs) {
    if (leftIdx > rightIdx) break;

    // Pick two entries (best and worst available)
    const leftEntry = nonByeEntries[leftIdx];
    const rightEntry = nonByeEntries[rightIdx];
    
    // Assign respecting zone separation
    let left0 = leftEntry;
    let left1 = rightEntry;
    
    // Which position is in first half?
    const pos0InFirst = pos0 < half;
    const pos1InFirst = pos1 < half;

    // Try to place without group conflicts
    const leftGroup = left0.__groupKey;
    const rightGroup = left1.__groupKey;

    let canPlace0Left = true, canPlace1Right = true;
    
    if (pos0InFirst && groupsFirstHalf.has(leftGroup)) canPlace0Left = false;
    if (pos0 >= half && groupsSecondHalf.has(leftGroup)) canPlace0Left = false;
    if (pos1InFirst && groupsFirstHalf.has(rightGroup)) canPlace1Right = false;
    if (pos1 >= half && groupsSecondHalf.has(rightGroup)) canPlace1Right = false;

    // If we can't place both, try swapping
    if (!canPlace0Left || !canPlace1Right) {
      canPlace0Left = true, canPlace1Right = true;
      let temp = left0;
      left0 = left1;
      left1 = temp;

      if (pos0InFirst && groupsFirstHalf.has(left0.__groupKey)) canPlace0Left = false;
      if (pos0 >= half && groupsSecondHalf.has(left0.__groupKey)) canPlace0Left = false;
      if (pos1InFirst && groupsFirstHalf.has(left1.__groupKey)) canPlace1Right = false;
      if (pos1 >= half && groupsSecondHalf.has(left1.__groupKey)) canPlace1Right = false;
    }

    // If still can't place, emit warning
    if (!canPlace0Left || !canPlace1Right) {
      const toPlace = canPlace0Left ? left0 : left1;
      const groupLabel = labelByGroup.get(toPlace.__groupKey) || String(toPlace.__groupKey);
      if (!warnings.some((w) => w.includes(groupLabel))) {
        warnings.push(`No fue posible separar completamente a todas las parejas de Zona ${groupLabel} en el cuadro.`);
      }
    }

    // Assign positions
    resultOrder[left0.__idx] = pos0;
    resultOrder[left1.__idx] = pos1;
    
    // Update group tracking
    if (pos0 < half) groupsFirstHalf.add(left0.__groupKey);
    else groupsSecondHalf.add(left0.__groupKey);
    if (pos1 < half) groupsFirstHalf.add(left1.__groupKey);
    else groupsSecondHalf.add(left1.__groupKey);

    leftIdx += 1;
    rightIdx -= 1;
  }

  // Assign remaining entries to remaining non-bye positions
  const usedPositions = new Set();
  resultOrder.forEach((pos) => { if (pos != null) usedPositions.add(pos); });
  
  const remainingPositions = baseOrder.filter((pos) => !usedPositions.has(pos) && !byePositions.has(pos));
  let remainPosIdx = 0;

  for (let i = 0; i < nonByeEntries.length; i += 1) {
    if (resultOrder[byes + i] === undefined) {
      if (remainPosIdx < remainingPositions.length) {
        resultOrder[byes + i] = remainingPositions[remainPosIdx];
        remainPosIdx += 1;
      }
    }
  }

  const finalOrder = resultOrder.filter((pos) => pos != null);
  const optimized = optimizeFirstRoundOrder(finalOrder, ranked, realMatchPairs);

  if (optimized.cost.rematches > 0) {
    warnings.push(
      `No fue posible evitar todos los rematches de zona en primera ronda (${optimized.cost.rematches} cruce(s)).`
    );
  }

  return {
    order: optimized.order,
    byePositions,
    warnings,
  };
}

function rankQualified(standingsRows, tournament) {
  return standingsRows
    .map((row) => ({
      ...row,
      score: getRankingScore({ points_zona: row.points }, tournament),
    }))
    .sort(compareSeeding);
}

module.exports = { getRankingScore, rankQualified, seedingPositions, classicSeedingPositions };
