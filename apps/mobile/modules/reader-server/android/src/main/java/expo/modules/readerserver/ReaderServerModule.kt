package expo.modules.readerserver

import android.content.res.AssetManager
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
    OnDestroy { server?.stop(); server = null }
  }
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
