// Renders the app icon (same design as web/icon.svg) to PNG without dependencies: `node scripts/make-icons.ts`.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const GREEN = [0x2f, 0x6f, 0x4f];
const CREAM = [0xf7, 0xf4, 0xee];
const LEAF = [0x9f, 0xd3, 0x6a];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

// Colour of a point in the 512×512 design space; null = transparent.
function sample(x: number, y: number, rounded: boolean): number[] | null {
  if (rounded) {
    const r = 112;
    const cx = Math.min(Math.max(x, r), 512 - r);
    const cy = Math.min(Math.max(y, r), 512 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  }
  // Leaf: lens shape between two circles, rotated up-right from the plate centre.
  const lx = x - 326, ly = y - 150;
  const a = -0.62;
  const u = lx * Math.cos(a) - ly * Math.sin(a), v = lx * Math.sin(a) + ly * Math.cos(a);
  if (u * u / (82 * 82) + v * v / (34 * 34) <= 1) return LEAF;
  const d = Math.hypot(x - 256, y - 268);
  if (d <= 92) return CREAM;
  if (Math.abs(d - 150) <= 14) return CREAM;
  return GREEN;
}

function render(size: number, rounded: boolean): Buffer {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(((px + (sx + 0.5) / SS) * 512) / size, ((py + (sy + 0.5) / SS) * 512) / size, rounded);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const n = SS * SS;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = (a / n) * 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// iOS applies its own rounding and Android masks maskable icons, so the PNGs are full-bleed squares.
for (const size of [180, 192, 512]) writeFileSync(new URL(`../web/icon-${size}.png`, import.meta.url), render(size, false));
console.log("icons written");
