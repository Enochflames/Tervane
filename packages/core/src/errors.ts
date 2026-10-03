// Stable error codes (CLAUDE.md §5). Epoch-fatal codes abort settlement; intent-level codes
// only mark one intent as consumed-and-ignored and are counted in stats.

export type FatalCode =
  | 'E_ROOT_MISMATCH'
  | 'E_INBOX_MISMATCH'
  | 'E_BLOB_MISMATCH'
  | 'E_PRICE'
  | 'E_INVARIANT'
  | 'E_DECODE'

export type IntentCode =
  | 'E_DECRYPT'
  | 'E_BAD_ACTION'
  | 'E_NONCE'
  | 'E_TENOR'
  | 'E_RATE'
  | 'E_AMOUNT'
  | 'E_BALANCE'
  | 'E_CAP'
  | 'E_RATIO'
  | 'E_EXPIRED'
  | 'E_NOT_FOUND'
  | 'E_NOT_OWNER'

/** `detail` must never contain a rate, amount from a decrypted payload, or any secret. */
export class TervaneError extends Error {
  constructor(readonly code: FatalCode, readonly detail = '') {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'TervaneError'
  }
}
