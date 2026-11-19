// LR Mask Presets for macOS: a native window around the web UI in web/.
// Swift finds presets on disk, shows open/save panels and writes files; the page does the converting.
//
// Modes for development (see scripts/build-mac-app.sh):
//   --selftest            load the bundled samples, run a conversion end to end in a sandboxed home, exit 0/1
//   --snapshot out.png    render the window to a PNG and exit   [--demo] [--light|--dark] [--size 1320x860] [--js "..."]
//                         [--real] reads this Mac's real preset folders (read-only) instead of an empty sandbox

import AppKit
import UniformTypeIdentifiers
import WebKit

let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
let presetExtensions: Set<String> = ["xmp", "lrtemplate"]
let maxPresetBytes = 5 * 1024 * 1024
let maxZipBytes = 100 * 1024 * 1024
let maxFilesPerSource = 20_000

// MARK: - Options

struct Options {
    var selftest = false
    var snapshot: String?
    var demo = false
    var theme: String?
    var size = NSSize(width: 1320, height: 860)
    var js: String?
    var real = false

    static func parse(_ args: [String]) -> Options {
        var o = Options()
        var i = 1
        func next() -> String? { i += 1; return i < args.count ? args[i] : nil }
        while i < args.count {
            switch args[i] {
            case "--selftest": o.selftest = true
            case "--snapshot": o.snapshot = next()
            case "--demo": o.demo = true
            case "--real": o.real = true
            case "--light": o.theme = "light"
            case "--dark": o.theme = "dark"
            case "--js": o.js = next()
            case "--size":
                if let parts = next()?.split(separator: "x").compactMap({ Double($0) }), parts.count == 2 {
                    o.size = NSSize(width: parts[0], height: parts[1])
                }
            default: break // e.g. -NSDocumentRevisionsDebugMode from Xcode, or Finder's -psn_ argument
            }
            i += 1
        }
        return o
    }
}

// MARK: - Where things live

/// All paths the app reads or writes. In test modes everything is rooted in a throwaway folder.
struct Places {
    let home: URL
    let systemLibrary: URL
    let defaults: UserDefaults

    static func real() -> Places {
        Places(home: FileManager.default.homeDirectoryForCurrentUser, systemLibrary: URL(fileURLWithPath: "/Library"), defaults: .standard)
    }

    static func sandbox() -> Places {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("lr-mask-presets-selftest-\(ProcessInfo.processInfo.processIdentifier)")
        try? FileManager.default.removeItem(at: root)
        let suite = "lr-mask-presets.selftest.\(ProcessInfo.processInfo.processIdentifier)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return Places(home: root.appendingPathComponent("home"), systemLibrary: root.appendingPathComponent("Library"), defaults: defaults)
    }

    var cameraRawUser: URL { home.appendingPathComponent("Library/Application Support/Adobe/CameraRaw/Settings") }
    var classicTemplates: URL { home.appendingPathComponent("Library/Application Support/Adobe/Lightroom/Develop Presets") }
    var cameraRawSystem: URL { systemLibrary.appendingPathComponent("Application Support/Adobe/CameraRaw/Settings") }
    var installFolder: URL { cameraRawUser.appendingPathComponent("LR Mask Presets") }

    var outputFolder: URL {
        get {
            if let path = defaults.string(forKey: "outputFolder"), !path.isEmpty { return URL(fileURLWithPath: path) }
            return home.appendingPathComponent("Pictures/LR Mask Presets")
        }
        nonmutating set { defaults.set(newValue.path, forKey: "outputFolder") }
    }

    var folders: [String] {
        get { defaults.stringArray(forKey: "folders") ?? [] }
        nonmutating set { defaults.set(newValue, forKey: "folders") }
    }

    /// Lightroom (cloud) keeps synced presets in <library>.lrlibrary/<id>/cr_settings. Read only.
    var lightroomPresetFolders: [URL] {
        let pictures = home.appendingPathComponent("Pictures")
        let fm = FileManager.default
        var out: [URL] = []
        let libraries = ((try? fm.contentsOfDirectory(at: pictures, includingPropertiesForKeys: nil)) ?? []).filter { $0.pathExtension == "lrlibrary" }
        for library in libraries.sorted(by: { $0.path < $1.path }) {
            for id in (try? fm.contentsOfDirectory(at: library, includingPropertiesForKeys: nil)) ?? [] {
                let settings = id.appendingPathComponent("cr_settings")
                if isDirectory(settings) { out.append(settings) }
            }
        }
        return out
    }
}

