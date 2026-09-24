import path from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const executable = process.platform === 'win32' ? `${path.join(root, 'node_modules', '.bin', 'electron')}.cmd` : path.join(root, 'node_modules', '.bin', 'electron')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(executable, ['test/bridge.electron.mjs'], { cwd: root, stdio: 'inherit', env: environment })
child.once('exit', code => process.exit(code ?? 1))
