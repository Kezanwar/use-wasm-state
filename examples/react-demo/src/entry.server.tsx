import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";

/**
 * Pre-rendering, at build time. Every route renders to static HTML here,
 * and none of it may run the engine: wasm, workers and the live benchmark
 * belong in effects, on the client. So while a page renders, the globals
 * engine code would reach for throw, and a page that touched one fails
 * the build rather than shipping.
 */
const CLIENT_ONLY = ["WebAssembly", "Worker", "fetch"] as const;

async function withoutEngine<T>(render: () => Promise<T>): Promise<T> {
  const saved = CLIENT_ONLY.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  for (const name of CLIENT_ONLY) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error(`pre-rendering touched ${name}; engine code must run only on the client`);
      },
    });
  }
  try {
    return await render();
  } finally {
    CLIENT_ONLY.forEach((name, i) => {
      const descriptor = saved[i];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    });
  }
}

export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext
) {
  // Rendered to the end before anything is sent: the router streams its
  // state into the page behind Suspense, so a page cut off early never
  // hydrates.
  const html = await withoutEngine(async () => {
    const stream = await renderToReadableStream(
      <ServerRouter context={context} url={request.url} />
    );
    await stream.allReady;
    return new Response(stream).text();
  });
  headers.set("Content-Type", "text/html");
  return new Response(html, { status, headers });
}
