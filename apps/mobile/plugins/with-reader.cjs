const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = config => {
  config = withAndroidManifest(config, config => {
    config.modResults.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/reader_network_security';
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const main = path.join(config.modRequest.platformProjectRoot, 'app/src/main');
    await fs.mkdir(path.join(main, 'res/xml'), { recursive: true });
    await fs.writeFile(path.join(main, 'res/xml/reader_network_security.xml'), '<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain>127.0.0.1</domain><domain>localhost</domain></domain-config></network-security-config>');
    const source = path.join(config.modRequest.projectRoot, '../desktop/reader');
    await fs.access(path.join(source, 'index.html'));
    await fs.rm(path.join(main, 'assets/reader'), { recursive: true, force: true });
    await fs.cp(source, path.join(main, 'assets/reader'), { recursive: true });
    return config;
  }]);
};
