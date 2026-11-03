/**
 * The envelope every worker speaks, whatever pattern it hosts.
 *
 * One request, one reply, matched by id and answered in order. Everything
 * crossing has to be structured-cloneable, so the shapes are flat: an
 * error cannot be posted, and travels as the fields a caller switches on.
 *
 * Internal.
 */

/** A request. The pattern adds whatever its op needs. */
export interface Envelope {
  id: number;
  op: string;
}

/** What crosses back for a failure. Rebuilt as a WasmStateError on arrival. */
export interface SerializedError {
  code: string;
  status: number;
  op: string;
  message: string;
}

export type Reply<U = unknown> =
  | { id: number; ok: true; result?: unknown; update?: U }
  | { id: number; ok: false; error: SerializedError };

/** A successful reply. */
export type Ok<U = unknown> = Extract<Reply<U>, { ok: true }>;

/**
 * A request without its id, which is what a caller builds.
 *
 * Omit<R, "id"> over a union would collapse it to the keys every member
 * shares, so it distributes over the members instead.
 */
export type Body<R extends Envelope> = R extends Envelope ? Omit<R, "id"> : never;

/** The half of a MessagePort a host needs, so a test can supply its own. */
export interface HostPort {
  postMessage(message: Reply, transfer?: Transferable[]): void;
}
