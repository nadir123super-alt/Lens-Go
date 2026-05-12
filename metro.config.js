const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('db');

config.resolver.sourceExts.push('js', 'jsx', 'ts', 'tsx');

module.exports = config;