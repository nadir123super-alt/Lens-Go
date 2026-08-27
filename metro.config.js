const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('db');
config.resolver.assetExts.push('wasm');
config.resolver.sourceExts.push('js', 'jsx', 'ts', 'tsx');

// Detect if this is a web export build (expo export -p web)
const argv = process.argv;
const isWeb = argv.includes('-p') && argv[argv.indexOf('-p') + 1] === 'web';

if (isWeb) {
  // On web, stub out the dictionary.db asset so the 97MB file is NOT bundled.
  // The web build never uses the dictionary (guarded by Platform.OS === 'web').
  const defaultResolver = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName.includes('dictionary.db')) {
      return { type: 'empty' };
    }
    if (defaultResolver) {
      return defaultResolver(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
