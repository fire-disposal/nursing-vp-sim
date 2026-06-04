// Generate placeholder tab bar icons as minimal valid PNG files
// Each file will be a simple colored 81x81 square

const fs = require("fs")
const path = require("path")
const zlib = require("zlib")

const ICONS_DIR = path.join(__dirname, "..", "assets", "icons")
if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true })

function createSolidPNG(r, g, b, a = 255) {
  const size = 81
  const rawData = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    rawData[y * (size * 4 + 1)] = 0 // filter byte
    for (let x = 0; x < size; x++) {
      const offset = y * (size * 4 + 1) + 1 + x * 4
      rawData[offset] = r
      rawData[offset + 1] = g
      rawData[offset + 2] = b
      rawData[offset + 3] = a
    }
  }

  const deflated = zlib.deflateSync(rawData)

  let crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c
  }
  function crc32(buf) {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  function writeChunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const crcData = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(crcData), 0)
    return Buffer.concat([len, Buffer.from(type), data, crc])
  }

  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const chunks = [
    writeChunk("IHDR", ihdr),
    writeChunk("IDAT", deflated),
    writeChunk("IEND", Buffer.alloc(0)),
  ]

  return Buffer.concat([header, ...chunks])
}

const icons = {
  home: [37, 99, 235],
  home_active: [29, 78, 216],
  train: [37, 99, 235],
  train_active: [29, 78, 216],
  history: [37, 99, 235],
  history_active: [29, 78, 216],
  profile: [37, 99, 235],
  profile_active: [29, 78, 216],
}

for (const [name, [r, g, b]] of Object.entries(icons)) {
  fs.writeFileSync(path.join(ICONS_DIR, `${name}.png`), createSolidPNG(r, g, b))
}

console.log("Icons generated in", ICONS_DIR)
