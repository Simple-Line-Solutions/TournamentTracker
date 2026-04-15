/**
 * Quick simulation to validate the new seeding algorithm
 * for various pair counts: 6, 8, 11, 16, 24.
 */
const { seedingPositions, classicSeedingPositions } = require('./Backend/src/logic/seeding');
const { seedEntries } = require('./Backend/src/logic/bracket');
const { buildZoneDistribution, nextPowerOfTwo } = require('./Backend/src/logic/zonas');

function buildTestEntries(totalPairs, clasificanZona3, clasificanZona4) {
  const dist = buildZoneDistribution(totalPairs);
  const zones = dist.map((size, i) => ({
    id: i + 1,
    name: String.fromCharCode(65 + i), // A, B, C...
    size,
    clasifican: size === 3 ? clasificanZona3 : clasificanZona4,
  }));

  const entries = [];
  for (const zone of zones) {
    for (let pos = 1; pos <= zone.clasifican; pos += 1) {
      entries.push({
        pair_id: entries.length + 1,
        group_id: zone.id,
        group_name: `Zona ${zone.name}`,
        position: pos,
        points: (zone.clasifican - pos + 1) * 3,
        games_won: 6 - pos,
        games_lost: pos,
      });
    }
  }

  // Sort by position then by points descending (simulating rankQualified)
  entries.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return b.points - a.points;
  });

  return { entries, zones };
}

function describeSlot(entry) {
  if (!entry) return 'BYE';
  return `${entry.position}°${entry.group_name.replace('Zona ', 'Z')} (p${entry.pair_id})`;
}

function runTest(totalPairs, clasificanZona3, clasificanZona4) {
  const { entries, zones } = buildTestEntries(totalPairs, clasificanZona3, clasificanZona4);
  const bracketSize = nextPowerOfTwo(entries.length);
  const byes = bracketSize - entries.length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${totalPairs} parejas, zonas=[${zones.map(z => z.size).join(',')}], clasifican 3→${clasificanZona3}, 4→${clasificanZona4}`);
  console.log(`  Total clasificados: ${entries.length}, Bracket: ${bracketSize}, BYEs: ${byes}`);
  console.log(`${'='.repeat(60)}`);

  // Input entries in seeding order
  console.log('\nEntradas (orden de seeding):');
  entries.forEach((e, i) => {
    console.log(`  [${i}] ${describeSlot(e)} pts=${e.points}`);
  });

  // Run seedEntries (which calls seedingPositions internally)
  const result = seedEntries(entries);

  console.log(`\nBracket (${bracketSize} slots):`);
  for (let i = 0; i < bracketSize; i += 2) {
    const e0 = result.slots[i];
    const e1 = result.slots[i + 1];
    const isBye0 = result.byePositions.has(i);
    const isBye1 = result.byePositions.has(i + 1);
    const label0 = isBye0 ? 'BYE' : describeSlot(e0);
    const label1 = isBye1 ? 'BYE' : describeSlot(e1);
    const matchNum = Math.floor(i / 2) + 1;
    console.log(`  Match ${matchNum}: [${String(i).padStart(2)}] ${label0.padEnd(22)} vs [${String(i + 1).padStart(2)}] ${label1}`);
  }

  if (result.warnings.length > 0) {
    console.log('\n  WARNINGS:');
    result.warnings.forEach(w => console.log(`    ⚠ ${w}`));
  }

  // Validate rules
  const errors = [];

  // Rule 1: BYEs must be opposite the top N seeds
  const byeSet = result.byePositions;
  for (let i = 0; i < byes; i += 1) {
    const entry = entries[i];
    let entryPos = null;
    for (let s = 0; s < bracketSize; s += 1) {
      if (result.slots[s] === entry) { entryPos = s; break; }
    }
    if (entryPos == null) {
      errors.push(`Seed ${i} (${describeSlot(entry)}) not found in bracket!`);
      continue;
    }
    const opponentPos = entryPos % 2 === 0 ? entryPos + 1 : entryPos - 1;
    if (!byeSet.has(opponentPos)) {
      errors.push(`Seed ${i} (${describeSlot(entry)}) at pos ${entryPos} does NOT have BYE as opponent (pos ${opponentPos})`);
    }
  }

  // Rule 2: Check same-zone R1 clashes
  let sameZoneR1 = 0;
  for (let i = 0; i < bracketSize; i += 2) {
    const e0 = result.slots[i];
    const e1 = result.slots[i + 1];
    if (e0 && e1 && e0.group_id === e1.group_id) {
      sameZoneR1 += 1;
      errors.push(`Same-zone R1 clash: Match ${Math.floor(i / 2) + 1} — ${describeSlot(e0)} vs ${describeSlot(e1)}`);
    }
  }

  // Rule 3: 1st place teams should not face each other in R1
  for (let i = 0; i < bracketSize; i += 2) {
    const e0 = result.slots[i];
    const e1 = result.slots[i + 1];
    if (e0?.position === 1 && e1?.position === 1) {
      errors.push(`Two 1st-place teams in R1! Match ${Math.floor(i / 2) + 1}: ${describeSlot(e0)} vs ${describeSlot(e1)}`);
    }
  }

  if (errors.length > 0) {
    console.log('\n  ❌ ERRORS:');
    errors.forEach(e => console.log(`    ${e}`));
  } else {
    console.log('\n  ✅ All rules passed!');
  }
}

// Test cases
runTest(6, 3, 3);   // 2 zones of 3, all classify → 6 entries, bracket 8, 2 byes
runTest(8, 3, 4);   // 2 zones (one 4, one 4) → clasifican 4+4=8, bracket 8, 0 byes
runTest(11, 3, 4);  // 3 zones (4,4,3) → all qualify → 11, bracket 16, 5 byes
runTest(16, 3, 4);  // 4 zones (4,4,4,4) → all qualify → 16, bracket 16, 0 byes
runTest(24, 3, 4);  // 6 zones (4,4,4,4,4,4) → all qualify → 24, bracket 32, 8 byes
