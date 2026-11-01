module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // Must stay last — react-native-worklets (Reanimated 4) requires it.
      'react-native-worklets/plugin',
    ],
  };
};
