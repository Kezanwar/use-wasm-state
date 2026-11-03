/**
 * EngineClient over a worker.
 *
 * The worker hosts the same SyncClient the main thread would have used, so
 * the wasm side is written once and only the transport differs. Every
 * method returns a Promise, which EngineClient already required; what the
 * sync client adds on top, the *Sync reads, is impossible here and is why
 * the worker store caches instead.
 *
 * Internal. Not exported from src/index.ts.
 */

import type { ColumnSpec, WireQuery } from "./abi";
import type { CellValue, ColumnKind, ColumnValues, EngineMutations } from "./client";
import { disposedError, WasmStateError, type WasmStateErrorCode } from "./errors";
import type { Reply, Request, RequestBody, TableUpdate, WindowSpec } from "./protocol";
/**
 * The worker bundle, next to this one.
 *
 * Resolved the same way engine.wasm is, so a bundler that can emit one
 * asset can emit both. A function rather than a constant, so the
 * import.meta reference is evaluated when a worker is actually asked for
 * and a consumer who passes workerUrl is never blocked by it.
 */
function defaultWorkerUrl(): string {
  return new URL("./worker.js", import.meta.url).href;
}

/** Called with whatever a reply said had changed. */
export type UpdateListener = (handle: number, update: TableUpdate) => void;

export interface WorkerClientOptions {
  wasmUrl: string;
  cache?: boolean;
  /** For a CSP that blocks blob: workers. See WASM_WORKER_SOURCE. */
  workerUrl?: string;
}

interface Pending {
  resolve: (value: Reply) => void;
  reject: (reason: Error) => void;
}

export class WorkerClient implements EngineMutations {
  readonly mode = "worker" as const;

  #worker: Worker | null;
  #pending = new Map<number, Pending>();
  #nextId = 0;
  #listeners = new Set<UpdateListener>();
  /** Which windows each table wants kept fresh, set by its store. */
  #windows = new Map<number, readonly WindowSpec[]>();
  #opened: Promise<void>;

  /**
   * The round trip the last call took: postMessage to reply received,
   * before any subscriber is notified.
   *
   * What a status bar should show. Measuring from a caller would fold in
   * React's render of whatever the reply changed, which is not the
   * engine's time and not what anyone is trying to read.
   */
  lastCallMs = 0;

  constructor(options: WorkerClientOptions) {
    const worker = new Worker(options.workerUrl ?? defaultWorkerUrl(), { type: "module" });
    this.#worker = worker;

    worker.onmessage = (event: MessageEvent<Reply>) => this.#settle(event.data);
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      const error = new WasmStateError(
        "engine",
        0,
        "worker",
        `use-wasm-state: the worker failed: ${event.message || "unknown error"}`
      );
      this.#rejectAll(error);
    };

    this.#opened = this.#send({
      op: "open",
      url: options.wasmUrl,
      cache: options.cache ?? true,
    }).then(() => undefined);
  }

  /** Wait for the module to be loaded in the worker. */
  ready(): Promise<void> {
    return this.#opened;
  }

  /** Called after every reply that carried an update. */
  onUpdate(listener: UpdateListener): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** The windows a table wants refreshed with every reply. */
  setWindows(handle: number, windows: readonly WindowSpec[]): void {
    this.#windows.set(handle, windows);
  }

  #windowsFor(handle: number): readonly WindowSpec[] {
    return this.#windows.get(handle) ?? [];
  }

  #send(request: RequestBody, transfer?: Transferable[]): Promise<Reply> {
    const worker = this.#worker;
    if (!worker) return Promise.reject(disposedError(request.op, "engine"));

    const id = this.#nextId++;
    const message = { ...request, id } as Request;

    const started = performance.now();
    return new Promise<Reply>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (reply) => {
          this.lastCallMs = performance.now() - started;
          resolve(reply);
        },
        reject,
      });
      try {
        worker.postMessage(message, transfer ?? []);
      } catch (err) {
        this.#pending.delete(id);
        // A DataCloneError means something in the request cannot cross,
        // which is a bug in this file rather than in the caller's data.
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  #settle(reply: Reply) {
    const pending = this.#pending.get(reply.id);
    if (!pending) return;
    this.#pending.delete(reply.id);

    if (!reply.ok) {
      pending.reject(
        new WasmStateError(
          reply.error.code as WasmStateErrorCode,
          reply.error.status,
          reply.error.op,
          reply.error.message
        )
      );
      return;
    }
    pending.resolve(reply);
  }

  #rejectAll(reason: Error) {
    for (const pending of this.#pending.values()) pending.reject(reason);
    this.#pending.clear();
  }

  /** Hand an update to whoever is listening, with the handle it describes. */
  #publish(handle: number, reply: Reply) {
    if (!reply.ok || !reply.update) return;
    for (const listener of this.#listeners) listener(handle, reply.update);
  }

  dispose(): void {
    const worker = this.#worker;
    if (!worker) return;
    this.#worker = null;
    worker.terminate();
    this.#listeners.clear();
    this.#windows.clear();
    this.#rejectAll(disposedError("call", "engine"));
  }

  /* ---------------------------------------------------------------- */
  /* EngineClient                                                      */
  /* ---------------------------------------------------------------- */

  async createTable(schema: readonly ColumnSpec[]): Promise<number> {
    await this.#opened;
    const reply = await this.#send({ op: "createTable", schema });
    return (reply as { result: number }).result;
  }

  async dropTable(handle: number): Promise<void> {
    await this.#send({ op: "dropTable", handle });
    this.#windows.delete(handle);
  }

  /**
   * Append rows, transferring the buffers rather than copying them.
   *
   * The arrays are detached on this side afterwards, which is why the
   * store hands over arrays it has just built rather than a caller's.
   */
  async insertColumns(handle: number, columns: readonly ColumnValues[]): Promise<number> {
    const transfer: Transferable[] = [];
    for (const column of columns) {
      const values = column.values as ArrayLike<number> & { buffer?: ArrayBufferLike };
      if (values.buffer instanceof ArrayBuffer) transfer.push(values.buffer);
    }

    const reply = await this.#send(
      { op: "insertColumns", handle, columns, windows: this.#windowsFor(handle) },
      transfer
    );
    this.#publish(handle, reply);
    return (reply as { result: number }).result;
  }

  async setCell(
    handle: number,
    rowId: number,
    col: number,
    kind: ColumnKind,
    value: CellValue
  ): Promise<void> {
    const reply = await this.#send({
      op: "setCell",
      handle,
      rowId,
      col,
      kind,
      value,
      windows: this.#windowsFor(handle),
    });
    this.#publish(handle, reply);
  }

  async deleteRows(handle: number, rowIds: ArrayLike<number>): Promise<void> {
    const ids = Int32Array.from(rowIds);
    const reply = await this.#send(
      { op: "deleteRows", handle, rowIds: ids, windows: this.#windowsFor(handle) },
      [ids.buffer]
    );
    this.#publish(handle, reply);
  }

  async setQuery(handle: number, query: WireQuery): Promise<void> {
    const reply = await this.#send({
      op: "setQuery",
      handle,
      query,
      windows: this.#windowsFor(handle),
    });
    this.#publish(handle, reply);
  }

  /** Ask for the registered windows again, without changing anything. */
  async read(handle: number, windows?: readonly WindowSpec[]): Promise<void> {
    const reply = await this.#send({
      op: "read",
      handle,
      windows: windows ?? this.#windowsFor(handle),
    });
    this.#publish(handle, reply);
  }
}
