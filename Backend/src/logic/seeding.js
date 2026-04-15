function getRankingScore(pair, tournament) {
  void tournament;
  // Punto de extension para ranking historico: reemplazar esta lectura por
  // logica combinada que consulte ranking acumulado de players.
  // FUTURO (ranking de circuito): cuando exista ranking acumulado, la prioridad
  // de BYE se definira a nivel ZONA (la zona con mejor ranking acumulado "gana"
  // el BYE para su 1ro), no a nivel pareja individual. El 1ro de esa zona recibe
  // el BYE independientemente de si es el mejor o peor clasificado del circuito.
  // Ajustar getRankingScore y/o rankQualified para incorporar esa logica.
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

// ---------------------------------------------------------------------------
// Helpers para determinar en que "cuarto" del bracket cae cada posicion
// y la ronda mas temprana en que dos posiciones pueden cruzarse.
// ---------------------------------------------------------------------------

function getQuarter(pos, size) {
  const q = size / 4;
  if (pos < q) return 0;
  if (pos < q * 2) return 1;
  if (pos < q * 3) return 2;
  return 3;
}

function getHalf(pos, size) {
  return pos < size / 2 ? 0 : 1;
}

function earliestMeetingRound(posA, posB, size) {
  let blockSize = 2;
  let round = 1;
  while (blockSize <= size) {
    const blockA = Math.floor(posA / blockSize);
    const blockB = Math.floor(posB / blockSize);
    if (blockA === blockB) return round;
    blockSize *= 2;
    round += 1;
  }
  return round;
}

// ---------------------------------------------------------------------------
// Evaluar calidad de un placement completo.
// Prioridad: 1) evitar rematches R1, 2) maximizar ronda minima de cruce
// mismo-zona, 3) minimizar desviacion del seeding natural.
// ---------------------------------------------------------------------------

function evaluatePlacement(slots, entries, size, byePositions) {
  const entryBySlot = new Map();
  for (let i = 0; i < entries.length; i += 1) {
    if (slots[i] != null) entryBySlot.set(slots[i], entries[i]);
  }

  let rematches = 0;
  let minZoneRound = Infinity;
  let sameZoneR1 = 0;
  let firstPlaceEarlyMeeting = 0; // penaliza 1ros de zona cruzandose temprano

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const posA = slots[i];
      const posB = slots[j];
      if (posA == null || posB == null) continue;
      const a = entries[i];
      const b = entries[j];
      const round = earliestMeetingRound(posA, posB, size);

      const sameZone = a.group_id != null && b.group_id != null && a.group_id === b.group_id;
      if (sameZone) {
        if (round < minZoneRound) minZoneRound = round;
        if (round === 1) sameZoneR1 += 1;
      }

      // Penalizar 1ros de zona distintas cruzandose antes de semifinal
      if (a.position === 1 && b.position === 1 && !sameZone) {
        const totalRounds = Math.log2(size);
        // Idealmente se cruzan en la final (round = totalRounds)
        // Penalizar segun que tan temprano se cruzan
        const roundsEarly = totalRounds - round;
        if (roundsEarly > 0) firstPlaceEarlyMeeting += roundsEarly;
      }

      if (round === 1) {
        const forbidA = new Set((a.previous_opponents || []).map(Number).filter(Number.isFinite));
        const forbidB = new Set((b.previous_opponents || []).map(Number).filter(Number.isFinite));
        const pA = Number(a.pair_id);
        const pB = Number(b.pair_id);
        if ((Number.isFinite(pB) && forbidA.has(pB)) || (Number.isFinite(pA) && forbidB.has(pA))) {
          rematches += 1;
        }
      }
    }
  }

  if (!Number.isFinite(minZoneRound)) minZoneRound = 999;

  let deviation = 0;
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] != null) deviation += Math.abs(slots[i] - i);
  }

  return { rematches, sameZoneR1, minZoneRound, firstPlaceEarlyMeeting, deviation };
}

