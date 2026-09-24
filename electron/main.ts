import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    title: 'Vhostra',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  const devServer = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
  const renderer = app.isPackaged
    ? pathToFileURL(path.join(__dirname, '../dist/index.html')).toString()
    : devServer
  window.loadURL(renderer)
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
