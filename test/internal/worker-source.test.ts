import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  WASM_WORKER_SOURCE,
  defaultWorkerUrl,
  resolveWorkerUrl,
} from "../../src/internal/wasm/worker-source";
import { watToWasm } from "../helpers/wat";

/*
 * Copied from react-use-wasm test/worker-protocol.test.ts.
 * Keep in sync until extracted to a shared core.
 *
 * Node has no Worker in this environment, so instead of a real worker these
 * tests run WASM_WORKER_SOURCE as an ES module against a fake `self`. That
 * exercises the actual message protocol, which is the part most likely to
 * break.
 *
 * What this cannot cover: the Blob-URL module worker and structured-cloning
 * a WebAssembly.Module across the thread boundary. Those need a browser, so
 * they belong in e2e/.
 */

type Message = Record<string, any>;

interface FakeWorker {
  send(msg: Message): Promise<void>;
  messages: Message[];
  last(): Message;
}

let dir: string;
let counter = 0;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "use-wasm-state-"));
});

afterAll(async () => {
  delete (globalThis as any).self;
  await rm(dir, { recursive: true, force: true });
});

async function startWorker(): Promise<FakeWorker> {
  const messages: Message[] = [];
  const fakeSelf = {
    onmessage: null as null | ((e: { data: Message }) => unknown),
    postMessage: (msg: Message) => void messages.push(msg),
  };
  // The worker source assigns self.onmessage at module scope, so `self` has
  // to exist before it evaluates.
  (globalThis as any).self = fakeSelf;

  const file = join(dir, `worker-${counter++}.mjs`);
  await writeFile(file, WASM_WORKER_SOURCE, "utf8");
  await import(/* @vite-ignore */ pathToFileURL(file).href);

  if (!fakeSelf.onmessage) throw new Error("worker never installed an onmessage handler");

  return {
    messages,
    // The handler is async; awaiting it means the reply has been posted.
    send: async (msg) => void (await fakeSelf.onmessage!({ data: msg })),
    last: () => messages[messages.length - 1]!,
  };
}

async function compile(fixture: string): Promise<WebAssembly.Module> {
  return WebAssembly.compile(await watToWasm(fixture));
}

/** An import object delivered the way the client delivers one: a module URL. */
function importsDataUrl(body: string): string {
  return `data:text/javascript,${encodeURIComponent(body)}`;
}

