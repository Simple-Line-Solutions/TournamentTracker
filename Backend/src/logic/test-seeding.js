const { rankQualified } = require('./seeding');
const { buildSlots } = require('./bracket');

// Test data: 3 zones, 2 qualified each
const testData = [
  { pair_id: 1, points: 6, games_won: 4, games_lost: 2, position: 1, group_id: 1 },
  { pair_id: 2, points: 3, games_won: 3, games_lost: 3, position: 2, group_id: 1 },
  { pair_id: 3, points: 6, games_won: 4, games_lost: 2, position: 1, group_id: 2 },
  { pair_id: 4, points: 3, games_won: 3, games_lost: 3, position: 2, group_id: 2 },
  { pair_id: 5, points: 6, games_won: 4, games_lost: 2, position: 1, group_id: 3 },
  { pair_id: 6, points: 3, games_won: 3, games_lost: 3, position: 2, group_id: 3 },
];

const tournament = { id: 1 };

const result = rankQualified(testData, tournament);

console.log('Seeding order:');
result.forEach((pair, idx) => {
  console.log(`${idx + 1}. Pair ${pair.pair_id} from Zone ${pair.group_id}`);
});

const fiveQualified = [
  { pair_id: 11, points: 6, games_won: 10, games_lost: 4, position: 1, group_id: 1, group_name: 'A' },
  { pair_id: 21, points: 6, games_won: 9, games_lost: 5, position: 1, group_id: 2, group_name: 'B' },
  { pair_id: 12, points: 3, games_won: 8, games_lost: 7, position: 2, group_id: 1, group_name: 'A' },
  { pair_id: 22, points: 3, games_won: 7, games_lost: 7, position: 2, group_id: 2, group_name: 'B' },
  { pair_id: 13, points: 1, games_won: 5, games_lost: 9, position: 3, group_id: 1, group_name: 'A' },
];

const rankedFive = rankQualified(fiveQualified, tournament);
console.log('\n Ranked order (best to worst):', rankedFive.map((r) => `Pair ${r.pair_id} (${r.points}pts)`).join(', '));

const seededFive = buildSlots(rankedFive);

console.log('\nScenario: 5 qualified into bracket of 8');
console.log('Slots:', seededFive.slots);
console.log('Bye positions:', [...seededFive.byePositions].sort((a, b) => a - b));

// Find active (non-bye) matchups
const activeMatchups = [];
for (let i = 0; i < seededFive.slots.length; i += 2) {
  const left = seededFive.slots[i];
  const right = seededFive.slots[i + 1];
  if (left != null && right != null) {
    activeMatchups.push({
      pos: `${i}-${i + 1}`,
      left: `Pair ${left}`,
      right: `Pair ${right}`,
    });
  }
}

console.log('\nActive matchups in first round:');
activeMatchups.forEach((m) => console.log(`  ${m.left} vs ${m.right} (positions ${m.pos})`));

// Validate business rules
const byeSeeds = rankedFive.slice(0, 3); // Best 3 get bye
const byeSeedsPlaced = byeSeeds.every((seed) => {
  return seededFive.slots.includes(seed.pair_id);
});

const hasCorrectByeCount = seededFive.byePositions.size === 3;

// With byes, only non-bye pairs meet. Verify they don't cross same-zone in first round if possible
let samezoneInFirstRound = 0;
for (const m of activeMatchups) {
  const leftId = parseInt(m.left.split(' ')[1]);
  const rightId = parseInt(m.right.split(' ')[1]);
  const leftRank = rankedFive.findIndex((p) => p.pair_id === leftId);
  const rightRank = rankedFive.findIndex((p) => p.pair_id === rightId);
  const leftZone = rankedFive[leftRank]?.group_id;
  const rightZone = rankedFive[rightRank]?.group_id;
  if (leftZone === rightZone) samezoneInFirstRound += 1;
}

const passesBusinessRules =
  hasCorrectByeCount &&
  byeSeedsPlaced &&
  activeMatchups.length >= 1 &&
  samezoneInFirstRound === 0;

console.log('\n✓ 3 bye positions allocated:', hasCorrectByeCount);
console.log('✓ Best 3 seeds have bye:', byeSeedsPlaced);
console.log('✓ At least 1 active matchup:', activeMatchups.length >= 1);
console.log('✓ No same-zone matchups in first round:', samezoneInFirstRound === 0);

console.log('\nPasses 7-pair business rules:', passesBusinessRules);

if (!passesBusinessRules) {
  throw new Error(`Unexpected seeding for 7-pair scenario: ${JSON.stringify(seededFive.slots)}`);
}

const tenQualified = [
  { pair_id: 101, points: 6, games_won: 12, games_lost: 6, position: 1, group_id: 1, group_name: 'A', previous_opponents: [103, 104] },
  { pair_id: 201, points: 6, games_won: 11, games_lost: 6, position: 1, group_id: 2, group_name: 'B', previous_opponents: [202, 203] },
  { pair_id: 301, points: 6, games_won: 10, games_lost: 6, position: 1, group_id: 3, group_name: 'C', previous_opponents: [302, 303] },
  { pair_id: 102, points: 4, games_won: 10, games_lost: 8, position: 2, group_id: 1, group_name: 'A', previous_opponents: [101] },
  { pair_id: 202, points: 4, games_won: 9, games_lost: 8, position: 2, group_id: 2, group_name: 'B', previous_opponents: [201, 203] },
  { pair_id: 302, points: 4, games_won: 9, games_lost: 9, position: 2, group_id: 3, group_name: 'C', previous_opponents: [301, 303] },
  { pair_id: 103, points: 2, games_won: 8, games_lost: 9, position: 3, group_id: 1, group_name: 'A', previous_opponents: [101, 104] },
  { pair_id: 203, points: 2, games_won: 7, games_lost: 9, position: 3, group_id: 2, group_name: 'B', previous_opponents: [201, 202] },
  { pair_id: 303, points: 2, games_won: 7, games_lost: 10, position: 3, group_id: 3, group_name: 'C', previous_opponents: [301, 302] },
  { pair_id: 104, points: 0, games_won: 5, games_lost: 12, position: 4, group_id: 1, group_name: 'A', previous_opponents: [101, 103] },
];

const rankedTen = rankQualified(tenQualified, tournament);
const seededTen = buildSlots(rankedTen);

const firstRoundTen = [];
for (let i = 0; i < seededTen.slots.length; i += 2) {
  const left = seededTen.slots[i];
  const right = seededTen.slots[i + 1];
  if (left != null && right != null) {
    firstRoundTen.push([left, right]);
  }
}

const priorByPair = new Map(rankedTen.map((row) => [row.pair_id, new Set(row.previous_opponents || [])]));
const rematchesInRoundOne = firstRoundTen.filter(([a, b]) => {
  const setA = priorByPair.get(a) || new Set();
  const setB = priorByPair.get(b) || new Set();
  return setA.has(b) || setB.has(a);
});

console.log('\nScenario: 10 qualified into bracket of 16');
console.log('Slots:', seededTen.slots);
console.log('First round rematches detected:', rematchesInRoundOne.length);

if (rematchesInRoundOne.length > 0) {
  throw new Error(`Unexpected immediate rematches in 10-pair scenario: ${JSON.stringify(rematchesInRoundOne)}`);
}
