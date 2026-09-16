/**
 * 生成应用图标（打包用）。
 *
 *   npm run icon
 *
 * 为什么用脚本画而不是塞一个二进制：图标是要改的（配色、形状），
 * 而「改了没法复现」的二进制资源最容易被丢在一边。这里纯像素计算，
 * 不引任何图形库，Node 自带的 zlib 就够编码 PNG 了。
 *
 * 产物：build/icon.ico（256×256，PNG 压缩进 ICO 容器）
 * electron-builder 默认就会用 build/icon.ico，不用额外配置。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const SIZE = 256
const OUT_DIR = join(process.cwd(), 'build')

/* ---------- 配色（跟界面主题一个色系） ---------- */

const INK = [180, 83, 42] // --accent
const PAGE = [255, 253, 248]
const LINE = [206, 198, 186]
const HIGHLIGHT = [255, 214, 102]

/* ---------- 画 ---------- */

type Rgb = [number, number, number]

/** 圆角矩形的有符号距离：<0 在内部。用它做抗锯齿，比硬边好看得多 */
function roundedRectSdf(
  x: number,
  y: number,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  radius: number
): number {
  const dx = Math.abs(x - cx) - (halfWidth - radius)
  const dy = Math.abs(y - cy) - (halfHeight - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return Math.min(Math.max(dx, dy), 0) + outside - radius
}

/** 距离 → 覆盖度（0~1），给小半个像素的过渡 */
function coverage(distance: number): number {
  return Math.min(Math.max(0.5 - distance, 0), 1)
}

const pixels = new Uint8Array(SIZE * SIZE * 4)

function blend(index: number, color: Rgb, alpha: number): void {
  if (alpha <= 0) return
  const [r, g, b] = color
  const existing = pixels[index + 3] / 255
  const out = alpha + existing * (1 - alpha)
  pixels[index] = Math.round((r * alpha + pixels[index] * existing * (1 - alpha)) / out)
  pixels[index + 1] = Math.round((g * alpha + pixels[index + 1] * existing * (1 - alpha)) / out)
  pixels[index + 2] = Math.round((b * alpha + pixels[index + 2] * existing * (1 - alpha)) / out)
  pixels[index + 3] = Math.round(out * 255)
}

/** 画一层圆角矩形 */
function drawRoundRect(
  color: Rgb,
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number
): void {
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2
  const halfWidth = (right - left) / 2
  const halfHeight = (bottom - top) / 2

  for (let y = Math.floor(top) - 2; y < Math.ceil(bottom) + 2; y++) {
    for (let x = Math.floor(left) - 2; x < Math.ceil(right) + 2; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
      const alpha = coverage(roundedRectSdf(x + 0.5, y + 0.5, cx, cy, halfWidth, halfHeight, radius))
      blend((y * SIZE + x) * 4, color, alpha)
    }
  }
}

// 底色：圆角方块
drawRoundRect(INK, 0, 0, SIZE, SIZE, 58)
// 纸页
drawRoundRect(PAGE, 56, 40, 200, 216, 10)
// 正文行
for (let i = 0; i < 4; i++) {
  const top = 78 + i * 30
  const width = i === 3 ? 84 : 112
  drawRoundRect(LINE, 76, top, 76 + width, top + 10, 5)
}
// 一行高亮 —— 这个应用干的就是「把读到的钉住」
drawRoundRect(HIGHLIGHT, 76, 138, 188, 150, 6)
drawRoundRect(LINE, 76, 168, 160, 178, 5)

/* ---------- 编码 PNG ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

function encodePng(): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header[8] = 8 // 每通道 8 位
  header[9] = 6 // RGBA
  // 10~12 保持 0：压缩方式 / 滤波方式 / 隔行扫描都用默认

  // 每行前面要加一个滤波类型字节（0 = 不滤波）
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y++) {
    const from = y * SIZE * 4
    raw[y * (SIZE * 4 + 1)] = 0
    Buffer.from(pixels.buffer, from, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array())
  ])
}

/** PNG 塞进 ICO 容器（Vista 之后都支持，比 BMP 那套省事） */
function encodeIco(png: Buffer): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = 图标
  header.writeUInt16LE(1, 4) // 只有一张

  const entry = Buffer.alloc(16)
  entry[0] = 0 // 宽 0 表示 256
  entry[1] = 0 // 高 0 表示 256
  entry[2] = 0 // 调色板数
  entry[3] = 0 // reserved
  entry.writeUInt16LE(1, 4) // 色彩平面
  entry.writeUInt16LE(32, 6) // 位深
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)

  return Buffer.concat([header, entry, png])
}

const png = encodePng()
await mkdir(OUT_DIR, { recursive: true })
await writeFile(join(OUT_DIR, 'icon.png'), png)
await writeFile(join(OUT_DIR, 'icon.ico'), encodeIco(png))

/* ---------- 自检 ---------- */

// 图看不了，就让脚本自己证明画对了：
// 四个角必须是透明的（圆角），中心是纸页色，高亮那一行真的出现了
const at = (x: number, y: number): number[] => {
  const index = (y * SIZE + x) * 4
  return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]]
}
const near = (actual: number[], expected: number[], tolerance = 6): boolean =>
  actual.slice(0, 3).every((value, i) => Math.abs(value - expected[i]) <= tolerance)

const problems: string[] = []
if (at(0, 0)[3] !== 0) problems.push('左上角不是透明的（圆角没画出来）')
if (at(SIZE - 1, SIZE - 1)[3] !== 0) problems.push('右下角不是透明的')
if (!near(at(SIZE / 2, 60), PAGE)) problems.push('中心上方不是纸页色')
if (!near(at(100, 144), HIGHLIGHT)) problems.push('高亮那一行没画出来')
if (!near(at(20, SIZE / 2), INK)) problems.push('底色不对')

const opaque = [...Array(SIZE * SIZE).keys()].filter((i) => pixels[i * 4 + 3] > 200).length
const ratio = Math.round((opaque / (SIZE * SIZE)) * 100)
console.log(`已生成 build/icon.ico 与 build/icon.png（${SIZE}×${SIZE}，${Math.round(png.length / 1024)}KB，不透明像素 ${ratio}%）`)

if (problems.length > 0) {
  console.error('自检没过：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('自检通过：圆角透明、纸页、高亮行、底色都在')
