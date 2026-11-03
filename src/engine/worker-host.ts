/**
 * The engine, running inside a worker.
 *
 * This is the other end of src/engine/worker-client.ts. It hosts the same
 * SyncClient the main thread would have used, so there is exactly one
 * implementation of talking to wasm and the transport is the only thing
 * that differs.
 *
 * Written as a function over a port rather than against `self`, so the
 * tests can drive it through a fake port in Node where there is no Worker.
 *
 * Internal. Not exported from src/index.ts.
 */

import type { ColumnSpec, EngineExports } from "./abi";
import { instantiateModule } from "../internal/wasm/loader";
import { SyncClient } from "./sync-client";
import { WasmStateError } from "./errors";
import type { Reply, Request, TableUpdate, WindowData, WindowSpec } from "./protocol";

/** The half of a MessagePort this needs, so a test can supply its own. */
export interface HostPort {
  postMessage(message: Reply, transfer?: Transferable[]): void;
}

export interface Host {
  handle(request: Request): Promise<void>;
}

/**
 * Build a host bound to one port.
 *
 * Replies go out in the order the requests came in, because each one is
 * awaited before the next is read. The client relies on that: it matches
 * by id, but it also drops anything describing a revision it has already
 * moved past, and out-of-order replies would make that test wrong.
 */
export function createHost(port: HostPort): Host {
  let client: SyncClient | null = null;
  const schemas = new Map<number, readonly ColumnSpec[]>();
  // How many dictionary entries the main thread has been sent, per table
  // and column. Deltas are computed from this, so nothing is sent twice.
  const sent = new Map<string, number>();

  const keyFor = (handle: number, col: number) => `${handle}:${col}`;

  const engine = (op: string): SyncClient => {
    if (!client) {
      throw new WasmStateError("disposed", 0, op, `use-wasm-state: ${op} before the engine opened`);
    }
    return client;
  };

  /**
   * Everything the store needs to know after a change, in one reply.
   *
   * Dictionary deltas first, because the windows it is about to send may
   * contain ids the main thread cannot resolve yet.
   */
  const update = (handle: number, windows: readonly WindowSpec[]): TableUpdate => {
    const c = engine("read");
    const schema = schemas.get(handle) ?? [];

    const dictionaries: Record<number, string[]> = {};
    for (let col = 0; col < schema.length; col++) {
      if (schema[col]!.type !== 2) continue;
      const key = keyFor(handle, col);
      const known = sent.get(key) ?? 0;
      const length = c.dictLenSync(handle, col);
      if (length === known) continue;
      dictionaries[col] = c.dictSinceSync(handle, col, known);
      sent.set(key, length);
    }

    const out: WindowData[] = [];
    for (const window of windows) {
      out.push({
        start: window.start,
        count: window.count,
        view: c.viewSync(handle, window.start, window.count, schema),
      });
    }

    return {
      revision: c.revisionSync(handle),
      rowCount: c.rowCountSync(handle),
      totalRows: c.totalRowsSync(handle),
      dictionaries,
      windows: out,
    };
  };

  /** Row data goes back by transfer, not by copy. */
  const transfersOf = (update: TableUpdate): Transferable[] => {
    const out: Transferable[] = [];
    for (const window of update.windows) {
      out.push(window.view.ids.buffer);
      for (const column of window.view.columns) out.push(column.buffer);
    }
    return out;
  };

  return {
    async handle(request: Request) {
      try {
        switch (request.op) {
          case "open": {
            const instance = await instantiateModule(request.url, { cache: request.cache });
            client = new SyncClient(instance.exports as unknown as EngineExports);
            port.postMessage({ id: request.id, ok: true });
            return;
          }

          case "createTable": {
            const handle = engine("createTable").createTableSync(request.schema);
            schemas.set(handle, request.schema);
            port.postMessage({ id: request.id, ok: true, result: handle });
            return;
          }

          case "dropTable": {
            engine("dropTable").dropTableSync(request.handle);
            schemas.delete(request.handle);
            port.postMessage({ id: request.id, ok: true });
            return;
          }

          case "insertColumns": {
            const first = engine("insertColumns").insertColumnsSync(
              request.handle,
              request.columns
            );
            const result = update(request.handle, request.windows);
            port.postMessage(
              { id: request.id, ok: true, result: first, update: result },
              transfersOf(result)
            );
            return;
          }

          case "setCell": {
            engine("setCell").setCellSync(
              request.handle,
              request.rowId,
              request.col,
              request.kind,
              request.value
            );
            const result = update(request.handle, request.windows);
            port.postMessage({ id: request.id, ok: true, update: result }, transfersOf(result));
            return;
          }

          case "deleteRows": {
            engine("deleteRows").deleteRowsSync(request.handle, request.rowIds);
            const result = update(request.handle, request.windows);
            port.postMessage({ id: request.id, ok: true, update: result }, transfersOf(result));
            return;
          }

          case "setQuery": {
            engine("setQuery").setQuerySync(request.handle, request.query);
            const result = update(request.handle, request.windows);
            port.postMessage({ id: request.id, ok: true, update: result }, transfersOf(result));
            return;
          }

          case "read": {
            const result = update(request.handle, request.windows);
            port.postMessage({ id: request.id, ok: true, update: result }, transfersOf(result));
            return;
          }
        }
      } catch (err) {
        port.postMessage({ id: request.id, ok: false, error: serialize(err, request.op) });
      }
    },
  };
}

/**
 * Errors cannot be posted, so they travel as the fields that matter and are
 * rebuilt as a WasmStateError on the other side. The code, status and op
 * survive, which is what a caller switches on.
 */
function serialize(err: unknown, op: string) {
  if (err instanceof WasmStateError) {
    return { code: err.code, status: err.status, op: err.op, message: err.message };
  }
  return {
    code: "engine",
    status: 0,
    op,
    message: err instanceof Error ? err.message : String(err),
  };
}
