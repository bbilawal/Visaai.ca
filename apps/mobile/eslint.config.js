// Flat config built on eslint-config-expo (which bundles the React, React
// Hooks, and React Native rule sets Expo ships with).
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: ['node_modules/**', 'ios/**', 'android/**', '.expo/**', 'dist/**'],
  },
  {
    rules: {
      // Immigration data + tokens flow through this app; a stray console.log in
      // a release build is a plausible way to leak either into a device log.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
];
