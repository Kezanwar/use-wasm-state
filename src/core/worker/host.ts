/**
 * The worker's end of the envelope.
 *
 * Written over a port rather than against `self`, so tests drive it
 * through a fake one in Node where there is no Worker. A pattern supplies
 * one function that answers a request; this turns its result or its throw
 * into a reply.
 *
 * Replies leave in the order requests arrived, because each is awaited
 * before the next is read. A client can rely on that to drop anything
 * describing a state it has already moved past.
 *
 * Internal.
 */

import { WasmStateError } from "../errors";
import type { Envelope, HostPort, SerializedError } from "./protocol";

/** What answering a request produced. */
export interface Answer {
  result?: unknown;
  update?: unknown;
  /** Buffers to move rather than copy. */
  transfer?: Transferable[];
}

export interface Host<R extends Envelope> {
  handle(request: R): Promise<void>;
}

export function createHost<R extends Envelope>(
  port: HostPort,
  answer: (request: R) => Answer | Promise<Answer>
): Host<R> {
  let queue: Promise<void> = Promise.resolve();

  const run = async (request: R) => {
    try {
      const { result, update, transfer } = await answer(request);
      const reply: { id: number; ok: true; result?: unknown; update?: unknown } = {
        id: request.id,
        ok: true,
      };
      if (result !== undefined) reply.result = result;
      if (update !== undefined) reply.update = update;
      port.postMessage(reply, transfer);
    } catch (err) {
      port.postMessage({ id: request.id, ok: false, error: serialize(err, request.op) });
    }
  };

  return {
    handle(request) {
      queue = queue.then(() => run(request));
      return queue;
    },
  };
}

/**
 * The fields that matter, so the other side can rebuild the error with its
 * code, status and op intact.
 */
function serialize(err: unknown, op: string): SerializedError {
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