function isBetterPlacement(a, b) {
  if (a.rematches !== b.rematches) return a.rematches < b.rematches;
  if (a.sameZoneR1 !== b.sameZoneR1) return a.sameZoneR1 < b.sameZoneR1;
  if (a.firstPlaceEarlyMeeting !== b.firstPlaceEarlyMeeting) return a.firstPlaceEarlyMeeting < b.firstPlaceEarlyMeeting;
  if (a.minZoneRound !== b.minZoneRound) return a.minZoneRound > b.minZoneRound;
  return a.deviation < b.deviation;
}

// ---------------------------------------------------------------------------
// seedingPositions — Algoritmo principal
//
// Reglas (genericas para cualquier cantidad de parejas):
//  1. BYEs a los N mejores seeds.
//  2. 1ros de zona en puntas opuestas de la llave (cuartos distintos cuando
//     el bracket lo permite).
//  3. Parejas de misma zona se crucen lo mas tarde posible.
//  4. Best vs worst en primera ronda real.
//
// FUTURO (ranking de circuito): la prioridad de BYE se definira a nivel zona
// segun el ranking acumulado de la zona, no de la pareja. El 1ro de la zona
// con mejor ranking recibe BYE, sin importar su posicion personal en el circuito.
// ---------------------------------------------------------------------------

