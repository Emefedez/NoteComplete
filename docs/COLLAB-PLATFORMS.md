# Plataformas gratuitas y de mínimo setup para apuntes colaborativos en NoteComplete

**Estado:** Investigación y diseño de arquitectura (complementa [`COLLABORATION.md`](COLLABORATION.md) y [`ONLINE-SHARING.md`](ONLINE-SHARING.md)).

---

## 1. El problema: dos tipos de colaboración y el cuello de botella del "setup"

Cuando varias personas comparten apuntes (en clase, estudiando para un examen o preparando resúmenes en grupo), necesitan dos modos complementarios:

1. **Colaboración en tiempo real (síncrona):** Escribir apuntes Markdown/chino a la vez (Yjs) o dibujar sobre el mismo cuaderno/pizarra (`CollabHub` con log secuencial de trazos) desde el navegador, iPad, Android o escritorio, **entrando solo con un enlace, código PIN o QR**.
2. **Cuaderno de grupo persistente (asíncrono):** Una carpeta compartida donde el grupo guarda los `.nfedit`, `.noteful`, `.md`, PDFs y mazos `.ncstudy`, con detección de versiones y comparación de páginas (`versions.js`), **sin que cada estudiante tenga que crear claves OAuth en consolas de desarrollador**.

Hoy en NoteComplete:
- El modo en vivo por internet (`apps/desktop/tunnel.js` + `apps/desktop/collab-server.js`) funciona muy bien si el anfitrión usa la **app de escritorio** (levanta un túnel temporal de Cloudflare), pero **no permite ser anfitrión desde la web/iPad/PWA**.
- Google Drive (`drive-client.js`) y Dropbox (`dropbox-client.js`) permiten enlazar bibliotecas personales, pero requieren configurar un `Client ID` / `App Key` OAuth si el usuario despliega su propia copia.

---

## 2. Comparativa de plataformas gratuitas y de bajo/cero setup

| Plataforma / Protocolo | Modo principal | Setup para el usuario final | Coste / Plan gratuito | Cómo encaja con NoteComplete | Limitaciones principales |
|---|---|---|---|---|---|
| **1. Cloudflare Workers + Durable Objects (`PartyServer`)** | **Tiempo real** (+ caché temporal en SQLite) | **Cero** (1 clic → enlace / QR / PIN de 6 dígitos) | **Gratis** (100k req/día, 5 GB SQLite, mensajes WS salientes gratis, hibernación sin coste en reposo, frames de hasta 32 MiB) | Ejecuta `CollabHub` (`apps/desktop/collab-hub.js`) tal cual en el edge: un Durable Object por sala (`/room/<id>`). Funciona desde Web, iPad, Android y Desktop. | Si un único relay gratuito es compartido por miles de usuarios, conviene límite por sala + opción de 1-clic "Deploy to Cloudflare". |
| **2. WebRTC Serverless P2P (`Trystero` sobre Nostr / BitTorrent / MQTT)** | **Tiempo real P2P** (sin servidor propio) | **Cero** (enlace con `#room=...` cifrado extremo a extremo) | **100 % gratis** (0 servidores que mantener; funciona desde GitHub Pages estático) | Usa relays públicos gratuitos (Nostr/WebTorrent) **solo** para el handshake SDP cifrado (~2 KB) y envía Yjs + bloques de 64 KiB directo entre navegadores por `RTCDataChannel`. | En ~10–15 % de redes universitarias/móviles con NAT simétrico estricto falla sin un servidor TURN (requiere TURN gratuito como Cloudflare Calls / Metered). |
| **3. Nextcloud / OwnCloud WebDAV (Enlaces públicos de carpeta)** | **Asíncrono / Carpeta de grupo** (lectura y escritura) | **Casi cero** (pegar 1 enlace público `https://.../s/Token` + contraseña opcional; **sin OAuth ni cuentas**) | **Gratis** (instancias universitarias/RedIRIS, o proveedores gratuitos como Tab.Digital / Disroot / autoalojado) | Un enlace compartido de Nextcloud expone un endpoint WebDAV (`public.php/webdav`) donde el token del enlace *es* la credencial. Permite listar (`PROPFIND`), bajar (`GET`) y subir (`PUT`) `.nfedit`/`.md` con `versions.js`. | No es tiempo real carácter a carácter (es sincronización por archivo/revisión, ideal para bibliotecas de asignatura). |
| **4. Google Drive / Dropbox (Carpetas compartidas)** | **Asíncrono / Biblioteca en la nube** | **Bajo** si la web ya trae el Client ID del proyecto; **Medio** si cada usuario registra su App Key | **Gratis** (15 GB en Drive, 2 GB en Dropbox) | Ya integrados en lectura (`drive-browser.js`, `dropbox-browser.js`) y guardado en Drive (`drive:sign-in` con `drive.file`). | Requiere cuenta de Google/Dropbox por participante y flujo OAuth 2 PKCE. |
| **5. Supabase (Realtime Broadcast + Storage)** | **Tiempo real + Almacenamiento** | **Cero** para invitados (si el grupo comparte URL/anon key de su proyecto) | **Gratis** (500 MB DB, 1 GB Storage, 200 conexiones concurrentes, 2M mensajes/mes) | Canal Broadcast para Yjs y bucket Storage para `.nfedit`. | El proyecto gratuito de Supabase **se pausa tras 7 días de inactividad** (malo para apuntes que se retoman en época de exámenes). |
| **6. GitHub Gists / Repositorios (vía Contents API)** | **Asíncrono / Markdown y proyectos** | **Bajo para perfiles técnicos** (1 token o GitHub Device Flow) | **Gratis** (repos públicos/privados ilimitados) | Ideal para apuntes en Markdown (`.md`), código Java/R y diagramas PlantUML (`.puml`) con historial Git completo. | Incómodo para usuarios no técnicos o archivos `.noteful` binarios > 50 MB. |

