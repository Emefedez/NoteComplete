// Android network security for the WebView. The bundled reader is served on loopback, and a
// drawing tablet connects to the computer that shares a note (ws://<its LAN address>:<port>,
// docs/COLLABORATION.md). That address is only known when pairing, and Android cannot list
// address ranges, so cleartext is allowed; Google Drive and other services use HTTPS anyway.
exports.networkSecurityConfig = () =>
  '<network-security-config><base-config cleartextTrafficPermitted="true"/></network-security-config>';
