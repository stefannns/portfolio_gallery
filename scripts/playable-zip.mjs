// Deterministic ZIP32 encoder shared by individual and batch exports.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';

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

export function makeZip(entries) {
  // ZIP32, UTF-8 names, raw DEFLATE and a fixed 1980-01-01 date keep exports
  // reproducible. Already compressed media is stored if DEFLATE isn't smaller.
  assert(entries.length < 65535, 'Too many files for ZIP32');
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const directory = entry.name.endsWith('/');
    const bytes = directory ? Buffer.alloc(0) : entry.data;
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
    if(directory) record.writeUInt32LE(0x10,38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + data.length;
    assert(offset < 0xffffffff, 'ZIP32 archive exceeds size limit');
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function zipFolder(base,dir,files){
 return makeZip(files.map(relative=>({name:base+'/'+relative,data:relative.endsWith('/')?Buffer.alloc(0):fs.readFileSync(path.join(dir,relative))})));
}
