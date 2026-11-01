// Metro config for the pnpm workspace. The default config only watches the app
// directory, so `@visaai/types` (a workspace symlink into ../../packages) would
// fail to resolve. We add the repo root as a watch folder and expose both the
// app-local and root node_modules directories.
//
// NOTE: pnpm's isolated node_modules layout is intentionally kept (no
// node-linker=hoisted). Flipping the linker would force a full reinstall of
// apps/web and apps/api, which is a needless regression risk for those apps.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Symlinks are how pnpm links workspace packages; Metro must follow them.
config.resolver.unstable_enableSymlinks = true;

// `disableHierarchicalLookup` is DELIBERATELY NOT SET.
//
// It is the recipe for npm/yarn *hoisted* monorepos, where every dependency is
// flat in a known root. pnpm's isolated layout is the opposite: react-native's
// own transitive deps (invariant, nullthrows, @react-native/virtualized-lists)
// live inside node_modules/.pnpm/react-native@x/node_modules/ and are ONLY
// reachable by walking parent directories. Disabling that walk makes the bundle
// fail with "Module does not exist in the Haste module map" — verified.

module.exports = config;
