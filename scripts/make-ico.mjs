import { readFile, writeFile } from 'node:fs/promises'

const files = process.argv.slice(2)
const images = await Promise.all(files.map(async file => ({ file, data: await readFile(file) })))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
let offset = 6 + images.length * 16
const entries = images.map(({ file, data }) => {
  const match = /(?:^|\/)(\d+)x\1\.png$/.exec(file)
  if (!match) throw new Error(`Expected a size-named PNG: ${file}`)
  const size = Number(match[1]); const entry = Buffer.alloc(16)
  entry.writeUInt8(size === 256 ? 0 : size, 0); entry.writeUInt8(size === 256 ? 0 : size, 1); entry.writeUInt8(0, 2); entry.writeUInt8(0, 3)
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(data.length, 8); entry.writeUInt32LE(offset, 12); offset += data.length
  return entry
})
await writeFile('build/icon.ico', Buffer.concat([header, ...entries, ...images.map(image => image.data)]))
