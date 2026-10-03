// EIP-712 account-view auth (SERVER.md §5). The signature proves control of `account`; issuedAt bounds replay.
import { addr, type Address, type Hex } from '@tervane/core'
import { verifyTypedData } from 'viem'
import { z } from 'zod'
import { HttpError } from './errors'

export const VIEW_TYPES = { ViewAccount: [{ name: 'account', type: 'address' }, { name: 'issuedAt', type: 'uint64' }] } as const
export const MAX_AGE_SECS = 300n

const body = z.object({
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  issuedAt: z.union([z.string().regex(/^[0-9]+$/), z.number().int().nonnegative()]),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
})

export function viewDomain(chainId: number, core: Address) {
  return { name: 'Tervane', version: '1', chainId, verifyingContract: core } as const
}

export async function authenticate(raw: unknown, chainId: number, core: Address, nowSecs: bigint): Promise<Address> {
  const p = body.safeParse(raw)
  if (!p.success) throw new HttpError(400, 'E_BAD_REQUEST', 'expected { account, issuedAt, signature }')
  const issuedAt = BigInt(p.data.issuedAt)
  const skew = issuedAt > nowSecs ? issuedAt - nowSecs : nowSecs - issuedAt
  if (skew > MAX_AGE_SECS) throw new HttpError(401, 'E_AUTH_EXPIRED', 'issuedAt outside ±300 s')
  const account = addr(p.data.account)
  let ok = false
  try {
    ok = await verifyTypedData({
      address: account, domain: viewDomain(chainId, core), types: VIEW_TYPES, primaryType: 'ViewAccount',
      message: { account, issuedAt }, signature: p.data.signature as Hex,
    })
  } catch { ok = false }
  if (!ok) throw new HttpError(401, 'E_AUTH_SIGNATURE', 'signature does not match account')
  return account
}
