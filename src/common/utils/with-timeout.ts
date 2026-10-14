/**
 * Races `promise` against a timer. The timer is always cleared and the
 * original promise gets a no-op catch, so whichever side loses never becomes
 * an unhandled rejection. The underlying operation is NOT cancelled.
 */
export async function withTimeout<T>(
  promise: PromiseLike<T> | T,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const operation = Promise.resolve(promise);
  operation.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
