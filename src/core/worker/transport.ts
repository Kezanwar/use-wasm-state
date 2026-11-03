/**
 * The main thread's end of the envelope: one Worker, requests out, replies
 * matched back by id.
 *
 * Knows nothing about what the requests mean. A pattern's client builds
 * them and reads the replies; this only gets them there and back, times
 * the trip, and turns a failure back into a WasmStateError.
 *
 * Internal.
 */

import { disposedError, WasmStateError, type WasmStateErrorCode } from "../errors";
import type { Body, Envelope, Ok, Reply } from "./protocol";

interface Pending<U> {
  resolve: (reply: Ok<U>) => void;
  reject: (reason: Error) => void;
}

export class WorkerTransport<R extends Envelope, U = unknown> {
  #worker: Worker | null;
  #pending = new Map<number, Pending<U>>();
  #nextId = 0;

  /**
   * The round trip the last call took: postMessage to reply received,
   * before anything that reply changes is rendered.
   *
   * Measuring from a caller would fold in React's work on whatever came
   * back, which is not the engine's time and not what anyone putting a
   * number on screen is trying to show.
   */
  lastCallMs = 0;

  constructor(url: string) {
    const worker = new Worker(url, { type: "module" });
    this.#worker = worker;

    worker.onmessage = (event: MessageEvent<Reply<U>>) => this.#settle(event.data);
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      this.#rejectAll(
        new WasmStateError(
          "engine",
          0,
          "worker",
          `use-wasm-state: the worker failed: ${event.message || "unknown error"}`
        )
      );
    };
  }

  send(body: Body<R>, transfer?: Transferable[]): Promise<Ok<U>> {
    const worker = this.#worker;
    if (!worker) return Promise.reject(disposedError(body.op, "engine"));

    const id = this.#nextId++;
    const started = performance.now();

    return new Promise<Ok<U>>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (reply) => {
          this.lastCallMs = performance.now() - started;
          resolve(reply);
        },
        reject,
      });
      try {
        worker.postMessage({ ...body, id }, transfer ?? []);
      } catch (err) {
        this.#pending.delete(id);
        // A DataCloneError means something in the request cannot cross,
        // which is a bug in the client rather than in the caller's data.
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  dispose(): void {
    const worker = this.#worker;
    if (!worker) return;
    this.#worker = null;
    worker.terminate();
    this.#rejectAll(disposedError("call", "engine"));
  }

  #settle(reply: Reply<U>) {
    const pending = this.#pending.get(reply.id);
    if (!pending) return;
    this.#pending.delete(reply.id);

    if (reply.ok) {
      pending.resolve(reply);
      return;
    }
    const { code, status, op, message } = reply.error;
    pending.reject(new WasmStateError(code as WasmStateErrorCode, status, op, message));
  }

  #rejectAll(reason: Error) {
    for (const pending of this.#pending.values()) pending.reject(reason);
    this.#pending.clear();
  }
}
