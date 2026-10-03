import { createHash } from 'node:crypto'
import { createReadStream, existsSync, openSync, closeSync, readSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const [directory, version, platform = 'all', arch] = process.argv.slice(2)
if (!directory || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '')) throw new Error('Pass an artifact directory and semantic version.')
const arches = ['x64', 'arm64']
const targets = {
  win: ['exe'], mac: ['dmg'], linux: ['rpm', 'deb', 'AppImage'],
}
const name = (system, cpu, ext) => {
  const label = system === 'win' ? 'windows' : system === 'mac' ? 'macos' : 'linux'
  const packageArch = system !== 'linux' ? cpu : ext === 'deb' ? (cpu === 'x64' ? 'amd64' : 'arm64') : ext === 'rpm' ? (cpu === 'x64' ? 'x86_64' : 'aarch64') : (cpu === 'x64' ? 'x86_64' : 'arm64')
  return `Vhostra-${version}-${label}-${packageArch}.${ext}`
}
const matrix = Object.entries(targets).flatMap(([system, extensions]) => arches.flatMap(cpu => extensions.map(ext => ({ platform: system, architecture: cpu, format: ext, file: name(system, cpu, ext) }))))
const requested = platform === 'all'
  ? matrix.map(entry => entry.file)
  : targets[platform]?.map(ext => name(platform, arch, ext))
if (!requested?.length || platform !== 'all' && !arches.includes(arch)) throw new Error('Unsupported release platform or architecture.')

for (const artifact of requested) if (!existsSync(path.join(directory, artifact))) throw new Error(`Missing release artifact: ${artifact}`)
if (platform === 'all') {
  const found = readdirSync(directory)
  if (found.length !== requested.length || found.some(file => !requested.includes(file))) throw new Error('Release directory contains missing, duplicate, or unexpected packages.')
  const lines = []
  for (const file of requested.sort()) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path.join(directory, file))) hash.update(chunk)
    lines.push(`${hash.digest('hex')}  ${file}`)
  }
  writeFileSync(path.join(directory, 'SHA256SUMS'), lines.join('\n') + '\n')
  writeFileSync(path.join(directory, 'release-manifest.json'), JSON.stringify({ version, artifacts: requested.map(file => ({ ...matrix.find(entry => entry.file === file), sha256: lines.find(line => line.endsWith(`  ${file}`)).split(' ')[0] })) }, null, 2) + '\n')
  console.log(`Verified ${requested.length} release packages and wrote SHA256SUMS.`)
} else {
  const unpacked = platform === 'win' ? (arch === 'x64' ? 'win-unpacked' : 'win-arm64-unpacked')
    : platform === 'mac' ? (arch === 'x64' ? 'mac' : 'mac-arm64') : (arch === 'x64' ? 'linux-unpacked' : 'linux-arm64-unpacked')
  const executable = platform === 'win' ? path.join(directory, unpacked, 'Vhostra.exe')
    : platform === 'mac' ? path.join(directory, unpacked, 'Vhostra.app', 'Contents', 'MacOS', 'Vhostra')
      : path.join(directory, unpacked, 'VhostraDesktop')
  const cli = platform === 'win' ? path.join(directory, unpacked, 'vhostra.cmd')
    : platform === 'mac' ? path.join(directory, unpacked, 'Vhostra.app', 'Contents', 'Resources', 'bin', 'vhostra')
      : path.join(directory, unpacked, 'vhostra')
  if (!existsSync(executable) || !existsSync(cli)) throw new Error('Packaged executable or CLI launcher is missing.')
  const headerBytes = file => {
    const descriptor = openSync(file, 'r')
    try { const bytes = Buffer.alloc(512); readSync(descriptor, bytes, 0, bytes.length, 0); return bytes }
    finally { closeSync(descriptor) }
  }
  const binary = headerBytes(executable)
  let machine
  if (platform === 'win') {
    const header = binary.readUInt32LE(0x3c)
    machine = binary.readUInt16LE(header + 4)
    if (machine !== (arch === 'arm64' ? 0xaa64 : 0x8664)) throw new Error('Windows executable architecture does not match the package.')
  } else if (platform === 'mac') {
    machine = binary.readUInt32LE(4)
    if (machine !== (arch === 'arm64' ? 0x0100000c : 0x01000007)) throw new Error('macOS executable architecture does not match the package.')
  } else {
    machine = binary.readUInt16LE(18)
    if (machine !== (arch === 'arm64' ? 183 : 62)) throw new Error('Linux executable architecture does not match the package.')
    const metadata = (program, args) => {
      const result = spawnSync(program, args, { encoding: 'utf8' })
      if (result.status !== 0) throw new Error(`${program} could not read package architecture.`)
      return result.stdout.trim()
    }
    if (metadata('dpkg-deb', ['-f', path.join(directory, name('linux', arch, 'deb')), 'Architecture']) !== (arch === 'x64' ? 'amd64' : 'arm64')) throw new Error('DEB architecture mismatch.')
    if (metadata('rpm', ['-qp', '--qf', '%{ARCH}', path.join(directory, name('linux', arch, 'rpm'))]) !== (arch === 'x64' ? 'x86_64' : 'aarch64')) throw new Error('RPM architecture mismatch.')
    const appImage = headerBytes(path.join(directory, name('linux', arch, 'AppImage')))
    if (appImage.readUInt16LE(18) !== machine) throw new Error('AppImage architecture mismatch.')
  }
  console.log(`Verified ${platform}/${arch}: ${requested.length} packages, executable architecture, and CLI launcher.`)
}
