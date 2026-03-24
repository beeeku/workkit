import { TimeoutError } from "@workkit/errors";

export async function executeWithTimeout<T>(
  handler: () => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw signal.reason ?? new Error("Aborted");
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(new TimeoutError(`Tool execution exceeded ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
      }
    };

    signal.addEventListener("abort", onAbort, { once: true });

    handler().then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      },
    );
  });
}