func isDirectory(_ url: URL) -> Bool {
    var dir: ObjCBool = false
    return FileManager.default.fileExists(atPath: url.path, isDirectory: &dir) && dir.boolValue
}

func tildePath(_ url: URL) -> String {
    url.path
}

// MARK: - Reading presets from disk

/// Collect preset files (.xmp, .lrtemplate, .zip) under a folder as [{ path, text } | { path, base64 }].
func collectFiles(in root: URL, recursive: Bool = true, zips: Bool = true, flat: Bool = false, into files: inout [[String: Any]], seen: inout Set<String>) {
    let fm = FileManager.default
    let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey]
    var urls: [URL] = []
    if recursive, let walker = fm.enumerator(at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants]) {
        for case let url as URL in walker {
            if url.pathComponents.contains("__MACOSX") { walker.skipDescendants(); continue }
            urls.append(url)
            if urls.count > maxFilesPerSource * 4 { break }
        }
    } else {
        urls = (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])) ?? []
    }
    let rootPath = root.standardizedFileURL.path
    for url in urls.sorted(by: { $0.path.localizedStandardCompare($1.path) == .orderedAscending }) {
        guard files.count < maxFilesPerSource else { break }
        let ext = url.pathExtension.lowercased()
        let isZip = ext == "zip"
        guard presetExtensions.contains(ext) || (zips && isZip) else { continue }
        guard let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true else { continue }
        let size = values.fileSize ?? 0
        guard size > 0, size <= (isZip ? maxZipBytes : maxPresetBytes) else { continue }
        var relative = url.standardizedFileURL.path
        if relative.hasPrefix(rootPath + "/") { relative = String(relative.dropFirst(rootPath.count + 1)) }
        if flat { relative = url.lastPathComponent }
        guard !seen.contains(relative), let data = try? Data(contentsOf: url) else { continue }
        seen.insert(relative)
        files.append(payload(path: relative, data: data, binary: isZip))
    }
}

func payload(path: String, data: Data, binary: Bool) -> [String: Any] {
    if !binary, let text = String(data: data, encoding: .utf8) { return ["path": path, "text": text] }
    return ["path": path, "base64": data.base64EncodedString()]
}

func source(key: String, label: String, kind: String, roots: [URL], defaultEnabled: Bool = true, removable: Bool = false, flat: Bool = false, zips: Bool = false) -> [String: Any] {
    let present = roots.filter(isDirectory)
    var files: [[String: Any]] = []
    var seen = Set<String>()
    for root in present { collectFiles(in: root, zips: zips, flat: flat, into: &files, seen: &seen) }
    return [
        "key": key, "label": label, "kind": kind, "path": (present.first ?? roots.first)?.path ?? "",
        "available": !present.isEmpty, "defaultEnabled": defaultEnabled, "removable": removable, "files": files,
    ]
}

func folderSource(_ path: String) -> [String: Any] {
    let url = URL(fileURLWithPath: path)
    return source(key: "folder:\(path)", label: url.lastPathComponent, kind: "folder", roots: [url], removable: true, zips: true)
}

func scanAll(_ places: Places) -> [String: Any] {
    var sources: [[String: Any]] = [
        source(key: "lightroom", label: "Lightroom", kind: "lightroom", roots: places.lightroomPresetFolders.isEmpty
            ? [places.home.appendingPathComponent("Pictures/Lightroom Library.lrlibrary")] : places.lightroomPresetFolders, flat: true),
        source(key: "camera-raw", label: "Lightroom Classic & Camera Raw", kind: "lrc", roots: [places.cameraRawUser]),
        source(key: "classic-templates", label: "Lightroom Classic (older)", kind: "lrc", roots: [places.classicTemplates]),
        source(key: "adobe", label: "Adobe's own presets", kind: "adobe", roots: [places.cameraRawSystem], defaultEnabled: false),
    ]
    sources += places.folders.map(folderSource)
    return ["sources": sources, "outputFolder": places.outputFolder.path, "apps": installedApps()]
}

