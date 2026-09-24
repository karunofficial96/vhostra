import { readFile, writeFile } from 'node:fs/promises'

const kind = new Map([[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']])
const chunks = await Promise.all(process.argv.slice(2).map(async file => {
  const match = /(?:^|\/)(\d+)x\1\.png$/.exec(file)
  if (!match || !kind.has(Number(match[1]))) throw new Error(`Expected a supported size-named PNG: ${file}`)
  const png = await readFile(file); const chunk = Buffer.alloc(8); chunk.write(kind.get(Number(match[1])), 0, 'ascii'); chunk.writeUInt32BE(png.length + 8, 4)
  return Buffer.concat([chunk, png])
}))
const header = Buffer.alloc(8); header.write('icns', 0, 'ascii'); header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
await writeFile('build/icon.icns', Buffer.concat([header, ...chunks]))
