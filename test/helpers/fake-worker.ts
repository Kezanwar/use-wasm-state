import { vi } from "vitest";
import { createGridHost } from "../../src/datagrid/worker-host";
import type { GridReply, Request } from "../../src/datagrid/protocol";

/**
 * A Worker that is really the datagrid host, a microtask away.
 *
 * Node and jsdom have no Worker. Everything below the transport is the code
 * that ships: the same host, the same client, the same engine. Only the
 * thread boundary is pretend.
 */
export class FakeWorker {
  onmessage: ((event: MessageEvent<GridReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  #host = createGridHost({
    postMessage: (reply) => {
      // A microtask, so a caller cannot observe a reply before its own
      // postMessage has returned.
      void Promise.resolve().then(() => {
        if (!this.terminated) {
          this.onmessage?.({ data: reply as GridReply } as MessageEvent<GridReply>);
        }
      });
    },
  });

  postMessage(request: Request) {
    if (this.terminated) return;
    void this.#host.handle(request);
  }

  terminate() {
    this.terminated = true;
  }
}

/** Every fake worker made since the last reset, in order. */
export const workers: FakeWorker[] = [];

/** Install the fake as the global Worker. */
export function stubWorker(): void {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      }
    }
  );
}
