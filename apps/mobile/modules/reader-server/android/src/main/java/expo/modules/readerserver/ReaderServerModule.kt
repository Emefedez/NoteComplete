package expo.modules.readerserver

import android.content.Intent
import android.content.res.AssetManager
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import fi.iki.elonen.NanoHTTPD

class ReaderServerModule : Module() {
  private var server: ReaderServer? = null
  override fun definition() = ModuleDefinition {
    Name("ReaderServer")
    AsyncFunction("start") {
      if (server == null) {
        val assets = requireNotNull(appContext.reactContext).assets
        assets.open("reader/index.html").close()
        val next = ReaderServer(assets)
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

@Suppress("DEPRECATION")
private fun sharedUris(intent: Intent): List<String> = when (intent.action) {
  Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.toString())
  Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.map { it.toString() } ?: emptyList()
  else -> emptyList()
}

private class ReaderServer(private val assets: AssetManager) : NanoHTTPD("127.0.0.1", 8768) {
  override fun serve(session: IHTTPSession): Response {
    if (session.method != Method.GET && session.method != Method.HEAD)
      return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "GET only")
    if (session.headers["host"] != "127.0.0.1:8768")
      return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "Invalid host")
    val path = session.uri.removePrefix("/").ifEmpty { "index.html" }
    if (path.split('/').any { it == ".." || it == "." } || path.contains('\\') || path.contains('\u0000'))
      return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
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
