// The native app is for Android; on iPhone and iPad NoteComplete is the web app (the
// reader added to the Home Screen from Safari), so there is no iOS configuration here.
module.exports = ({ config }) => ({ ...config, plugins: [...(config.plugins || []), './plugins/with-reader.cjs'] });
