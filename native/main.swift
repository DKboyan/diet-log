// 饮食记录 —— WKWebView 原生壳
// 编译：swiftc -O main.swift -o launch -framework Cocoa -framework WebKit
import Cocoa
import WebKit

let dataDir = FileManager.default
    .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("饮食记录", isDirectory: true)
let dataFile = dataDir.appendingPathComponent("data.json")

// JS 每次保存都会把完整数据发过来，落盘到 ~/Library/Application Support/饮食记录/data.json
class Bridge: NSObject, WKScriptMessageHandler {
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "save", let s = message.body as? String else { return }
        do {
            try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
            try s.data(using: .utf8)?.write(to: dataFile, options: .atomic)
        } catch {
            NSLog("饮食记录 save failed: \(error)")
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ note: Notification) {
        let ucc = WKUserContentController()
        ucc.add(Bridge(), name: "save")
        if let d = try? Data(contentsOf: dataFile) {
            let src = "window.__NATIVE_DATA_B64__=\"\(d.base64EncodedString())\";"
            ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let cfg = WKWebViewConfiguration()
        cfg.userContentController = ucc
        cfg.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        let rect = NSRect(x: 0, y: 0, width: 500, height: 860)
        webView = WKWebView(frame: rect, configuration: cfg)
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(contentRect: rect,
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "饮食记录"
        window.minSize = NSSize(width: 360, height: 560)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)

        let res = Bundle.main.resourceURL!
        webView.loadFileURL(res.appendingPathComponent("index.html"), allowingReadAccessTo: res)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    @objc func reloadPage(_ sender: Any?) {
        // 刷新前把最新落盘数据重新注入，防止读到旧数据
        if let d = try? Data(contentsOf: dataFile) {
            let ucc = webView.configuration.userContentController
            ucc.removeAllUserScripts()
            let src = "window.__NATIVE_DATA_B64__=\"\(d.base64EncodedString())\";"
            ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        webView.reload()
    }
}

func buildMenu(_ delegate: AppDelegate) -> NSMenu {
    let main = NSMenu()

    let appItem = NSMenuItem(); main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "退出 饮食记录", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    let editItem = NSMenuItem(); main.addItem(editItem)
    let edit = NSMenu(title: "编辑")
    edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(NSMenuItem.separator())
    edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit

    let viewItem = NSMenuItem(); main.addItem(viewItem)
    let view = NSMenu(title: "显示")
    let r = NSMenuItem(title: "刷新", action: #selector(AppDelegate.reloadPage(_:)), keyEquivalent: "r")
    r.target = delegate
    view.addItem(r)
    viewItem.submenu = view

    return main
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.mainMenu = buildMenu(delegate)
app.run()