---

## 3. Recomendación: La combinación ideal para NoteComplete

Para lograr **cero fricción para los usuarios** y **coste cero de infraestructura**, la mejor arquitectura combina **tres piezas** que reutilizan el 95 % del código que ya existe en NoteComplete:

### A. Para sesiones en vivo desde cualquier dispositivo (Web, iPad, Android, Desktop):
#### **Opción 1 (Estándar): Relay híbrido con Cloudflare Durable Objects + Fallback P2P (`Trystero`)**
1. **Modo P2P instantáneo sin servidor (`Trystero` + WebRTC):**
   - Funciona directamente desde GitHub Pages (`https://emefedez.github.io/NoteComplete/`) con **cero servidores y cero cuentas**.
   - El anfitrión pulsa **Share → Live room**, se genera una clave efímera derivada del código de sala + PIN (cifrado AES-GCM), los navegadores se descubren en <1 s mediante relays públicos Nostr/WebTorrent y abren un `RTCDataChannel` directo por el que circula exactamente el protocolo de `CollabHub` (`apps/desktop/collab-hub.js`).
2. **Modo Relay en Cloudflare Durable Objects (cuando hay firewall/NAT universitario o grupos grandes):**
   - Si WebRTC directo no conecta en 3–4 segundos (o si hay >5 personas en una clase), cae automáticamente a un Worker de Cloudflare con Durable Objects (`docs/ONLINE-SHARING.md`).
   - Como `CollabHub` ya está desacoplado de Node sockets, el Durable Object simplemente instancia `CollabHub` en el edge.
   - Incluye un botón **"Use custom relay / Deploy to Cloudflare"** por si una clase o universidad quiere su propio endpoint gratuito independiente.

### B. Para compartir archivos y dejar cambios guardados gratis: **GitHub / Servidor con "Partido Automático" (Content-Addressed Chunked Repo)**

El mayor obstáculo para usar **GitHub** (o cualquier hosting gratuito como Cloudflare Pages/R2, GitLab, Codeberg o WebDAV gratuito) con apuntes manuscritos es que un archivo `.noteful` o `.nfedit` monolítico puede pesar **30–150 MB** (por el PDF de fondo, imágenes y audio).
- Si se sube como un único archivo binario, **cada vez que alguien añade un trazo o corrige una línea y guarda (`Ctrl+S`), habría que resubir 80 MB enteros**: el historial de Git explota a gigabytes en pocos guardados, falla el límite de la API REST de GitHub (25 MB en `/contents`, 100 MB límite duro por blob en Git, y Git LFS gratuito solo da 1 GB/mes).

La solución es que NoteComplete guarde el cuaderno en el repositorio **partido automáticamente en trozos inmutables deduplicados (chunks) + archivos pequeños por página y Markdown**:

---

## 4. Arquitectura de "Partido Automático" (Auto-Chunked Storage) sobre GitHub / Hosting Gratuito

### 4.1 Estructura del cuaderno partido en el repositorio

En lugar de subir `Tema1.nfedit` (80 MB) como un solo bloque opaco, NoteComplete lo descompone automáticamente al sincronizar:

