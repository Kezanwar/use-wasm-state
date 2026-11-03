/**
 * The worker entry point.
 *
 * Built as its own bundle so it carries the engine and nothing else: the
 * main entry imports React, which does not exist in a worker.
 *
 * Resolved with `new URL("./worker.js", import.meta.url)`, the same way
 * engine.wasm is, so a bundler that can emit one asset can emit both. Pass
 * `workerUrl` where a CSP or a bundler needs it served from somewhere else.
 *
 * Not exported from src/index.ts: it is an asset, not API.
 */

import { createHost } from "./engine/worker-host";
import type { Request } from "./engine/protocol";

const host = createHost({
  postMessage: (reply, transfer) => {
    (self as unknown as Worker).postMessage(reply, transfer ?? []);
  },
});

self.onmessage = (event: MessageEvent<Request>) => {
  // Awaited one at a time, so replies leave in the order requests arrived.
  // The client matches by id, but it also drops replies describing a
  // revision it has moved past, and that test assumes ordering.
  void host.handle(event.data);
};
