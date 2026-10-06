import path from 'node:path'

export interface SystemStoragePaths { configuration: string; data: string; logs: string }

/** Fixed machine locations. These values must never come from renderer input. */
export function systemStoragePaths(platform: NodeJS.Platform): SystemStoragePaths {
  if (platform === 'darwin') {
    const root = '/Library/Application Support/Vhostra'
    return { configuration: root, data: root, logs: path.join(root, 'logs') }
  }
  if (platform === 'win32') {
    const root = 'C:\\ProgramData\\Vhostra'
    return { configuration: root, data: root, logs: `${root}\\logs` }
  }
  if (platform === 'linux') return { configuration: '/etc/vhostra', data: '/var/lib/vhostra', logs: '/var/log/vhostra' }
  throw new Error('Unsupported operating system for Vhostra system storage.')
}
