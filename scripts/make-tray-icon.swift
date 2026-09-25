import AppKit

// Generates the native tray-only asset from Vhostra's approved app-mark crop.
// The artwork remains intact: the white rounded app-icon interior is retained,
// while only pixels outside its curved boundary become transparent.
let arguments = CommandLine.arguments
guard arguments.count >= 3,
      let source = NSImage(contentsOfFile: arguments[1]),
      let bitmap = NSBitmapImageRep(data: source.tiffRepresentation!) else {
  fputs("Usage: make-tray-icon.swift <source-png> <output-png> [logical-size] [corner-radius] [inset]\n", stderr)
  exit(64)
}

let target = arguments.count > 3 ? (Int(arguments[3]) ?? 32) : 32
let radius: CGFloat = arguments.count > 4 ? (CGFloat(Double(arguments[4]) ?? 6)) : 6
let inset = arguments.count > 5 ? (Int(arguments[5]) ?? 0) : 0
let output = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: target, pixelsHigh: target,
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
  isPlanar: false, colorSpaceName: .deviceRGB,
  bitmapFormat: .alphaNonpremultiplied, bytesPerRow: 0, bitsPerPixel: 0
)!

for y in 0..<target {
  for x in 0..<target {
    let sx = min(bitmap.pixelsWide - 1, max(0, x * bitmap.pixelsWide / target))
    let sy = min(bitmap.pixelsHigh - 1, max(0, y * bitmap.pixelsHigh / target))
    let color = bitmap.colorAt(x: sx, y: sy) ?? .clear
    // Preserve the approved white icon interior and red glyph. Only the outer
    // square corners are removed using the same rounded application-icon mask.
    let r = color.redComponent, g = color.greenComponent, b = color.blueComponent
    let dx = max(radius - CGFloat(x), CGFloat(x) - CGFloat(target - 1 - Int(radius)), 0)
    let dy = max(radius - CGFloat(y), CGFloat(y) - CGFloat(target - 1 - Int(radius)), 0)
    let insideRoundedIcon = dx * dx + dy * dy <= radius * radius
    let alpha: CGFloat = insideRoundedIcon ? color.alphaComponent : 0
    output.setColor(NSColor(calibratedRed: r, green: g, blue: b, alpha: alpha), atX: x, y: y)
  }
}

let canvas = NSImage(size: NSSize(width: target, height: target))
canvas.lockFocus()
NSGraphicsContext.current?.imageInterpolation = .high
NSImage(cgImage: output.cgImage!, size: NSSize(width: target, height: target)).draw(
  in: NSRect(x: inset, y: inset, width: target - inset * 2, height: target - inset * 2),
  from: NSRect(x: 0, y: 0, width: target, height: target), operation: .sourceOver, fraction: 1
)
canvas.unlockFocus()
guard let final = NSBitmapImageRep(data: canvas.tiffRepresentation!),
      let png = final.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: arguments[2]))
