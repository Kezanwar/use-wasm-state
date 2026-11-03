/**
 * The datagrid engine, running inside a worker.
 *
 * The other end of ./worker-client. It hosts the same SyncClient the main
 * thread would have used, so there is exactly one implementation of talking
 * to wasm and the transport is the only thing that differs. The envelope,
 * the ordering and the error crossing are core/worker/host's; this only
 * answers the datagrid's requests.
 *
 * Internal.
 */

import type { ColumnSpec, EngineExports } from "./abi";
import { WasmStateError } from "../core/errors";
import { instantiateModule } from "../core/wasm/loader";
import { createHost, type Answer, type Host } from "../core/worker/host";
import type { HostPort } from "../core/worker/protocol";
import { SyncClient } from "./sync-client";
import type { Request, GridUpdate, WindowData, WindowSpec } from "./protocol";

export function createGridHost(port: HostPort): Host<Request> {
  let client: SyncClient | null = null;
  const schemas = new Map<number, readonly ColumnSpec[]>();
  // How many dictionary entries the main thread has been sent, per grid
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
  const update = (handle: number, windows: readonly WindowSpec[]): GridUpdate => {
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

  /** An update, with its row data moved rather than copied. */
  const changed = (handle: number, windows: readonly WindowSpec[], result?: unknown): Answer => {
    const next = update(handle, windows);
    const transfer: Transferable[] = [];
    for (const window of next.windows) {
      transfer.push(window.view.ids.buffer);
      for (const column of window.view.columns) transfer.push(column.buffer);
    }
    return { result, update: next, transfer };
  };

  return createHost<Request>(port, async (request) => {
    switch (request.op) {
      case "open": {
        const instance = await instantiateModule(request.url, { cache: request.cache });
        client = new SyncClient(instance.exports as unknown as EngineExports);
        return {};
      }

      case "createGrid": {
        const handle = engine("createGrid").createGridSync(request.schema);
        schemas.set(handle, request.schema);
        return { result: handle };
      }

      case "dropGrid": {
        engine("dropGrid").dropGridSync(request.handle);
        schemas.delete(request.handle);
        return {};
      }

      case "insertColumns": {
        const first = engine("insertColumns").insertColumnsSync(request.handle, request.columns);
        return changed(request.handle, request.windows, first);
      }

      case "setCell": {
        engine("setCell").setCellSync(
          request.handle,
          request.rowId,
          request.col,
          request.kind,
          request.value
        );
        return changed(request.handle, request.windows);
      }

      case "deleteRows": {
        engine("deleteRows").deleteRowsSync(request.handle, request.rowIds);
        return changed(request.handle, request.windows);
      }

      case "setQuery": {
        engine("setQuery").setQuerySync(request.handle, request.query);
        return changed(request.handle, request.windows);
      }

      case "read":
        return changed(request.handle, request.windows);
    }
  });
}
