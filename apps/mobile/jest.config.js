/**
 * jest-expo runs the app under the React Native preset. The
 * transformIgnorePatterns entry is pnpm-aware (it allows a `.pnpm/` path
 * segment) — without it, untranspiled ESM inside pnpm's nested expo packages
 * reaches Node as-is and every suite dies on
 * `SyntaxError: Cannot use import statement outside a module`.
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Scoped packages appear TWICE in a pnpm path, with different separators:
  //   node_modules/.pnpm/@react-native+jest-preset@0.86.2_…/node_modules/@react-native/jest-preset/…
  // Jest ignores a file if ANY `node_modules/` occurrence matches, so the
  // allowlist has to accept both `@scope+name` (store dir) and `@scope/name`
  // (link dir). Matching only the `/` form silently leaves the store copy
  // untransformed and every suite dies in the RN preset's ESM setup file.
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?[+/]|expo|@expo[+/]|@expo-google-fonts[+/]|react-navigation|@react-navigation[+/]|@unimodules[+/]|unimodules|sentry-expo|native-base|@supabase[+/]|@sentry[+/]|@testing-library[+/]))',
  ],
  // `app/` MUST be in the denominator. Excluding it meant every screen — the
  // code a user actually touches — sat outside the coverage report while the
  // number looked healthy.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!**/*.test.{ts,tsx}',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
};
