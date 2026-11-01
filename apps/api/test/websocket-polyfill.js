// supabase-js builds its realtime client eagerly in createClient(), and
// realtime-js now refuses to start on Node 20 without a native WebSocket
// ("Node.js 20 detected without native WebSocket support"). The repo pins
// Node 20 (.nvmrc, engines), so every spec that creates a Supabase client —
// the RLS/tenant-isolation suites — failed to load. `ws` is already a
// dependency of this app; expose it as the global the factory looks for.
// On Node 22+ the native WebSocket exists and this does nothing.
if (typeof globalThis.WebSocket === 'undefined') {
  // Same shape src/main.ts uses in production.
  globalThis.WebSocket = require('ws').WebSocket;
}
