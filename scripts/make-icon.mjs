// Draws a high-contrast UR Agents robot mark that stays recognizable in Windows Search and the taskbar.
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

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function colorAt(u, v) {
  const navy = [19, 34, 55];
  const teal = [63, 222, 207];
  const orange = [244, 100, 54];
  const ink = [23, 35, 51];
  const white = [255, 239, 218];
  let color = [0, 0, 0, 0];
  const fill = (rgb) => { color = [rgb[0], rgb[1], rgb[2], 255]; };

  // Dark rounded tile gives the mark a clear silhouette on both light and dark taskbars.
  if (sdRoundRect(u, v, 50, 50, 49, 49, 21) <= 0) fill(navy);

  // Antenna and side pads sit behind the head.
  if (sdSegment(u, v, 50, 22, 50, 36) <= 5) fill(ink);
  if (sdSegment(u, v, 50, 22, 50, 36) <= 3.1) fill(teal);
  if (sdCircle(u, v, 50, 19, 7.5) <= 0) fill(ink);
  if (sdCircle(u, v, 50, 19, 5.2) <= 0) fill(teal);
  if (sdRoundRect(u, v, 14, 60, 8, 11, 5) <= 0 || sdRoundRect(u, v, 86, 60, 8, 11, 5) <= 0) fill(ink);
  if (sdRoundRect(u, v, 14, 60, 5.5, 8, 3.5) <= 0 || sdRoundRect(u, v, 86, 60, 5.5, 8, 3.5) <= 0) fill(orange);

  // Heavy outline keeps the robot face distinct at 16 px.
  if (sdRoundRect(u, v, 50, 62, 39, 33, 14) <= 0) fill(ink);
  const face = sdRoundRect(u, v, 50, 60, 34, 29, 12);
  if (face <= 0) {
    const light = Math.max(0, Math.min(1, (36 - v) / 50));
    fill(orange.map((channel, i) => i === 0 || i === 1 ? Math.round(channel + light * (i === 0 ? 20 : 18)) : channel));
  }

  // Eyes and a short mouth make the mark read as a robot rather than a blank app tile.
  if (sdRoundRect(u, v, 39, 56, 3.8, 6.2, 2.5) <= 0 || sdRoundRect(u, v, 61, 56, 3.8, 6.2, 2.5) <= 0) fill(ink);
  if (sdCircle(u, v, 38.3, 53.5, 1.05) <= 0 || sdCircle(u, v, 60.3, 53.5, 1.05) <= 0) fill(white);
  if (sdRoundRect(u, v, 50, 73, 7.2, 2.1, 1.8) <= 0) fill(ink);

  return color;
}

function render(size) {
  const n = size * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x * SS + sx + 0.5) / n) * 100;
          const v = ((y * SS + sy + 0.5) / n) * 100;
          const [r, g, b, a] = colorAt(u, v);
          red += r;
          green += g;
          blue += b;
          alpha += a;
        }
      }
      const i = (y * size + x) * 4;
      const samples = SS * SS;
      out[i] = Math.round(red / samples);
      out[i + 1] = Math.round(green / samples);
      out[i + 2] = Math.round(blue / samples);
      out[i + 3] = Math.round(alpha / samples);
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
