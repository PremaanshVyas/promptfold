import zlib from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 128, S = 4; // 4x supersampling
const teal = [47, 127, 122], white = [255, 255, 255];

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// rounded-square coverage (radius r), in 128-space
function inRounded(x, y, r) {
  const lo = r, hiX = SIZE - r, hiY = SIZE - r;
  if (x >= lo && x <= hiX) return y >= 0 && y <= SIZE;
  if (y >= lo && y <= hiY) return x >= 0 && x <= SIZE;
  const cx = x < lo ? lo : hiX, cy = y < lo ? lo : hiY;
  return Math.hypot(x - cx, y - cy) <= r;
}
const arrow = [[40, 88, 86, 42], [58, 42, 86, 42], [86, 42, 86, 70]];
function onArrow(x, y, hw) {
  for (const [ax, ay, bx, by] of arrow) if (distSeg(x, y, ax, ay, bx, by) <= hw) return true;
  return false;
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter byte
  for (let x = 0; x < SIZE; x++) {
    let bg = 0, fg = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
      if (inRounded(px, py, 28)) { bg++; if (onArrow(px, py, 6)) fg++; }
    }
    const n = S * S, bgA = bg / n, fgA = fg / n;
    const r = teal[0] * (1 - fgA) + white[0] * fgA;
    const g = teal[1] * (1 - fgA) + white[1] * fgA;
    const b = teal[2] * (1 - fgA) + white[2] * fgA;
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = Math.round(bgA * 255);
  }
}
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type), crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync("icons/icon-128.png", png);
console.log("wrote icons/icon-128.png");
