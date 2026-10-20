// Draws the ur-agents mark (a white vinyl-toy block with two eyes) and writes build/icon.ico + build/icon.png.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SS = 4;

/** Distance from a point to a rounded rectangle (negative inside). */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function render(size) {
  const n = size * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = 0;
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x * SS + sx + 0.5) / n) * 100;
          const v = ((y * SS + sy + 0.5) / n) * 100;
          if (sdRoundRect(u, v, 50, 50, 46, 46, 22) > 0) continue;
          let col = 244 - Math.max(0, (u + v - 120) / 80) * 34;
          if (sdRoundRect(u, v, 35, 44, 5.2, 12, 5.2) < 0 || sdRoundRect(u, v, 65, 44, 5.2, 12, 5.2) < 0) col = 12;
          c += col;
          hit++;
        }
      }
      const i = (y * size + x) * 4;
      const v = hit ? Math.round(c / hit) : 0;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = Math.round((hit / (SS * SS)) * 255);
    }
  }
  return out;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const images = SIZES.map((size) => ({ size, data: png(size, render(size)) }));
const head = Buffer.alloc(6);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(images.length, 4);
let offset = 6 + images.length * 16;
const dir = images.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e[0] = size >= 256 ? 0 : size;
  e[1] = size >= 256 ? 0 : size;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});

const dest = path.resolve('build');
fs.mkdirSync(dest, { recursive: true });
fs.writeFileSync(path.join(dest, 'icon.ico'), Buffer.concat([head, ...dir, ...images.map((i) => i.data)]));
fs.writeFileSync(path.join(dest, 'icon.png'), images[images.length - 1].data);
console.log('icon written to build/');
