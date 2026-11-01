/**
 * Give Node 20 a global WebSocket, so `@supabase/supabase-js` can be
 * constructed in a CLI script.
 *
 * WHY THIS IS NEEDED AT ALL
 *
 * `createClient()` builds a RealtimeClient in its constructor, whether or not
 * the caller ever subscribes to anything. RealtimeClient requires a WebSocket
 * implementation, and Node only exposes one globally from v22. On Node 20 the
 * constructor throws before a single query runs:
 *
 *   Error: Node.js 20 detected without native WebSocket support.
 *
 * None of these scripts use realtime. They read and write tables. But there is
 * no supported way to ask supabase-js not to build the realtime client, so the
 * dependency has to be satisfied rather than avoided.
 *
 * WHY IT WAS NOT CAUGHT EARLIER
 *
 * Development runs on Node 24, which has native WebSocket, so every script
 * worked locally. Production runs Node 20. The failure appeared the first time
 * the source monitor was run on the production host — which is the only place
 * it actually matters, because that is where the scheduled job lives.
 *
 * Import this for side effects BEFORE creating any Supabase client:
 *
 *   import './lib/node20-websocket';
 *
 * It is a no-op wherever a native WebSocket already exists, so it costs nothing
 * on Node 22+ and can be removed once production's Node is raised.
 */
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  // Required lazily and defensively: on a runtime that already has WebSocket we
  // never get here, and a missing `ws` should not take down a script that would
  // otherwise run fine.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ws = require('ws') as unknown;
    (globalThis as { WebSocket?: unknown }).WebSocket = ws;
  } catch {
    throw new Error(
      'This Node version has no global WebSocket and the "ws" package could ' +
        'not be resolved. @supabase/supabase-js cannot be constructed. ' +
        'Install "ws", or run on Node 22+.',
    );
  }
}