func installedApps() -> [String: Bool] {
    let ws = NSWorkspace.shared
    return [
        "cloud": ws.urlForApplication(withBundleIdentifier: "com.adobe.lightroomCC") != nil,
        "classic": ws.urlForApplication(withBundleIdentifier: "com.adobe.LightroomClassicCC7") != nil,
    ]
}

// MARK: - Writing

func uniqueFolder(_ url: URL) -> URL {
    var candidate = url
    var n = 2
    while FileManager.default.fileExists(atPath: candidate.path) {
        candidate = url.deletingLastPathComponent().appendingPathComponent("\(url.lastPathComponent) \(n)")
        n += 1
    }
    return candidate
}

/// Only plain file names: no folders, no hidden files, nothing that climbs out of the target folder.
func safeName(_ name: String) -> String? {
    let trimmed = name.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty, !trimmed.hasPrefix("."), !trimmed.contains("/"), !trimmed.contains(":"), trimmed.count < 250 else { return nil }
    return trimmed
}

func writePresets(_ files: [[String: Any]], to folder: URL) throws -> Int {
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    var count = 0
    for file in files {
        guard let name = (file["name"] as? String).flatMap(safeName), name.lowercased().hasSuffix(".xmp"), let text = file["text"] as? String else { continue }
        try Data(text.utf8).write(to: folder.appendingPathComponent(name), options: .atomic)
        count += 1
    }
    return count
}

// MARK: - Serving the page

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root.standardizedFileURL }

    static let types = ["html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css", "json": "application/json",
                        "svg": "image/svg+xml", "png": "image/png", "xmp": "application/rdf+xml"]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "app" else { return fail(task, 400) }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else { return fail(task, 404) }
        let type = SchemeHandler.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let headers = [
            "Content-Type": type.hasPrefix("text/") || type.hasSuffix("json") ? "\(type); charset=utf-8" : type,
            "Content-Length": String(data.count),
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
        ]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask, _ status: Int) {
        task.didFailWithError(NSError(domain: NSURLErrorDomain, code: status == 404 ? NSURLErrorFileDoesNotExist : NSURLErrorBadURL))
    }
}

