// Build deterministic ZIPs from the game folders currently served by this site.
// Run: node scripts/build-game-downloads.mjs [--check]
// No dependencies, remote requests, original packages or review data are used.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const library = path.join(repo, 'playablebatch1');
const gameRoot = path.join(library, 'games');
const output = path.join(library, 'downloads');
const manifestFile = path.join(library, 'game-downloads.js');
const check = process.argv.includes('--check');
assert(process.argv.slice(2).every(arg => arg === '--check'), 'Only --check is supported');
const page = fs.readFileSync(path.join(library, 'index.html'), 'utf8');
const games = JSON.parse(page.match(/^const games = (\[.*\]);$/m)?.[1] || 'null');
assert(Array.isArray(games) && games.length > 0, 'Missing game catalog');
assert.equal(new Set(games.map(game => game.base)).size, games.length, 'Duplicate game folder');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const privateFile = /(?:^|\/)(?:\.[^/]*|node_modules|feedback-tracking|feedback-art-review|tests?|backups?)(?:\/|$)|\.(?:zip|bak)$/i;

function inventory(dir, prefix = '') {
  return fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(entry => {
    const relative = prefix + entry.name;
    assert(!entry.isSymbolicLink(), 'Symlink cannot be packaged: ' + relative);
    assert(!privateFile.test(relative), 'Non-runtime file in game folder: ' + relative);
    assert(!/(?:^|\/)(?:check-|before-)/.test(relative), 'Private QA file in game folder: ' + relative);
    return entry.isDirectory() ? inventory(path.join(dir, entry.name), relative + '/') : [relative];
  });
}

const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  let crc = value;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFolder(base, dir, files) {
  // ZIP32, UTF-8 names, raw DEFLATE and a fixed 1980-01-01 date keep exports
  // reproducible. Already compressed media is stored if DEFLATE isn't smaller.
  assert(files.length < 65535, 'Too many files for ZIP32');
  const local = [], central = [];
  let offset = 0;
  for (const relative of files) {
    const name = Buffer.from(base + '/' + relative);
    const bytes = fs.readFileSync(path.join(dir, relative));
    assert(name.length < 65536 && bytes.length < 0xffffffff, 'ZIP32 entry exceeds size limit');
    const compressed = deflateRawSync(bytes, {level: 9});
    const method = compressed.length < bytes.length ? 8 : 0;
    const data = method === 8 ? compressed : bytes;
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(0x21, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + data.length;
    assert(offset < 0xffffffff, 'ZIP32 archive exceeds size limit');
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

if (!check) fs.mkdirSync(output, {recursive: true});
const manifest = {};
let totalFiles = 0, totalBytes = 0, changed = 0;
for (const game of games) {
  assert(/^[A-Za-z0-9_-]+$/.test(game.base), 'Unsafe game folder');
  assert(/^\d+b?$/.test(String(game.number)), 'Unsafe game number');
  assert.equal(game.src, '/playablebatch1/games/' + game.base + '/game.html', 'Unexpected game source');
  const dir = path.join(gameRoot, game.base);
  const files = inventory(dir);
  assert(files.includes('game.html') && files.includes('game.config.json'), 'Incomplete game folder: ' + game.base);
  const bytes = zipFolder(game.base, dir, files);
  const filename = String(game.number).padStart(2, '0') + '-' + game.base + '.zip';
  const destination = path.join(output, filename);
  assert(bytes.length < 100 * 1024 * 1024, 'GitHub file-size limit exceeded');
  if (check) {
    assert(fs.existsSync(destination), 'Missing download: ' + filename);
    assert(bytes.equals(fs.readFileSync(destination)), 'Stale download: ' + filename + '; rebuild downloads before publishing');
  } else if (!fs.existsSync(destination) || !bytes.equals(fs.readFileSync(destination))) {
    fs.writeFileSync(destination, bytes);
    changed++;
  }
  manifest[game.base] = {url: '/playablebatch1/downloads/' + filename, filename, bytes: bytes.length, files: files.length, sha256: sha256(bytes)};
  totalFiles += files.length;
  totalBytes += bytes.length;
}
const manifestText = '// Generated by scripts/build-game-downloads.mjs. Rebuild after changing game files.\nwindow.PlayableGameDownloads = ' + JSON.stringify(manifest, null, 2) + ';\n';
if (check) assert.equal(fs.readFileSync(manifestFile, 'utf8'), manifestText, 'Stale download catalog');
else if (!fs.existsSync(manifestFile) || fs.readFileSync(manifestFile, 'utf8') !== manifestText) fs.writeFileSync(manifestFile, manifestText);
console.log(JSON.stringify({checked: check, games: games.length, files: totalFiles, zipBytes: totalBytes, rebuiltArchives: changed}));