function seedingPositions(size, entries = []) {
  const baseOrder = classicSeedingPositions(size);
  if (!Array.isArray(entries) || entries.length <= 1 || !entries.some((e) => e?.group_id != null)) {
    return { order: baseOrder, byePositions: new Set(), warnings: [] };
  }

  const total = entries.length;
  const byes = size - total;
  const warnings = [];
  const byePositions = buildByePositions(baseOrder, byes);
  const half = size / 2;

  // Posiciones de seeding para los que reciben BYE (seeds 1..byes)
  const byeSeedSlots = baseOrder.slice(0, byes);
  // Posiciones reales disponibles (sin BYE) en orden de seeding clasico
  const nonByeSlots = baseOrder.filter((pos) => !byePositions.has(pos)).slice(byes);

  const tagged = entries.map((entry, idx) => ({
    ...entry,
    __idx: idx,
    __groupKey: entry?.group_id == null ? `__ungrouped_${idx}` : String(entry.group_id),
  }));

  const labelByGroup = new Map();
  tagged.forEach((e) => {
    if (!labelByGroup.has(e.__groupKey)) {
      labelByGroup.set(e.__groupKey, e?.group_name != null ? String(e.group_name) : String(e.__groupKey));
    }
  });

  // --- Paso 1: Asignar BYEs a los N mejores seeds (indices 0..byes-1) ---
  const slots = new Array(total).fill(null);
  for (let i = 0; i < byes; i += 1) {
    slots[i] = byeSeedSlots[i];
  }

  // --- Paso 2: Recopilar 1ros de zona (entre los que NO tienen bye) ---
  const firsts = [];
  const rest = [];
  const seenZoneFirsts = new Set();
  for (let i = byes; i < total; i += 1) {
    const e = tagged[i];
    if (e.position === 1 && !seenZoneFirsts.has(e.__groupKey)) {
      seenZoneFirsts.add(e.__groupKey);
      firsts.push(i);
    } else {
      rest.push(i);
    }
  }

  // --- Paso 3: Distribuir 1ros en cuartos/mitades opuestas para separar ---
  // Agrupar posiciones reales libres por cuarto
  const usedSlots = new Set(slots.filter((s) => s != null));
  const freeNonBye = baseOrder.filter((pos) => !byePositions.has(pos) && !usedSlots.has(pos));

  // Agrupar por cuarto (o mitad si bracket < 8)
  const buckets = size >= 8
    ? [[], [], [], []]
    : [[], []];

  freeNonBye.forEach((pos) => {
    if (size >= 8) {
      buckets[getQuarter(pos, size)].push(pos);
    } else {
      buckets[getHalf(pos, size)].push(pos);
    }
  });

  // Determinar que cuartos ya estan "ocupados" por bye-seeds de cada zona
  const quartersByGroup = new Map();
  for (let i = 0; i < byes; i += 1) {
    const key = tagged[i].__groupKey;
    const q = size >= 8 ? getQuarter(slots[i], size) : getHalf(slots[i], size);
    if (!quartersByGroup.has(key)) quartersByGroup.set(key, new Set());
    quartersByGroup.get(key).add(q);
  }

  // Asignar 1ros de zona a cuartos donde su zona aun no tiene presencia
  // y donde no haya otro 1ro ya colocado (para maximizar separacion)
  const firstsInBucket = new Set(); // buckets que ya tienen un 1ro
  for (const idx of firsts) {
    const e = tagged[idx];
    const zoneQs = quartersByGroup.get(e.__groupKey) || new Set();

    let bestBucket = -1;
    let bestScore = -Infinity;
    for (let b = 0; b < buckets.length; b += 1) {
      if (buckets[b].length === 0) continue;
      const notInZone = zoneQs.has(b) ? 0 : 1;
      const noFirstHere = firstsInBucket.has(b) ? 0 : 1;
      // Prioridad: (1) sin otro 1ro, (2) sin misma zona, (3) mas slots libres
      const score = noFirstHere * 10000 + notInZone * 1000 + buckets[b].length;
      if (score > bestScore) {
        bestScore = score;
        bestBucket = b;
      }
    }

    if (bestBucket >= 0 && buckets[bestBucket].length > 0) {
      // Pick the first slot in this bucket (highest seeding position available)
      const pos = buckets[bestBucket].shift();
      slots[idx] = pos;
      firstsInBucket.add(bestBucket);
      if (!quartersByGroup.has(e.__groupKey)) quartersByGroup.set(e.__groupKey, new Set());
      quartersByGroup.get(e.__groupKey).add(bestBucket);
    }
  }

  // --- Paso 4: Asignar resto con zigzag best-vs-worst, separando zonas ---
  const unplaced = rest.filter((idx) => slots[idx] == null);
  // Recalcular posiciones libres
  const usedAfterFirsts = new Set(slots.filter((s) => s != null));
  const freeAfterFirsts = baseOrder.filter(
    (pos) => !byePositions.has(pos) && !usedAfterFirsts.has(pos)
  );

  // Construir pares de match reales libres
  const realPairs = [];
  const freeSet = new Set(freeAfterFirsts);
  for (let pos = 0; pos < size; pos += 2) {
    const p0 = pos;
    const p1 = pos + 1;
    if (freeSet.has(p0) && freeSet.has(p1)) {
      realPairs.push([p0, p1]);
    }
  }

  // Singles: posiciones libres que no forman par (su oponente ya fue asignado)
  const pairedPositions = new Set();
  realPairs.forEach(([a, b]) => { pairedPositions.add(a); pairedPositions.add(b); });
  const singles = freeAfterFirsts.filter((pos) => !pairedPositions.has(pos));

  // Zigzag: mejores vs peores
  let leftIdx = 0;
  let rightIdx = unplaced.length - 1;
  let pairIdx = 0;

  while (leftIdx <= rightIdx && pairIdx < realPairs.length) {
    const [pos0, pos1] = realPairs[pairIdx];
    pairIdx += 1;

    if (leftIdx === rightIdx) {
      // Solo queda uno
      slots[unplaced[leftIdx]] = pos0;
      leftIdx += 1;
      // pos1 queda libre (sera single si hay mas)
      break;
    }

    const bestEntry = tagged[unplaced[leftIdx]];
    const worstEntry = tagged[unplaced[rightIdx]];

    // Decidir quien va a pos0 y quien a pos1 para minimizar cruces de misma zona
    const bestHalf = getHalf(pos0, size);
    const worstHalf = getHalf(pos1, size);

    const bestZoneQs = quartersByGroup.get(bestEntry.__groupKey) || new Set();
    const worstZoneQs = quartersByGroup.get(worstEntry.__groupKey) || new Set();

    const bestQ0 = size >= 8 ? getQuarter(pos0, size) : getHalf(pos0, size);
    const bestQ1 = size >= 8 ? getQuarter(pos1, size) : getHalf(pos1, size);

    // Prefer: best entry goes where its zone has less presence
    const conflictNormal = (bestZoneQs.has(bestQ0) ? 1 : 0) + (worstZoneQs.has(bestQ1) ? 1 : 0);
    const conflictSwapped = (worstZoneQs.has(bestQ0) ? 1 : 0) + (bestZoneQs.has(bestQ1) ? 1 : 0);

    let assignBest, assignWorst;
    if (conflictNormal <= conflictSwapped) {
      assignBest = pos0;
      assignWorst = pos1;
    } else {
      assignBest = pos1;
      assignWorst = pos0;
    }

    slots[unplaced[leftIdx]] = assignBest;
    slots[unplaced[rightIdx]] = assignWorst;

    const bQ = size >= 8 ? getQuarter(assignBest, size) : getHalf(assignBest, size);
    const wQ = size >= 8 ? getQuarter(assignWorst, size) : getHalf(assignWorst, size);
    if (!quartersByGroup.has(bestEntry.__groupKey)) quartersByGroup.set(bestEntry.__groupKey, new Set());
    if (!quartersByGroup.has(worstEntry.__groupKey)) quartersByGroup.set(worstEntry.__groupKey, new Set());
    quartersByGroup.get(bestEntry.__groupKey).add(bQ);
    quartersByGroup.get(worstEntry.__groupKey).add(wQ);

    leftIdx += 1;
    rightIdx -= 1;
  }

  // Asignar sobrantes a singles
  let singleIdx = 0;
  const stillUnplaced = unplaced.filter((idx) => slots[idx] == null);
  for (const idx of stillUnplaced) {
    if (singleIdx < singles.length) {
      slots[idx] = singles[singleIdx];
      singleIdx += 1;
    }
  }

  // Fallback: cualquier posicion libre
  if (stillUnplaced.some((idx) => slots[idx] == null)) {
    const allUsed = new Set(slots.filter((s) => s != null));
    const anyFree = baseOrder.filter((pos) => !byePositions.has(pos) && !allUsed.has(pos));
    let fi = 0;
    for (const idx of stillUnplaced) {
      if (slots[idx] == null && fi < anyFree.length) {
        slots[idx] = anyFree[fi];
        fi += 1;
      }
    }
  }

  // --- Paso 5: Optimizacion local por swaps (solo entre no-bye entries) ---
  const realMatchPairs = buildFirstRoundPairs(size, byePositions);
  let bestCost = evaluatePlacement(slots, tagged, size, byePositions);
  let improved = true;
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (improved && iterations < MAX_ITERATIONS) {
    iterations += 1;
    improved = false;
    for (let i = byes; i < total - 1; i += 1) {
      for (let j = i + 1; j < total; j += 1) {
        const candidate = [...slots];
        const tmp = candidate[i];
        candidate[i] = candidate[j];
        candidate[j] = tmp;
        const cost = evaluatePlacement(candidate, tagged, size, byePositions);
        if (isBetterPlacement(cost, bestCost)) {
          bestCost = cost;
          slots[i] = candidate[i];
          slots[j] = candidate[j];
          improved = true;
        }
      }
    }
  }

  // --- Warnings ---
  if (bestCost.rematches > 0) {
    warnings.push(
      `No fue posible evitar todos los rematches de zona en primera ronda (${bestCost.rematches} cruce(s)).`
    );
  }
  if (bestCost.sameZoneR1 > 0) {
    warnings.push(
      `Hay ${bestCost.sameZoneR1} cruce(s) de misma zona en primera ronda que no se pudieron evitar.`
    );
  }

  return {
    order: slots,
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