// MARK: - The bridge the page talks to

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    let places: Places
    weak var window: NSWindow?
    var onReady: (([String: Any]) -> Void)?

    init(places: Places) { self.places = places }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return replyHandler(nil, "Bad message") }
        // Only our own page may call in.
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "lrmask" else { return replyHandler(nil, "Not allowed") }
        handle(cmd, body) { result in replyHandler(result ?? NSNull(), nil) }
    }

    private func handle(_ cmd: String, _ body: [String: Any], reply: @escaping (Any?) -> Void) {
        let places = self.places
        switch cmd {
        case "getSettings":
            let text = places.defaults.string(forKey: "settings") ?? "{}"
            reply((try? JSONSerialization.jsonObject(with: Data(text.utf8))) ?? [:])

        case "setSettings":
            if let settings = body["settings"], let data = try? JSONSerialization.data(withJSONObject: settings) {
                places.defaults.set(String(decoding: data, as: UTF8.self), forKey: "settings")
                applyAppearance((settings as? [String: Any])?["theme"] as? String)
            }
            reply(true)

        case "scan":
            DispatchQueue.global(qos: .userInitiated).async {
                let result = scanAll(places)
                DispatchQueue.main.async { reply(result) }
            }

        case "chooseFolders":
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.allowsMultipleSelection = true
            panel.prompt = "Add"
            panel.message = "Choose folders with Lightroom presets (.xmp, .lrtemplate or .zip packs). Subfolders are included."
            present(panel) { urls in
                guard !urls.isEmpty else { return reply(nil) }
                var folders = places.folders
                for url in urls where !folders.contains(url.path) { folders.append(url.path) }
                places.folders = folders
                DispatchQueue.global(qos: .userInitiated).async {
                    let sources = urls.map { folderSource($0.path) }
                    DispatchQueue.main.async { reply(["sources": sources]) }
                }
            }

        case "removeFolder":
            if let path = body["path"] as? String { places.folders = places.folders.filter { $0 != path } }
            reply(true)

        case "chooseFiles":
            let panel = NSOpenPanel()
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = true
            panel.prompt = "Add"
            panel.message = "Choose Lightroom presets: .xmp, .lrtemplate, or a .zip preset pack."
            panel.allowedContentTypes = ["xmp", "lrtemplate", "zip"].compactMap { UTType(filenameExtension: $0) }
            present(panel) { urls in
                guard !urls.isEmpty else { return reply(nil) }
                reply(["files": readPicked(urls)])
            }

        case "save":
            guard let folderName = (body["folderName"] as? String).flatMap(safeName), let zipName = (body["zipName"] as? String).flatMap(safeName),
                  let files = body["files"] as? [[String: Any]], let zip = (body["zipBase64"] as? String).flatMap({ Data(base64Encoded: $0) }) else {
                return reply(["error": "Nothing to save"])
            }
            do {
                let base = places.outputFolder
                let folder = uniqueFolder(base.appendingPathComponent(folderName))
                let written = try writePresets(files, to: folder)
                let zipURL = base.appendingPathComponent(folder.lastPathComponent == folderName ? zipName : "\(folder.lastPathComponent).zip")
                try zip.write(to: zipURL, options: .atomic)
                reply(["folder": folder.path, "zip": zipURL.path, "count": written])
            } catch {
                reply(["error": "Couldn't save to \(places.outputFolder.path): \(error.localizedDescription)"])
            }

        case "installCameraRaw":
            guard let files = body["files"] as? [[String: Any]] else { return reply(["error": "Nothing to install"]) }
            do {
                let count = try writePresets(files, to: places.installFolder)
                reply(["count": count, "folder": places.installFolder.path])
            } catch {
                reply(["error": "Couldn't install: \(error.localizedDescription)"])
            }

        case "chooseOutputFolder":
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.canCreateDirectories = true
            panel.prompt = "Use This Folder"
            panel.message = "Where should new presets be saved?"
            panel.directoryURL = places.outputFolder.deletingLastPathComponent()
            present(panel) { urls in
                guard let url = urls.first else { return reply(nil) }
                places.outputFolder = url
                reply(["outputFolder": url.path])
            }

        case "reveal":
            if let path = body["path"] as? String {
                let url = URL(fileURLWithPath: path)
                if FileManager.default.fileExists(atPath: path) {
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                } else {
                    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
                    NSWorkspace.shared.open(url)
                }
            }
            reply(true)

        case "openLightroom":
            let ids = ["com.adobe.lightroomCC", "com.adobe.LightroomClassicCC7"]
            guard let app = ids.lazy.compactMap({ NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) }).first else {
                return reply(["error": "Lightroom isn't installed on this Mac"])
            }
            NSWorkspace.shared.openApplication(at: app, configuration: NSWorkspace.OpenConfiguration()) { _, error in
                DispatchQueue.main.async { reply(error.map { ["error": $0.localizedDescription] } ?? ["opened": app.deletingPathExtension().lastPathComponent]) }
            }

        case "copyText":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(body["text"] as? String ?? "", forType: .string)
            reply(true)

        case "openURL":
            if let text = body["url"] as? String, let url = URL(string: text), url.scheme == "https" { NSWorkspace.shared.open(url) }
            reply(true)

        case "ready":
            onReady?(body)
            reply(["version": appVersion])

        case "log":
            FileHandle.standardError.write(Data("[page] \(body["message"] as? String ?? "")\n".utf8))
            reply(true)

        default:
            reply(["error": "Unknown command \(cmd)"])
        }
    }

    private func present(_ panel: NSOpenPanel, done: @escaping ([URL]) -> Void) {
        if let window {
            panel.beginSheetModal(for: window) { response in done(response == .OK ? panel.urls : []) }
        } else {
            done(panel.runModal() == .OK ? panel.urls : [])
        }
    }
}

/// Files the user picked or dropped on the Dock icon: [{ path, text | base64 }].
func readPicked(_ urls: [URL]) -> [[String: Any]] {
    var files: [[String: Any]] = []
    var seen = Set<String>()
    for url in urls {
        if isDirectory(url) {
            var nested: [[String: Any]] = []
            collectFiles(in: url, zips: true, into: &nested, seen: &seen)
            files += nested.map { file in file.merging(["path": "\(url.lastPathComponent)/\(file["path"] as? String ?? "")"]) { $1 } }
            continue
        }
        let ext = url.pathExtension.lowercased()
        guard presetExtensions.contains(ext) || ext == "zip",
              let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= (ext == "zip" ? maxZipBytes : maxPresetBytes),
              let data = try? Data(contentsOf: url) else { continue }
        files.append(payload(path: url.lastPathComponent, data: data, binary: ext == "zip"))
    }
    return files
}

