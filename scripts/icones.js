// Gera os ícones PNG do app (tela de início do iPhone e Android) sem dependências.
// O desenho é o mesmo do favicon: três barras subindo sobre a tinta azul do Panorama.
//
//   node scripts/icones.js

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/icones/', import.meta.url));
const INK = [0x16, 0x20, 0x3a];
const PAPER = [0xe8, 0xed, 0xf5];
const ACCENT = [0xe3, 0xb8, 0x4a];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filtro "none"
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size);
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** `inset` encolhe o desenho para a área segura dos ícones "maskable" do Android. */
function design(inset = 0) {
  const scale = 1 - inset * 2;
  const bars = [
    { x: 0.22, w: 0.14, top: 0.56 },
    { x: 0.43, w: 0.14, top: 0.38 },
    { x: 0.64, w: 0.14, top: 0.2, color: ACCENT },
  ];
  const base = 0.8;
  return (u, v) => {
    const x = (u - inset) / scale;
    const y = (v - inset) / scale;
    for (const b of bars) if (x >= b.x && x < b.x + b.w && y >= b.top && y < base) return b.color || PAPER;
    return INK;
  };
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}apple-touch-icon.png`, png(180, design()));
writeFileSync(`${OUT}icone-192.png`, png(192, design()));
writeFileSync(`${OUT}icone-512.png`, png(512, design()));
writeFileSync(`${OUT}icone-512-maskable.png`, png(512, design(0.1)));
console.log(`Ícones gerados em ${OUT}`);