```text
apuntes-asignatura/
├── index.json                      # Catálogo de cuadernos del repositorio (títulos, portadas, hashes)
└── notebooks/
    └── tema-1-calculo/
        ├── manifest.json           # Metadatos (~2 KB): páginas, capas, referencias a chunks de PDF/audio, digest
        ├── cover.webp              # Miniatura de portada (~15 KB) para mostrar en Home instantáneamente
        ├── notes.md                # Apuntes Markdown/chino en texto plano (legible en la web de GitHub y diffable)
        ├── study/
        │   ├── flashcards.json     # Mazos de tarjetas (~5–20 KB)
        │   └── quizzes.json        # Tests guardados (~5–20 KB)
        ├── pages/
        │   ├── page-0001.json      # Trazos, cajas de texto, prefabs y ajustes SOLO de la página 1 (~4–80 KB)
        │   ├── page-0002.json      # Trazos y elementos SOLO de la página 2
        │   └── ...
        └── chunks/                 # Bloques binarios pesados (PDFs, imágenes grandes, audio) partidos a ≤ 4 MiB
            ├── sha256-9f86d081...bin   # Trozo 1 del PDF base (4 MiB, inmutable)
            ├── sha256-4b227777...bin   # Trozo 2 del PDF base (4 MiB, inmutable)
            └── sha256-e3b0c442...bin   # Imagen o segmento de audio (≤ 4 MiB, inmutable)
```

### 4.2 Por qué el partido automático hace que el hosting gratuito funcione sin límites

1. **Los PDFs, audios e imágenes pesadas se suben UNA SOLA VEZ:**
   - Todo binario grande (PDF base, grabación de voz, imagen importada) se corta en bloques de **4 MiB** nombrados por su hash `sha256-<hex>.bin` (o comprimidos con `gzip`/`deflate`).
   - 4 MiB está muy por debajo del límite de la API de GitHub (25–100 MB), de jsDelivr CDN (20 MB) y de Cloudflare Workers.
   - Cuando un compañero abre el cuaderno, subraya 3 páginas, escribe apuntes en chino/Markdown y pulsa **Guardar (`Ctrl+S`)**, NoteComplete comprueba qué hashes ya existen en `chunks/` y **solo sube el `page-0003.json` (~15 KB) y `notes.md` (~4 KB)**. ¡El guardado tarda **menos de 1 segundo** y consume kilobytes en lugar de 80 MB!
2. **Carga progresiva instantánea (Lazy Chunk Loading):**
   - Para abrir un cuaderno de 200 páginas desde GitHub, NoteComplete descarga primero `manifest.json` + `pages/page-0001.json` + solo el chunk del PDF que contiene las primeras páginas (o un PDF partido por rangos de páginas). El usuario empieza a leer y escribir en 1 segundo mientras el resto de chunks se descargan en segundo plano y quedan cacheados en IndexedDB.
3. **Cero conflictos al editar páginas distintas (Merge automático):**
   - Al estar separado en `pages/page-0001.json`, `pages/page-0002.json`, `notes.md` y `study/flashcards.json`:
     - Si la Persona A dibuja en la Página 2 y la Persona B dibuja en la Página 5 (o edita `notes.md`), **modifican archivos distintos del árbol Git**.
     - Si ambos editan la **misma página** al mismo tiempo:
       - Como cada elemento (`stroke`, `text`, `prefab`) tiene su ID/autor o log de operaciones, NoteComplete puede **unir automáticamente los trazos nuevos de ambos** si son aditivos, o abrir la ventana visual **`Compare…` (`versions.js`)** mostrando lado a lado "Tu página vs. Versión en GitHub" para elegir con un clic.
4. **Híbrido opcional con GitHub Releases para archivos gigantes (> 500 MB de audio/vídeo):**
   - Si una asignatura tiene decenas de horas de audio grabado, los chunks de audio (`sha256-*.bin`) pueden colgarse automáticamente como assets de un *tag* `chunks-store` en **GitHub Releases** (donde GitHub permite archivos de hasta **2 GB por asset** sin consumir cuota de Git ni LFS), mientras que `manifest.json`, `notes.md` y `pages/*.json` viven en los commits normales de Git.

---

## 5. Cómo hacer que el setup sea casi CERO para los usuarios

Para que cualquier grupo de amigos o clase lo use gratis sin saber programar ni instalar Git:

### Modo 1: "Enlace de Clase con PIN" sobre GitHub (0 servidores o 1 Cloudflare Worker gratuito)
1. **Crear el cuaderno compartido (1 sola persona del grupo, 1 vez):**
   - Crea un repositorio en GitHub (público o privado, ej. `usuario/apuntes-2026`).
   - Genera un **Fine-Grained Personal Access Token** en GitHub limitado **exclusivamente** a ese repositorio (`Contents: Read and Write`).
   - En NoteComplete (**Home → Cloud → GitHub Shared Notebook**), pega el repo y el token, y elige un **PIN de grupo** (ej. `fisica24`).
   - NoteComplete genera un **enlace de invitación** donde el token va cifrado con AES-GCM usando ese PIN (`https://emefedez.github.io/NoteComplete/#gh=<repo>&key=<encrypted-token>`), o bien a través de un micro-Worker gratuito en Cloudflare que guarda el token y valida el PIN de la clase.
