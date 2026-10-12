/**
 * Shared assertion helpers for the integration suite.
 *
 * Denials surface in two shapes depending on the layer that blocks them:
 * - missing GRANT / policy WITH CHECK violation / RPC guard → error present
 * - RLS USING filtering on select/update/delete → success with zero rows
 * Both must be treated as denial; tests assert the shape explicitly so a
 * policy that silently starts allowing rows fails loudly.
 */

type PostgrestLike = { data: unknown; error: { message: string } | null };

/** Select-style call must not yield any rows (error or empty set). */
export function expectNoRows(result: PostgrestLike, context: string): void {
  if (result.error !== null) return; // grant/policy error — denied
  const data = result.data;
  if (data === null || (Array.isArray(data) && data.length === 0)) return;
  throw new Error(`${context}: expected no rows, got ${JSON.stringify(data).slice(0, 200)}`);
}

/** Select-style call must yield at least one row with no error. */
export function expectRows(result: PostgrestLike, context: string): void {
  if (result.error !== null) {
    throw new Error(`${context}: unexpected error ${result.error.message}`);
  }
  if (!Array.isArray(result.data) || result.data.length === 0) {
    throw new Error(`${context}: expected rows, got none`);
  }
}

/** RPC/insert-style call must fail with the given code in the message. */
export function expectErrorWithCode(result: PostgrestLike, code: string, context: string): void {
  if (result.error === null) {
    throw new Error(`${context}: expected error containing "${code}", call succeeded`);
  }
  if (!result.error.message.includes(code)) {
    throw new Error(`${context}: expected error containing "${code}", got "${result.error.message}"`);
  }
}

/** RPC/insert-style call must fail (any error). */
export function expectError(result: PostgrestLike, context: string): void {
  if (result.error === null) {
    throw new Error(`${context}: expected an error, call succeeded`);
  }
}

/** RPC/insert-style call must succeed. */
export function expectOk(result: PostgrestLike, context: string): void {
  if (result.error !== null) {
    throw new Error(`${context}: unexpected error ${result.error.message}`);
  }
}
