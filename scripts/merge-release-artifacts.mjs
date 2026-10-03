import { constants, copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

const [source, destination] = process.argv.slice(2)
if (!source || !destination) throw new Error('Pass downloaded-artifact and release-asset directories.')

const labels = ['windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64']
const expected = labels.map(label => `vhostra-${label}`)
const artifacts = readdirSync(source, { withFileTypes: true })
if (artifacts.length !== expected.length || artifacts.some(entry => !entry.isDirectory() || !expected.includes(entry.name))) {
  throw new Error('Downloaded package artifacts are missing or unexpected.')
}

mkdirSync(destination)
const names = new Set()
for (const artifact of expected) {
  const directory = path.join(source, artifact)
  const files = readdirSync(directory, { withFileTypes: true })
  if (!files.length) throw new Error(`Package artifact is empty: ${artifact}`)
  for (const file of files) {
    if (!file.isFile()) throw new Error(`Package artifact contains a non-file: ${artifact}/${file.name}`)
    if (names.has(file.name)) throw new Error(`Duplicate release asset: ${file.name}`)
    names.add(file.name)
    copyFileSync(path.join(directory, file.name), path.join(destination, file.name), constants.COPYFILE_EXCL)
  }
}
