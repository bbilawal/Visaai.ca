/** Isolated jsdom Jest config for extension DOM-side tests (executor/readback).
 *  Forces CommonJS transpile so ts-jest doesn't emit ESM under the extension's
 *  bundler tsconfig. Separate from the api Jest project. */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'ES2022',
          esModuleInterop: true,
          skipLibCheck: true,
          lib: ['ES2022', 'DOM'],
          // 'jest' for describe/it; 'node' is deliberately absent because the
          // package is not installed here, so package-shippable.spec.ts reaches
          // Node builtins through require() rather than typed imports.
          types: ['jest'],
        },
      },
    ],
  },
}
