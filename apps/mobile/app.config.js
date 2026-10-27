module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const plugins = [...(config.plugins || []), './plugins/with-reader.cjs'];
  // Android autolinking needs no Firebase config. iOS needs its registered URL scheme.
  if (iosClientId) {
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(iosClientId)) throw Error('Invalid Google iOS client ID');
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: iosClientId.split('.').reverse().join('.') }]);
  }
  return { ...config, plugins };
};
