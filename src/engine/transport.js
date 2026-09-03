// The one bounded-wait fetch every adapter sends its request through.
//
// This is what makes the 120-second timeout and the no-automatic-retry rule
// identical across the three adapters without each of them reimplementing an
// AbortController and a race against a timer. It knows nothing about any
// provider's protocol: it returns a raw outcome, and each adapter maps that
// outcome to its own error kinds and reads its own answer shape.

// Two minutes. A whole page summarized in one non-streaming request is a slow
// request by nature, and a limit short enough to cut a working run would turn
// a succeeding summary into an error the reader cannot act on.
export const REQUEST_TIMEOUT_MS = 120000;

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// One request, under one bounded wait covering the whole of it including
// reading the body. A failed run is never retried automatically: an ordinary
// page sends this once, a staged long-page run sends it once per chunk and
// integrate step, and none of those staged sends is a retry — every one is a
// processing step of the one run, spent on the one provider it started with.
//
// Resolves to one of:
//   { timedOut: true }
//   { timedOut: false, unreachable: true }
//   { timedOut: false, unreachable: false, ok, status, data }
export async function sendRequest(
  request,
  { fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  const send = fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  let timer;

  const operation = (async () => {
    try {
      const response = await send(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });

      const data = await readJson(response);
      if (controller.signal.aborted) return { timedOut: true };
      return {
        timedOut: false,
        unreachable: false,
        ok: response.ok,
        status: response.status,
        data,
      };
    } catch {
      if (controller.signal.aborted) return { timedOut: true };
      return { timedOut: false, unreachable: true };
    }
  })();
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
