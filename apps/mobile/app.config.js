// The native app is for Android; on iPhone and iPad NoteComplete is the web app (the
// reader added to the Home Screen from Safari), so there is no iOS configuration here.
// Every release gets a higher Android versionCode, from its version (1.2.29 → 10229), so
// phones always take a new APK as an update of the one installed.
const versionCode = (version) => {
  const [major, minor, patch] = String(version).split('.').map((n) => Number.parseInt(n, 10));
  if (![major, minor, patch].every((n) => Number.isInteger(n) && n >= 0 && n < 100)) throw Error(`Version ${version} must be major.minor.patch, each below 100`);
  return major * 10000 + minor * 100 + patch;
};
module.exports = ({ config }) => ({
  ...config,
  android: { ...config.android, versionCode: versionCode(config.version) },
  plugins: [...(config.plugins || []), './plugins/with-reader.cjs'],
});
module.exports.versionCode = versionCode;
