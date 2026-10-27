import fs from 'node:fs/promises';

const file = new URL('../src/room-v10-surfaces.json', import.meta.url);
const data = JSON.parse(await fs.readFile(file, 'utf8'));
const {width, height, step, minX, minZ, floorY, clearanceRadius} = data;
// Include the outer front walking lane as well as the desk approach.
const region = {minX: 2, maxX: 4.56, minZ: 1.8, maxZ: 5.4};
const samplingMargin = .03;
const disk = [], reach = Math.ceil((clearanceRadius + samplingMargin) / step);
for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
  if (Math.hypot(dx * step, dz * step) <= clearanceRadius + samplingMargin) disk.push([dx, dz]);
}
const floor = (column, row) => {
  if (column < 0 || row < 0 || column >= width || row >= height) return false;
  const code = data.topRows[row].slice(column * 3, column * 3 + 3);
  return code !== '---' && Math.abs(parseInt(code, 36) / 1000 - floorY) <= .045;
};
let opened = 0, closed = 0;
data.walkRows = data.walkRows.map((line, row) => [...line].map((cell, column) => {
  const x = minX + column * step, z = minZ + row * step;
  if (x < region.minX || x > region.maxX || z < region.minZ || z > region.maxZ) return cell;
  // The runtime checks all four surrounding cells as well. Keep the actual
  // player radius plus a small corner guard, rather than the oversized buffer.
  const next = disk.every(([dx, dz]) => floor(column + dx, row + dz)) ? '1' : '0';
  if (cell === '0' && next === '1') opened++;
  if (cell === '1' && next === '0') closed++;
  return next;
}).join(''));
data.collisionRefinements = [...(data.collisionRefinements || []).filter(entry => entry.name !== 'cashier-desk'), {name: 'cashier-desk', bounds: region, clearanceRadius, samplingMargin}];
await fs.writeFile(file, `${JSON.stringify(data)}\n`);
console.log(`Refined desk clearance: ${opened} floor cells opened, ${closed} closed; furniture and other room collisions retained.`);