func applyAppearance(_ theme: String?) {
    switch theme {
    case "light": NSApp.appearance = NSAppearance(named: .aqua)
    case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
    default: NSApp.appearance = nil
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    let options: Options
    let places: Places
    var window: NSWindow!
    var webView: WKWebView!
    var bridge: Bridge!
    var pendingOpen: [URL] = []
    var pageReady = false

    init(options: Options) {
        self.options = options
        // Test modes never touch the real home, except a snapshot that asks to read it (--real).
        self.places = options.selftest || (options.snapshot != nil && !options.real) ? .sandbox() : .real()
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        if let theme = options.theme { applyAppearance(theme) } else if let text = places.defaults.string(forKey: "settings"),
            let settings = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] { applyAppearance(settings["theme"] as? String) }
        if options.selftest { prepareSelftestHome() }

        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web")
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemeHandler(root: webRoot), forURLScheme: "lrmask")
        bridge = Bridge(places: places)
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "native")
        config.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.dataset.version = \(jsonString(appVersion));", injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: NSRect(origin: .zero, size: options.size), configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        #if DEBUG
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        #endif

        window = NSWindow(contentRect: NSRect(origin: .zero, size: options.size), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "LR Mask Presets"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(srgbRed: 0x1d / 255, green: 0x1d / 255, blue: 0x20 / 255, alpha: 1) : .white
        }
        window.minSize = NSSize(width: 980, height: 620)
        window.contentView = webView
        window.setFrameAutosaveName(options.snapshot == nil && !options.selftest ? "Main" : "")
        if options.snapshot != nil || options.selftest { window.setContentSize(options.size) }
        window.center()
        bridge.window = window
        bridge.onReady = { [weak self] _ in self?.pageDidBecomeReady() }

        var query: [String] = []
        if options.demo || options.selftest { query.append("demo") }
        if let theme = options.theme { query.append("theme=\(theme)") }
        webView.load(URLRequest(url: URL(string: "lrmask://app/index.html" + (query.isEmpty ? "" : "?" + query.joined(separator: "&")))!))

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, self.options.selftest || self.options.snapshot != nil, !self.pageReady else { return }
            self.finish(false, "Page didn't become ready within 30 s")
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    func application(_ application: NSApplication, open urls: [URL]) {
        pendingOpen += urls
        if pageReady { deliverOpenedFiles() }
    }

    private func deliverOpenedFiles() {
        let urls = pendingOpen
        pendingOpen = []
        guard !urls.isEmpty else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let files = readPicked(urls)
            DispatchQueue.main.async {
                self.webView.callAsyncJavaScript("await window.app.addFiles(files)", arguments: ["files": files], in: nil, in: .page, completionHandler: nil)
            }
        }
    }

    private func pageDidBecomeReady() {
        pageReady = true
        deliverOpenedFiles()
        if options.selftest { runSelftest() }
        else if let out = options.snapshot { takeSnapshot(to: out) }
    }

    // Keep navigation inside the app; real web links open in the browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "lrmask" { return decisionHandler(.allow) }
        if url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.scheme == "https" { NSWorkspace.shared.open(url) }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    @objc func command(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        webView.evaluateJavaScript("window.app && window.app.command(\(jsonString(name)))")
    }

    @objc func openProjectPage(_ sender: Any?) {
        NSWorkspace.shared.open(URL(string: "https://github.com/pvn-ptl/lr-mask-presets")!)
    }

    // MARK: Menus

    private func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ name: String, _ key: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let it = NSMenuItem(title: title, action: #selector(command(_:)), keyEquivalent: key)
            it.keyEquivalentModifierMask = mods
            it.representedObject = name
            it.target = self
            return it
        }
        func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            let holder = NSMenuItem()
            holder.submenu = menu
            main.addItem(holder)
            return menu
        }

        let quit = NSMenuItem(title: "Quit LR Mask Presets", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let hide = NSMenuItem(title: "Hide LR Mask Presets", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        _ = submenu("LR Mask Presets", [
            NSMenuItem(title: "About LR Mask Presets", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""),
            .separator(),
            item("Settings…", "settings", ","),
            .separator(),
            hide, hideOthers,
            NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""),
            .separator(),
            quit,
        ])
        _ = submenu("File", [
            item("Add Folder…", "addFolder", "o", [.command, .shift]),
            item("Add Files…", "addFiles", "o"),
            item("Load Sample Presets", "samples", ""),
            .separator(),
            item("Look for Presets Again", "rescan", "r"),
            .separator(),
            item("Create Presets", "create", "\r"),
            .separator(),
            NSMenuItem(title: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"),
        ])
        let find = item("Find Presets…", "find", "f")
        _ = submenu("Edit", [
            NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"),
            {
                let redo = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
                redo.keyEquivalentModifierMask = [.command, .shift]
                return redo
            }(),
            .separator(),
            NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
            NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
            NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
            NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"),
            .separator(),
            find,
            item("Select No Presets", "selectNone", "a", [.command, .shift]),
        ])
        let window = submenu("Window", [
            NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"),
            NSMenuItem(title: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: ""),
            {
                let full = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
                full.keyEquivalentModifierMask = [.command, .control]
                return full
            }(),
        ])
        let help = NSMenuItem(title: "LR Mask Presets on GitHub", action: #selector(openProjectPage(_:)), keyEquivalent: "")
        help.target = self
        let helpMenu = submenu("Help", [help])
        NSApp.mainMenu = main
        NSApp.windowsMenu = window
        NSApp.helpMenu = helpMenu
    }

    // MARK: Test modes

    /// A pretend home with a Lightroom library, Classic presets, a .zip pack and junk, for --selftest.
    private func prepareSelftestHome() {
        let fm = FileManager.default
        let samples = Bundle.main.resourceURL!.appendingPathComponent("web/samples")
        let sampleFiles = ((try? fm.contentsOfDirectory(at: samples, includingPropertiesForKeys: nil)) ?? []).filter { $0.pathExtension == "xmp" }
        let library = places.home.appendingPathComponent("Pictures/Lightroom Library.lrlibrary/0123abcd/cr_settings")
        let classic = places.cameraRawUser.appendingPathComponent("Sample Looks")
        for dir in [library, classic, places.classicTemplates] { try? fm.createDirectory(at: dir, withIntermediateDirectories: true) }
        for (i, file) in sampleFiles.enumerated() {
            let target = (i % 2 == 0 ? library : classic).appendingPathComponent(i % 2 == 0 ? UUID().uuidString + ".xmp" : file.lastPathComponent)
            try? fm.copyItem(at: file, to: target)
        }
        try? Data("not xml at all".utf8).write(to: library.appendingPathComponent("broken.xmp"))
        try? Data("s = { title = \"Old Look\", type = \"Develop\", value = { settings = { Exposure2012 = 0.5, Contrast2012 = 20 } } }".utf8)
            .write(to: places.classicTemplates.appendingPathComponent("Old Look.lrtemplate"))
    }

    private func runSelftest() {
        let script = """
        const native = (cmd, args = {}) => window.webkit.messageHandlers.native.postMessage({ cmd, ...args });
        const report = { checks: [] };
        const check = (name, ok, detail = "") => report.checks.push({ name, ok: Boolean(ok), detail: String(detail) });
        const app = window.app;
        check("page loaded the bundled samples", app.state.entries.length === 8, app.state.entries.length);
        const scan = await native("scan");
        const byKey = Object.fromEntries(scan.sources.map((s) => [s.key, s]));
        check("finds the Lightroom library", byKey.lightroom.available && byKey.lightroom.files.length === 5, byKey.lightroom.files.length);
        check("finds Classic & Camera Raw presets", byKey["camera-raw"].files.length === 4, byKey["camera-raw"].files.length);
        check("finds .lrtemplate presets", byKey["classic-templates"].files.length === 1, byKey["classic-templates"].files.length);
        check("Adobe's presets are optional", byKey.adobe.defaultEnabled === false);
        app.command("rescan");
        const until = Date.now() + 10000;
        while (Date.now() < until && !app.state.sources.some((s) => s.key === "lightroom" && s.entries.length)) await new Promise((r) => setTimeout(r, 50));
        const lr = app.state.sources.find((s) => s.key === "lightroom");
        check("reads presets and reports broken files", lr && lr.entries.length === 4 && lr.errors.length === 1, lr && `${lr.entries.length} / ${lr.errors.join("; ")}`);
        check("dedupes presets found twice", app.state.entries.length === 9, app.state.entries.length);
        await native("setSettings", { settings: { theme: "system", targets: ["sky"] } });
        const settings = await native("getSettings");
        check("settings round-trip", settings.targets && settings.targets[0] === "sky");
        app.check(app.state.entries.map((e) => e.preset.name));
        app.setTargets(["background", "skin", "water"]);
        const result = await app.create();
        check("creates presets for every mask", result && result.count === 27 && result.zip, JSON.stringify(result));
        const install = await native("installCameraRaw", { files: [{ name: "x.xmp", text: "<x/>" }, { name: "../escape.xmp", text: "no" }] });
        check("installs only safe file names", install.count === 1, JSON.stringify(install));
        return { ...report, result };
        """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] outcome in
            guard let self else { return }
            switch outcome {
            case .failure(let error):
                self.finish(false, "Selftest script failed: \(error)")
            case .success(let value):
                guard let report = value as? [String: Any], let checks = report["checks"] as? [[String: Any]] else { return self.finish(false, "No report") }
                var ok = true
                for c in checks {
                    let passed = c["ok"] as? Bool ?? false
                    ok = ok && passed
                    print("\(passed ? "ok  " : "FAIL") \(c["name"] ?? "")\(passed ? "" : "  (\(c["detail"] ?? ""))")")
                }
                if let result = report["result"] as? [String: Any], let folder = result["folder"] as? String, let zip = result["zip"] as? String {
                    let written = ((try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? []).filter { $0.hasSuffix(".xmp") }.count
                    let zipOK = (try? Data(contentsOf: URL(fileURLWithPath: zip)))?.prefix(4) == Data([0x50, 0x4b, 0x03, 0x04])
                    print("\(written == 27 ? "ok  " : "FAIL") wrote 27 .xmp files to disk (\(written))")
                    print("\(zipOK ? "ok  " : "FAIL") wrote the .zip for Lightroom")
                    ok = ok && written == 27 && zipOK
                }
                let escaped = FileManager.default.fileExists(atPath: self.places.cameraRawUser.appendingPathComponent("escape.xmp").path)
                print("\(escaped ? "FAIL" : "ok  ") nothing written outside the install folder")
                self.finish(ok && !escaped, ok ? "SELFTEST OK" : "SELFTEST FAILED")
            }
        }
    }

    private func takeSnapshot(to path: String) {
        let js = options.js ?? ""
        webView.callAsyncJavaScript("\(js)\n;await new Promise((r) => setTimeout(r, 400));", arguments: [:], in: nil, in: .page) { [weak self] _ in
            guard let self else { return }
            let config = WKSnapshotConfiguration()
            self.webView.takeSnapshot(with: config) { image, error in
                guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    return self.finish(false, "Snapshot failed: \(error?.localizedDescription ?? "no image")")
                }
                do {
                    try png.write(to: URL(fileURLWithPath: path))
                    self.finish(true, "Wrote \(path) (\(rep.pixelsWide)×\(rep.pixelsHigh))")
                } catch {
                    self.finish(false, "Couldn't write \(path): \(error.localizedDescription)")
                }
            }
        }
    }

    private func finish(_ ok: Bool, _ message: String) {
        print(message)
        if places.home.path.contains("lr-mask-presets-selftest-") {
            try? FileManager.default.removeItem(at: places.home.deletingLastPathComponent())
        }
        fflush(stdout)
        exit(ok ? 0 : 1)
    }
}

func jsonString(_ text: String) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: [text])) ?? Data("[\"\"]".utf8)
    return String(String(decoding: data, as: UTF8.self).dropFirst().dropLast())
}

let options = Options.parse(CommandLine.arguments)
let app = NSApplication.shared
let delegate = AppDelegate(options: options)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
