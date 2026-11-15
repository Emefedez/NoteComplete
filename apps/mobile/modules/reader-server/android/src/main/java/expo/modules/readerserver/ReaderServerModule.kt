package expo.modules.readerserver

import android.app.Activity
import android.content.Intent
import android.content.res.AssetManager
import android.net.Uri
import android.provider.OpenableColumns
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.webkit.MimeTypeMap
import android.webkit.WebView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.lang.reflect.Proxy
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Collections
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

class ReaderServerModule : Module() {
  private var server: ReaderServer? = null
  private var shareServer: ShareHttpServer? = null
  private var shareAddress: String = ""
  private var hoverHookedWindow: Window? = null
  private var originalWindowCallback: Window.Callback? = null

  private fun findWebView(root: View?): WebView? {
    if (root is WebView) return root
    if (root is ViewGroup) {
      for (i in 0 until root.childCount) {
        findWebView(root.getChildAt(i))?.let { return it }
      }
    }
    return null
  }

  private fun installStylusHoverHook() {
    val activity: Activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      val window = activity.window ?: return@runOnUiThread
      if (hoverHookedWindow === window) return@runOnUiThread
      val current = window.callback ?: return@runOnUiThread
      originalWindowCallback = current
      hoverHookedWindow = window
      val proxy = Proxy.newProxyInstance(
        Window.Callback::class.java.classLoader,
        arrayOf(Window.Callback::class.java),
      ) { _, method, args ->
        if (method.name == "dispatchGenericMotionEvent" && args?.size == 1) {
          (args[0] as? MotionEvent)?.let { forwardStylusHover(window, it) }
        }
        val unwrapped = args ?: emptyArray()
        method.invoke(current, *unwrapped)
      } as Window.Callback
      window.callback = proxy
    }
  }

  private fun uninstallStylusHoverHook() {
    val window = hoverHookedWindow ?: return
    val orig = originalWindowCallback
    hoverHookedWindow = null
    originalWindowCallback = null
    window.decorView.post {
      if (window.callback !== orig && orig != null) {
        window.callback = orig
      }
    }
  }

  private fun forwardStylusHover(window: Window, event: MotionEvent) {
    val phase = when (event.actionMasked) {
      MotionEvent.ACTION_HOVER_ENTER -> "enter"
      MotionEvent.ACTION_HOVER_MOVE -> "move"
      MotionEvent.ACTION_HOVER_EXIT -> "exit"
      else -> return
    }
    val pointerIndex = event.actionIndex.coerceIn(0, (event.pointerCount - 1).coerceAtLeast(0))
    val tool = event.getToolType(pointerIndex)
    if (tool != MotionEvent.TOOL_TYPE_STYLUS && tool != MotionEvent.TOOL_TYPE_ERASER) return

    val webView = findWebView(window.decorView) ?: return
    val loc = IntArray(2)
    webView.getLocationInWindow(loc)
    val density = webView.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
    val cssX = (event.getX(pointerIndex) - loc[0]) / density
    val cssY = (event.getY(pointerIndex) - loc[1]) / density
    val dist = event.getAxisValue(MotionEvent.AXIS_DISTANCE, pointerIndex)
    if (!cssX.isFinite() || !cssY.isFinite()) return

    val js = String.format(
      Locale.US,
      "window.__notecompleteNativeHover?.('%s',%.2f,%.2f,'pen',%.2f)",
      phase,
      cssX,
      cssY,
      if (dist.isFinite()) dist else 0f,
    )
    webView.post { webView.evaluateJavascript(js, null) }
  }

  override fun definition() = ModuleDefinition {
    Name("ReaderServer")
    OnCreate { installStylusHoverHook() }
    OnActivityEntersForeground { installStylusHoverHook() }
    AsyncFunction("start") {
      installStylusHoverHook()
      if (server == null) {
        val context = requireNotNull(appContext.reactContext)
        val assets = context.assets
        assets.open("reader/index.html").close()
        // Copies left by an earlier run (killed before the reader took them) are dropped.
        incomingDir(context.cacheDir).listFiles()?.forEach { it.delete() }
        val next = ReaderServer(assets, incomingDir(context.cacheDir))
        next.start(NanoHTTPD.SOCKET_READ_TIMEOUT, true)
        server = next
      }
      "http://127.0.0.1:8768/"
    }
    // The provider's file name and type: content:// URIs rarely carry the real name.
    AsyncFunction("describe") { uri: String ->
      val context = requireNotNull(appContext.reactContext)
      val parsed = Uri.parse(uri)
      var name: String? = null
      if (parsed.scheme == "content") {
        try {
          context.contentResolver.query(parsed, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) name = cursor.getString(0)
          }
        } catch (_: Exception) { /* Some providers refuse queries; the URI's name is used. */ }
      } else name = parsed.lastPathSegment
      val mime = if (parsed.scheme == "content") context.contentResolver.getType(parsed)
        else MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(uri))
      mapOf("name" to name, "mime" to mime)
    }
    // A file another app handed over (WhatsApp, Gmail, Drive) is streamed through the
    // ContentResolver, which honours the intent's URI grant, into the app's cache, and the
    // reader fetches it from this server: files of hundreds of MB never sit whole in the app's
    // heap or cross the WebView bridge as base64. The random name is the only way to ask for it.
    AsyncFunction("stage") { uri: String ->
      val context = requireNotNull(appContext.reactContext)
      val parsed = Uri.parse(uri)
      if (parsed.scheme != "content" && parsed.scheme != "file") throw IllegalArgumentException("Unsupported scheme: ${parsed.scheme}")
      val dir = incomingDir(context.cacheDir).apply { mkdirs() }
      val token = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
      val target = File(dir, token)
      try {
        val input = context.contentResolver.openInputStream(parsed)
          ?: throw FileNotFoundException("The other app did not provide the file.")
        input.use { source -> target.outputStream().use { source.copyTo(it, 1 shl 16) } }
      } catch (e: Exception) { target.delete(); throw e }
      token
    }
    // The reader has the file: its cached copy goes.
    Function("release") { token: String ->
      if (TOKEN.matches(token)) File(incomingDir(requireNotNull(appContext.reactContext).cacheDir), token).delete()
      Unit
    }
    // Files shared to the app (Share → NoteComplete). Linking only reports VIEW intents, so
    // the launch intent's streams are read here once, and later shares arrive as events.
    Events("onShared")
    Function("takeShared") {
      val intent = appContext.currentActivity?.intent ?: return@Function emptyList<String>()
      val uris = sharedUris(intent)
      intent.removeExtra(Intent.EXTRA_STREAM)
      uris
    }
    OnNewIntent { intent ->
      val uris = sharedUris(intent)
      if (uris.isNotEmpty()) sendEvent("onShared", mapOf("uris" to uris))
    }
    AsyncFunction("shareFile") { path: String, name: String, mime: String ->
      val cacheRoot = requireNotNull(appContext.reactContext).cacheDir.canonicalFile
      val target = File(path).canonicalFile
      if (!target.path.startsWith(cacheRoot.path + File.separator) || !target.isFile) {
        throw FileNotFoundException("Invalid shared file")
      }
      val srv = shareServer ?: ShareHttpServer().also { it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false); shareServer = it }
      val addresses = lanIpv4Addresses()
      if (shareAddress !in addresses) shareAddress = addresses.firstOrNull() ?: "127.0.0.1"
      val entry = srv.register(target, name, mime)
      buildSharePayload(entry, srv.listeningPort, addresses)
    }
    AsyncFunction("shareLinks") { id: String, preferred: String? ->
      val srv = shareServer ?: return@AsyncFunction null
      val addresses = lanIpv4Addresses()
      if (!preferred.isNullOrEmpty() && preferred in addresses) {
        shareAddress = preferred
      } else if (shareAddress !in addresses) {
        shareAddress = addresses.firstOrNull() ?: "127.0.0.1"
      }
      val entry = srv.find(id) ?: return@AsyncFunction null
      buildSharePayload(entry, srv.listeningPort, addresses)
    }
    AsyncFunction("unshareFile") { id: String ->
      val srv = shareServer ?: return@AsyncFunction false
      val removed = srv.remove(id)
      if (srv.isEmpty()) {
        srv.stop()
        shareServer = null
      }
      removed
    }
    OnDestroy {
      uninstallStylusHoverHook()
      server?.stop()
      server = null
      shareServer?.clearAll()
      shareServer?.stop()
      shareServer = null
    }
  }

  private fun buildSharePayload(entry: SharedNoteEntry, port: Int, addresses: List<String>): Map<String, Any> {
    val activeAddress = shareAddress.ifEmpty { addresses.firstOrNull() ?: "127.0.0.1" }
    val encoded = URLEncoder.encode(entry.name, "UTF-8").replace("+", "%20")
    return mapOf(
      "id" to entry.id,
      "name" to entry.name,
      "size" to entry.file.length(),
      "port" to port,
      "address" to activeAddress,
      "addresses" to addresses,
      "link" to "http://$activeAddress:$port/share/${entry.id}/${entry.token}/$encoded",
    )
  }
}

