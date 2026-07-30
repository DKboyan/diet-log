// 生成图标 PNG：绿色渐变 + 🥗
// 用法：swift icon.swift <输出.png> [尺寸=1024] [fullbleed|margin=margin]
//   margin    —— 带 10% 边距的圆角矩形（macOS .icns 用）
//   fullbleed —— 铺满整个画布、不透明（iOS 主屏幕图标用，iOS 自己切圆角）
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon_1024.png"
let px = CommandLine.arguments.count > 2 ? Int(CommandLine.arguments[2]) ?? 1024 : 1024
let fullbleed = CommandLine.arguments.count > 3 && CommandLine.arguments[3] == "fullbleed"

let W = CGFloat(px)
let size = NSSize(width: W, height: W)
let img = NSImage(size: size)
img.lockFocus()

let grad = NSGradient(starting: NSColor(calibratedRed: 0.13, green: 0.62, blue: 0.36, alpha: 1),
                      ending: NSColor(calibratedRed: 0.05, green: 0.44, blue: 0.30, alpha: 1))!
let rect: NSRect
if fullbleed {
    rect = NSRect(x: 0, y: 0, width: W, height: W)
    grad.draw(in: NSBezierPath(rect: rect), angle: -90)
} else {
    let m = W * 0.098
    rect = NSRect(x: m, y: m, width: W - 2 * m, height: W - 2 * m)
    grad.draw(in: NSBezierPath(roundedRect: rect, xRadius: W * 0.182, yRadius: W * 0.182), angle: -90)
}

let str = "🥗" as NSString
let fontSize = fullbleed ? W * 0.60 : W * 0.527
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: fontSize)]
let s = str.size(withAttributes: attrs)
str.draw(at: NSPoint(x: rect.midX - s.width / 2, y: rect.midY - s.height / 2), withAttributes: attrs)

img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
rep.size = size
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("icon written: \(out) \(px)px \(fullbleed ? "fullbleed" : "margin")")
