/**
 * The datagrid client over a worker.
 *
 * The worker hosts the same SyncClient the main thread would have used, so
 * the wasm side is written once. Getting requests there and back is
 * core/worker/transport's; this builds the datagrid's requests and hands
 * each reply's update to the store it describes.
 *
 * Internal.
 */

import type { ColumnSpec, WireQuery } from "./abi";
import type { CellValue, ColumnKind, ColumnValues, EngineMutations } from "./client";
import { WorkerTransport } from "../core/worker/transport";
import type { Ok } from "../core/worker/protocol";
import type { Request, TableUpdate, WindowSpec } from "./protocol";

/**
 * The worker bundle, next to this one.
 *
 * A function rather than a constant, so the import.meta reference is
 * evaluated when a worker is actually asked for and a consumer who passes
 * workerUrl is never blocked by it.
 */
function defaultWorkerUrl(): string {
  return new URL("./datagrid.worker.js", import.meta.url).href;
}

/** Called with whatever a reply said had changed. */
export type UpdateListener = (handle: number, update: TableUpdate) => void;

export interface WorkerClientOptions {
  wasmUrl: string;
  cache?: boolean;
  /** For a CSP that names an explicit worker-src, or a bundler that moves assets. */
  workerUrl?: string;
}

export class WorkerClient implements EngineMutations {
  readonly mode = "worker" as const;

  #transport: WorkerTransport<Request, TableUpdate>;
  #listeners = new Set<UpdateListener>();
  /** Which windows each table wants kept fresh, set by its store. */
  #windows = new Map<number, readonly WindowSpec[]>();
  #opened: Promise<void>;

  constructor(options: WorkerClientOptions) {
    this.#transport = new WorkerTransport(options.workerUrl ?? defaultWorkerUrl());
    this.#opened = this.#transport
      .send({ op: "open", url: options.wasmUrl, cache: options.cache ?? true })
      .then(() => undefined);
  }

  /** The round trip the last call took. See WorkerTransport.lastCallMs. */
  get lastCallMs(): number {
    return this.#transport.lastCallMs;
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

  /** Hand an update to whoever is listening, with the handle it describes. */
  #publish(handle: number, reply: Ok<TableUpdate>) {
    if (!reply.update) return;
    for (const listener of this.#listeners) listener(handle, reply.update);
  }

  dispose(): void {
    this.#transport.dispose();
    this.#listeners.clear();
    this.#windows.clear();
  }

  /* ---------------------------------------------------------------- */
  /* EngineMutations                                                   */
  /* ---------------------------------------------------------------- */

  async createTable(schema: readonly ColumnSpec[]): Promise<number> {
    await this.#opened;
    const reply = await this.#transport.send({ op: "createTable", schema });
    return reply.result as number;
  }

  async dropTable(handle: number): Promise<void> {
    await this.#transport.send({ op: "dropTable", handle });
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

    const reply = await this.#transport.send(
      { op: "insertColumns", handle, columns, windows: this.#windowsFor(handle) },
      transfer
    );
    this.#publish(handle, reply);
    return reply.result as number;
  }

  async setCell(
    handle: number,
    rowId: number,
    col: number,
    kind: ColumnKind,
    value: CellValue
  ): Promise<void> {
    const reply = await this.#transport.send({
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
    const reply = await this.#transport.send(
      { op: "deleteRows", handle, rowIds: ids, windows: this.#windowsFor(handle) },
      [ids.buffer]
    );
    this.#publish(handle, reply);
  }

  async setQuery(handle: number, query: WireQuery): Promise<void> {
    const reply = await this.#transport.send({
      op: "setQuery",
      handle,
      query,
      windows: this.#windowsFor(handle),
    });
    this.#publish(handle, reply);
  }

  /** Ask for the registered windows again, without changing anything. */
  async read(handle: number, windows?: readonly WindowSpec[]): Promise<void> {
    const reply = await this.#transport.send({
      op: "read",
      handle,
      windows: windows ?? this.#windowsFor(handle),
    });
    this.#publish(handle, reply);
  }
}