private val TOKEN = Regex("[0-9a-f]{32}")
private fun incomingDir(cache: File) = File(cache, "incoming")

@Suppress("DEPRECATION")
private fun sharedUris(intent: Intent): List<String> = when (intent.action) {
  Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.toString())
  Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.map { it.toString() } ?: emptyList()
  else -> emptyList()
}

private class ReaderServer(private val assets: AssetManager, private val incoming: File) : NanoHTTPD("127.0.0.1", 8768) {
  override fun serve(session: IHTTPSession): Response {
    if (session.method != Method.GET && session.method != Method.HEAD)
      return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "GET only")
    if (session.headers["host"] != "127.0.0.1:8768")
      return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "Invalid host")
    val path = session.uri.removePrefix("/").ifEmpty { "index.html" }
    if (path.split('/').any { it == ".." || it == "." } || path.contains('\\') || path.contains('\u0000'))
      return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
    if (path.startsWith("incoming/")) {
      val token = path.removePrefix("incoming/")
      val file = File(incoming, token)
      if (!TOKEN.matches(token) || !file.isFile) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
      return newFixedLengthResponse(Response.Status.OK, "application/octet-stream", FileInputStream(file), file.length()).apply {
        addHeader("Cache-Control", "no-store")
        addHeader("X-Content-Type-Options", "nosniff")
      }
    }
    return try {
      val mime = when (path.substringAfterLast('.')) {
        "js", "mjs" -> "text/javascript"
        "wasm" -> "application/wasm"
        "json", "webmanifest" -> "application/json"
        "svg" -> "image/svg+xml"
        else -> getMimeTypeForFile(path)
      }
      newChunkedResponse(Response.Status.OK, mime, assets.open("reader/$path")).apply {
        addHeader("Cache-Control", "no-store")
        addHeader("X-Content-Type-Options", "nosniff")
        addHeader("Cross-Origin-Opener-Policy", "same-origin")
        addHeader("Cross-Origin-Embedder-Policy", "credentialless")
      }
    } catch (_: java.io.IOException) {
      newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
    }
  }
}

