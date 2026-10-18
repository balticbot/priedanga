// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Content-pack files are bundled as opaque `.bin` assets so the app can
// verify their exact bytes against the signed manifest.
if (!config.resolver.assetExts.includes('bin')) config.resolver.assetExts.push('bin');

module.exports = config;
