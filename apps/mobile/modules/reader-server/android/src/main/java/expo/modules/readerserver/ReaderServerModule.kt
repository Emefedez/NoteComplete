package expo.modules.readerserver

import android.content.Intent
import android.content.res.AssetManager
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import fi.iki.elonen.NanoHTTPD
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.security.SecureRandom

class ReaderServerModule : Module() {
  private var server: ReaderServer? = null
  override fun definition() = ModuleDefinition {
    Name("ReaderServer")
    AsyncFunction("start") {
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
    OnDestroy { server?.stop(); server = null }
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