private data class SharedNoteEntry(
  val id: String,
  val token: String,
  val name: String,
  val mime: String,
  val file: File
)

private fun lanIpv4Addresses(): List<String> {
  val out = mutableListOf<String>()
  val ifaces = Collections.list(NetworkInterface.getNetworkInterfaces() ?: return out)
  for (iface in ifaces) {
    if (!iface.isUp || iface.isLoopback || iface.isVirtual) continue
    for (addr in Collections.list(iface.inetAddresses)) {
      if (addr is Inet4Address && !addr.isLoopbackAddress) {
        addr.hostAddress?.let { ip -> if (!out.contains(ip)) out.add(ip) }
      }
    }
  }
  out.sortWith(compareBy { if (it.startsWith("192.168.") || it.startsWith("10.")) 0 else 1 })
  return out
}

private class ShareHttpServer : NanoHTTPD("0.0.0.0", 0) {
  private val entries = ConcurrentHashMap<String, SharedNoteEntry>()

  fun register(file: File, name: String, mime: String): SharedNoteEntry {
    val digest = MessageDigest.getInstance("SHA-256").digest("${System.nanoTime()}-${file.absolutePath}".toByteArray())
    val hex = digest.joinToString("") { "%02x".format(it) }
    val id = hex.substring(0, 12)
    val token = hex.substring(12, 44)
    val entry = SharedNoteEntry(id = id, token = token, name = name, mime = mime, file = file)
    entries[id] = entry
    return entry
  }

  fun find(id: String): SharedNoteEntry? = entries[id]

  fun remove(id: String): Boolean {
    val prev = entries.remove(id) ?: return false
    prev.file.delete()
    return true
  }

  fun clearAll() {
    for (entry in entries.values) {
      entry.file.delete()
    }
    entries.clear()
  }

  fun isEmpty(): Boolean = entries.isEmpty()

  override fun serve(session: IHTTPSession): Response {
    if (session.method != Method.GET && session.method != Method.HEAD) {
      return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "Method not allowed")
    }
    val parts = session.uri.trim('/').split('/')
    if (parts.size < 3 || parts[0] != "share") {
      return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
    }
    val id = parts[1]
    val token = session.parameters["t"]?.firstOrNull() ?: parts[2]
    val entry = entries[id] ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
    if (token != entry.token || !entry.file.isFile) {
      return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "Forbidden")
    }
    val encoded = URLEncoder.encode(entry.name, "UTF-8").replace("+", "%20")
    val response = if (session.method == Method.HEAD) {
      newFixedLengthResponse(Response.Status.OK, entry.mime, "")
    } else {
      newFixedLengthResponse(Response.Status.OK, entry.mime, ByteArrayInputStream(entry.file.readBytes()), entry.file.length())
    }
    response.addHeader("Content-Disposition", "attachment; filename*=UTF-8''$encoded")
    response.addHeader("Cache-Control", "no-store")
    return response
  }
}
