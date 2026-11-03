/**
 * The datagrid's worker entry point.
 *
 * Built as its own bundle, datagrid.worker.js, so it carries the engine and
 * nothing else: the main entries import React, which does not exist in a
 * worker. Resolved with `new URL("./datagrid.worker.js", import.meta.url)`,
 * the same way datagrid.wasm is, so a bundler that can emit one asset can
 * emit both.
 *
 * An asset, not API.
 */

import { createGridHost } from "./worker-host";
import type { Request } from "./protocol";

const host = createGridHost({
  postMessage: (reply, transfer) => {
    (self as unknown as Worker).postMessage(reply, transfer ?? []);
  },
});

self.onmessage = (event: MessageEvent<Request>) => {
  // The host queues them, so replies leave in the order requests arrived.
  void host.handle(event.data);
};
