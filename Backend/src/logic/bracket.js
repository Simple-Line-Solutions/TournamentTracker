const { nextPowerOfTwo } = require("./zonas");
const { seedingPositions, classicSeedingPositions } = require("./seeding");

function seedEntries(entries) {
  const total = entries.length;
  const bracketSize = nextPowerOfTwo(total || 2);
  const result = seedingPositions(bracketSize, entries);

  // seedingPositions returns {order, byePositions, warnings}
  // order[entryIdx] = bracket position for that entry
  const seedOrder = Array.isArray(result) ? result : result.order;
  const warnings = result?.warnings || [];
  const byePositions = result?.byePositions || new Set();

  const slots = new Array(bracketSize).fill(null);

  for (let i = 0; i < total; i += 1) {
    const bracketPos = seedOrder[i];
    if (bracketPos != null && bracketPos < bracketSize) {
      slots[bracketPos] = entries[i];
    }
  }

  return { bracketSize, slots, byePositions, warnings };
}

function buildSlots(qualifiedRows) {
  // Este parametro llega desde rankQualified(), con cortes de clasificacion
  // ya aplicados por zona. El orden de entrada define la siembra base.
  const seeded = seedEntries(qualifiedRows);
  return {
    ...seeded,
    slots: seeded.slots.map((row) => (row?.pair_id != null ? row.pair_id : null)),
  };
}

module.exports = { seedingPositions, seedEntries, buildSlots };
