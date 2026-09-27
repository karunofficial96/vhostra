import assert from 'node:assert/strict'
import { app, nativeImage, Tray, Menu } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
app.whenReady().then(async () => {
let tray
try {
  const image = nativeImage.createEmpty()
  image.addRepresentation({ scaleFactor: 1, buffer: readFileSync(path.resolve('build/trayIcon.png')) })
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(path.resolve('build/trayIcon@2x.png')) })
  assert.deepEqual(image.getScaleFactors(), [1, 2])
  assert.deepEqual(image.getSize(), { width: 20, height: 20 })
  for (const scaleFactor of [1, 2]) {
    const bitmap = image.toBitmap({ scaleFactor })
    const width = 20 * scaleFactor
    assert.equal(bitmap.length, width * width * 4)
    let visible = 0
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      const alpha = bitmap[(y * width + x) * 4 + 3]
      if (x === 0 || y === 0 || x === width - 1 || y === width - 1) assert.equal(alpha, 0, 'Native tray edges must stay transparent')
      if (alpha) visible++
    }
    assert.ok(visible > width * width / 8, 'Tray glyph must remain visible')
  }
  tray = new Tray(image)
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Vhostra asset validation', enabled: false }]))
  const bounds = tray.getBounds()
  assert.ok(bounds.width > 0 && bounds.width <= 40)
  console.log('Native 20px/40px tray representations, alpha padding, and compact macOS status-item bounds passed.')
} catch (error) { console.error(error); process.exitCode = 1 }
finally { tray?.destroy(); app.quit() }

})