describe("WASM_WORKER_SOURCE protocol", () => {
  it("replies ready after init", async () => {
    const w = await startWorker();
    await w.send({ type: "init", module: await compile("math") });

    expect(w.messages).toEqual([{ type: "ready" }]);
  });

  it("runs _initialize exactly once before reporting ready", async () => {
    const w = await startWorker();
    await w.send({ type: "init", module: await compile("reactor") });
    expect(w.last()).toEqual({ type: "ready" });

    await w.send({ type: "call", id: 1, name: "initCount", args: [] });
    expect(w.last()).toEqual({ type: "result", id: 1, result: 1 });
  });

  it("returns call results keyed by id", async () => {
    const w = await startWorker();
    await w.send({ type: "init", module: await compile("math") });

    await w.send({ type: "call", id: 7, name: "add", args: [2, 3] });
    expect(w.last()).toEqual({ type: "result", id: 7, result: 5 });

    await w.send({ type: "call", id: 8, name: "fib", args: [12] });
    expect(w.last()).toEqual({ type: "result", id: 8, result: 144 });
  });

  it("loads imports from a module URL (default export object)", async () => {
    const w = await startWorker();
    await w.send({
      type: "init",
      module: await compile("imports"),
      importsUrl: importsDataUrl(
        "globalThis.__log1 = [];\nexport default { env: { log: (x) => globalThis.__log1.push(x) } };"
      ),
    });
    expect(w.last()).toEqual({ type: "ready" });

    await w.send({ type: "call", id: 1, name: "logSum", args: [40, 2] });
    expect(w.last()).toEqual({ type: "result", id: 1, result: 42 });
    expect((globalThis as any).__log1).toEqual([42]);
  });

  it("accepts an async function as the imports default export", async () => {
    const w = await startWorker();
    await w.send({
      type: "init",
      module: await compile("imports"),
      importsUrl: importsDataUrl(
        "globalThis.__log2 = [];\nexport default async () => ({ env: { log: (x) => globalThis.__log2.push(x) } });"
      ),
    });
    expect(w.last()).toEqual({ type: "ready" });

    await w.send({ type: "call", id: 1, name: "logSum", args: [1, 2] });
    expect(w.last()).toEqual({ type: "result", id: 1, result: 3 });
    expect((globalThis as any).__log2).toEqual([3]);
  });

  it("accepts a named `imports` export as a fallback", async () => {
    const w = await startWorker();
    await w.send({
      type: "init",
      module: await compile("imports"),
      importsUrl: importsDataUrl("export const imports = { env: { log: () => {} } };"),
    });
    expect(w.last()).toEqual({ type: "ready" });
  });

  it("reports init-error when a required import is missing", async () => {
    const w = await startWorker();
    await w.send({ type: "init", module: await compile("imports") });

    expect(w.last().type).toBe("init-error");
    expect(w.last().error.message).toMatch(/env|log|import/i);
  });

  it("reports init-error when the imports module fails to load", async () => {
    const w = await startWorker();
    await w.send({
      type: "init",
      module: await compile("imports"),
      importsUrl: importsDataUrl("throw new Error('imports blew up');"),
    });

    expect(w.last().type).toBe("init-error");
    expect(w.last().error.message).toContain("imports blew up");
  });

  it("serialises a trap as an error reply", async () => {
    const w = await startWorker();
    await w.send({ type: "init", module: await compile("math") });

    await w.send({ type: "call", id: 3, name: "boom", args: [] });

    const reply = w.last();
    expect(reply.type).toBe("error");
    expect(reply.id).toBe(3);
    expect(reply.error.name).toBe("RuntimeError");
    expect(reply.error.message).toMatch(/unreachable/);
    expect(typeof reply.error.stack).toBe("string");
  });

  it("rejects non-function exports", async () => {
    const w = await startWorker();
    await w.send({ type: "init", module: await compile("math") });

    await w.send({ type: "call", id: 4, name: "memory", args: [] });

    expect(w.last().type).toBe("error");
    expect(w.last().error.message).toBe('export "memory" is not a function');
  });

  it("rejects unknown export names", async () => {
    const w = await startWorker();
    await w.send({ type: "init", module: await compile("math") });

    await w.send({ type: "call", id: 5, name: "nope", args: [] });

    expect(w.last().type).toBe("error");
    expect(w.last().error.message).toBe('export "nope" is not a function');
  });

  it("rejects a call made before init", async () => {
    const w = await startWorker();

    await w.send({ type: "call", id: 6, name: "add", args: [1, 2] });

    expect(w.last()).toMatchObject({
      type: "error",
      id: 6,
      error: { message: 'export "add" is not a function' },
    });
  });

  it("ignores messages it does not understand", async () => {
    const w = await startWorker();
    await w.send({ type: "init", module: await compile("math") });
    const before = w.messages.length;

    await w.send({ type: "something-else" });

    expect(w.messages.length).toBe(before);
  });
});

/*
 * The blob-URL half. New here rather than copied: in react-use-wasm it is
 * private to the hook, so only the Playwright suite ever reached it.
 */
describe("worker url", () => {
  // @vitest-environment-note: URL.createObjectURL and Blob both exist in
  // Node 22, so the blob path is reachable without a DOM.
  it("creates the blob URL once and reuses it", () => {
    expect(defaultWorkerUrl()).toBe(defaultWorkerUrl());
  });

  it("prefers a caller-supplied workerUrl, for CSPs that block blob:", () => {
    expect(resolveWorkerUrl("/my-worker.js")).toBe("/my-worker.js");
    expect(resolveWorkerUrl()).toBe(defaultWorkerUrl());
  });
});
