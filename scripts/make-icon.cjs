const zlib = require("zlib");
const fs = require("fs");

const S = 1024;
const px = Buffer.alloc(S * S * 4);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// 圆角矩形有符号距离
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

// 线段距离（用于放大镜手柄）
function sdSegment(px_, py_, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px_ - ax;
  const wy = py_ - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  const dx = wx - vx * t;
  const dy = wy - vy * t;
  return Math.sqrt(dx * dx + dy * dy);
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;

    // 背景：圆角方块 + 对角渐变
    const d = sdRoundRect(x, y, S / 2, S / 2, S / 2 - 8, S / 2 - 8, 224);
    const bgA = smooth(1.6, -1.6, d);
    const g = clamp((x + y) / (2 * S), 0, 1);
    const br = Math.round(122 + (75 - 122) * g);
    const bg = Math.round(162 + (96 - 162) * g);
    const bb = Math.round(255 + (224 - 255) * g);

    // 放大镜：圆环
    const cx = 462;
    const cy = 452;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ringOuter = smooth(246, 238, dist);
    const ringInner = smooth(176, 184, dist);
    const ring = ringOuter * ringInner;

    // 手柄
    const handle = smooth(46, 38, sdSegment(x, y, 645, 635, 806, 796));

    const glyph = Math.max(ring, handle);

    const bgAlpha = bgA * 255;
    let r = br;
    let gg = bg;
    let b = bb;

    if (glyph > 0) {
      const t = glyph;
      r = Math.round(r * (1 - t) + 255 * t);
      gg = Math.round(gg * (1 - t) + 255 * t);
      b = Math.round(b * (1 - t) + 255 * t);
    }

    px[i] = r;
    px[i + 1] = gg;
    px[i + 2] = b;
    px[i + 3] = Math.round(bgAlpha);
  }
}

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync(process.argv[2] || "app-icon.png", png);
console.log("icon written", png.length, "bytes");