2. **Unirse y colaborar (el resto de compañeros — 0 cuentas, 0 setup):**
   - Abren el enlace que les pasan por WhatsApp/Telegram/Discord e introducen el PIN `fisica24`.
   - **¡Listo!** Ya ven la carpeta compartida en **Home → Cloud**, abren cualquier tema, hacen cambios y al pulsar **`Ctrl+S` (Guardar)** los cambios se suben partidos automáticamente al repositorio de GitHub para todos los demás.
   - Si solo quieren **leer** (y el repo es público), **ni siquiera necesitan PIN ni token**: NoteComplete lee `index.json`, `manifest.json`, `pages/*.json` y `chunks/*` directamente por HTTPS (`raw.githubusercontent.com` / GitHub API).

### Modo 2: Cómo funciona un `Ctrl+S` por dentro (Git Data API en 1 commit atómico)
Cuando un usuario guarda cambios en NoteComplete conectado al repositorio:
1. Calcula en el worker WASM/JS qué páginas cambiaron respecto al último `manifest.json` descargado (ej. `page-0004.json` y `notes.md`) y si hay algún chunk binario nuevo (`sha256-...bin` que no estuviera listado en `manifest.json`).
2. Sube los blobs nuevos en paralelo (`POST /repos/{owner}/{repo}/git/blobs`).
3. Lee el `HEAD` actual (`GET /repos/{owner}/{repo}/git/ref/heads/main`):
   - Si nadie más guardó mientras tanto, crea un árbol Git (`POST /git/trees` con `base_tree: <headTreeSha>`) reemplazando solo `pages/page-0004.json`, `notes.md` y `manifest.json`.
   - Si otro compañero guardó hace unos segundos (`HEAD` avanzó):
     - Si el compañero tocó otras páginas (`page-0007.json`), NoteComplete aplica los cambios propios sobre el nuevo `base_tree` del compañero automáticamente (**auto-merge sin molestar al usuario**).
     - Si ambos tocaron `page-0004.json`, fusiona las listas de trazos/cajas o muestra el diálogo `Compare…` (`versions.js`).
4. Crea el commit (`POST /git/commits`) y avanza la rama (`PATCH /repos/{owner}/{repo}/git/refs/heads/main`).
5. **Reconstrucción local de `.nfedit` / `.noteful`:** En el dispositivo del usuario, NoteComplete recompone en memoria (y en IndexedDB) el documento nativo a partir de `manifest.json + pages/*.json + chunks/*`, por lo que **Exportar a PDF / `.noteful` / `.nfedit`** sigue funcionando exactamente igual que hoy.

---

## 6. Hoja de ruta de implementación recomendada

### Fase 1 — Formato de cuaderno partido (`apps/reader/chunked-note.js`) + Sincronización con GitHub (`apps/reader/github-storage.js`)
- **`chunked-note.js`:**
  - `splitNote(nfeditBytes, { chunkSize = 4 * 1024 * 1024 })`: extrae del `.nfedit` el PDF base y los audios en `chunks/sha256-<hash>.bin` (4 MiB), separa las páginas en `pages/page-NNNN.json`, extrae `notes.md` y `study/*.json`, y genera `manifest.json`.
  - `assembleNote(manifest, pages, chunks)`: operación inversa determinista que reconstruye el `.nfedit` en memoria para abrirlo en `worker.js`.
- **`github-storage.js`:**
  - Lectura sin token para repos públicos (`raw.githubusercontent.com` + API) y lectura/escritura atómica con Git Data API (`blobs` → `trees` → `commits` → `refs`).
  - Generador de **enlace de invitación cifrado con PIN** (Web Crypto `PBKDF2` + `AES-GCM`) para que los compañeros de clase entren con 1 clic y un PIN sin crearse cuenta ni token.
  - Auto-merge a nivel de página (`page-NNNN.json`) y reutilización de `versions.js` (`compareDialog`) cuando dos personas editan la misma página.

### Fase 2 — Enlaces de carpeta Nextcloud / WebDAV (`apps/reader/webdav-client.js`)
- El mismo formato partido (`manifest.json` + `pages/*.json` + `chunks/sha256-*.bin`) puede guardarse también sobre un enlace público de carpeta **Nextcloud / OwnCloud** (`https://.../s/<token>` → `public.php/webdav`), dando una alternativa 100 % libre de GitHub para universidades que ya tienen Nextcloud institucional.

### Fase 3 — Co-edición en vivo sin servidor (`Trystero` WebRTC + fallback Cloudflare Durable Objects)
- Cuando dos personas tienen abierto el **mismo cuaderno de GitHub** al mismo tiempo, pueden pulsar **Live** para sincronizar trazos y cursor en tiempo real (`CollabHub` sobre WebRTC / Durable Objects), y al terminar, cualquier participante pulsa **`Ctrl+S`** para dejar el estado consolidado guardado en el repositorio de GitHub.
