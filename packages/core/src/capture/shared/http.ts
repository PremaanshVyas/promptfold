/**
 * Shared HTTP contract for all capture adapters.
 *
 * Lives in `shared/` so every adapter imports it from one place and NO adapter
 * imports another. `fetch` is injected (FetchLike) so adapters are unit-testable
 * without a browser.
 */

export type FetchLike = (
  input: string,
  init?: {
    credentials?: "include" | "omit" | "same-origin";
    headers?: Record<string, string>;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export class CaptureError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CaptureError";
  }
}
