// Test harness: plays the chain inbox (accumulator, cursor, stateRoot) and the server (state + blobs).
import { bytesToHex, concat, hexToBytes, keccak256, toHex } from 'viem'
import {
  ACTION_LEND, KIND_DEPOSIT, KIND_INTENT, KIND_WITHDRAW, PAYLOAD_LEN, PAYLOAD_VERSION, ZERO32, accStep, addr,
  buildAad, encodePayload, encryptIntent, enclavePublicKey, genesisState, makeDecryptor, merkleRoot, msgHash, runEpoch,
  type Address, type Decryptor, type EpochOutput, type Hex, type InboxMessage, type IntentPayload, type LedgerState,
} from '../src'

export const CHAIN_ID = 10143n
export const CORE = addr('0x00000000000000000000000000000000000c0e00')
export const TREASURY = addr('0x0000000000000000000000000000000000007e45')

export const A = (n: number): Address => addr(`0x${n.toString(16).padStart(40, '0')}`)

/** Deterministic test-only enclave key (not a secret; never used outside tests/vectors). */
export const TEST_ENCLAVE_SK = hexToBytes(keccak256(toHex('tervane/test/enclave-sk')))

export interface Cipher {
  encrypt(payload: Uint8Array, sender: Address): Uint8Array
  decrypt: Decryptor
}

/** Real ECIES (§6). */
export function eciesCipher(sk = TEST_ENCLAVE_SK): Cipher {
  const pk = enclavePublicKey(sk)
  return {
    encrypt: (payload, sender) => encryptIntent(pk, payload, { chainId: CHAIN_ID, core: CORE, sender }),
    decrypt: makeDecryptor(sk, CHAIN_ID, CORE),
  }
}

/**
 * Fast test-only cipher with the same blob shape and sender binding: payload in clear plus a
 * 16-byte keccak tag over (aad ‖ payload). Lets property tests run 10k+ epochs; never shipped.
 */
export function fakeCipher(): Cipher {
  const tag = (payload: Uint8Array, sender: Address) =>
    hexToBytes(keccak256(concat([bytesToHex(buildAad({ chainId: CHAIN_ID, core: CORE, sender })), bytesToHex(payload)]))).subarray(0, 16)
  return {
    encrypt(payload, sender) {
      const blob = new Uint8Array(350)
      blob[0] = 1
      blob.set(payload, 46)
      blob.set(tag(payload, sender), 46 + PAYLOAD_LEN)
      return blob
    },
    decrypt(blob, sender) {
      if (blob.length !== 350 || blob[0] !== 1) return null
      const payload = blob.slice(46, 46 + PAYLOAD_LEN)
      const t = tag(payload, sender)
      for (let i = 0; i < 16; i++) if (blob[46 + PAYLOAD_LEN + i] !== t[i]) return null
      return payload
    },
  }
}

export function payload(p: Partial<IntentPayload> & { action: number; nonce: bigint }): IntentPayload {
  return {
    version: PAYLOAD_VERSION, tenorId: 0, rateBps: 0, refId: 0n, expiresAtEpoch: 0n, amount: 0n, collateral: 0n, ...p,
  }
}

export interface SettleOpts {
  price: bigint
  asOf: bigint
  priceRoundId?: bigint
  grace?: bigint
  demoMode?: boolean
  /** Shuffle Map insertion order of the state handed to runEpoch (I8). */
  shuffle?: (n: number) => number
}

export class Harness {
  readonly messages: InboxMessage[] = [] // full onchain inbox, index i at position i-1
  readonly accs: Hex[] = [ZERO32]
  state: LedgerState = genesisState()
  stateRoot: Hex
  cursor = 0n
  readonly outputs: EpochOutput[] = []

  constructor(readonly cipher: Cipher = fakeCipher()) {
    this.stateRoot = merkleRoot(this.state)
  }

  private push(m: Omit<InboxMessage, 'index'>): bigint {
    const index = BigInt(this.messages.length + 1)
    const msg = { ...m, index }
    this.messages.push(msg)
    this.accs.push(accStep(this.accs[this.accs.length - 1]!, msgHash(msg)))
    return index
  }

  deposit(sender: Address, asset: number, amount: bigint) {
    return this.push({ kind: KIND_DEPOSIT, sender, asset, amount, blobHash: ZERO32, blob: '0x' })
  }

  withdraw(sender: Address, asset: number, amount: bigint) {
    return this.push({ kind: KIND_WITHDRAW, sender, asset, amount, blobHash: ZERO32, blob: '0x' })
  }

  intent(sender: Address, p: IntentPayload, encryptAs: Address = sender) {
    return this.rawIntent(sender, this.cipher.encrypt(hexToBytes(encodePayload(p)), encryptAs))
  }

  rawIntent(sender: Address, blobBytes: Uint8Array) {
    const blob = bytesToHex(blobBytes)
    return this.push({ kind: KIND_INTENT, sender, asset: 0, amount: 0n, blobHash: keccak256(blob), blob })
  }

  blobsForOpenOrders(s: LedgerState): Map<bigint, Hex> {
    const m = new Map<bigint, Hex>()
    for (const id of s.orders.keys()) m.set(id, this.messages[Number(id) - 1]!.blob)
    return m
  }

  /** Runs one epoch over everything pending (up to 200 messages) and commits it like the chain would. */
  settle(o: SettleOpts): EpochOutput {
    const to = BigInt(Math.min(this.messages.length, Number(this.cursor) + 200))
    const prev = o.shuffle ? shuffleState(this.state, o.shuffle) : this.state
    const out = runEpoch({
      prev,
      onchain: { stateRoot: this.stateRoot, cursor: this.cursor, accCursor: this.accs[Number(this.cursor)]!, accTo: this.accs[Number(to)]! },
      inboxTo: to,
      messages: this.messages.slice(Number(this.cursor), Number(to)),
      openOrderBlobs: this.blobsForOpenOrders(this.state),
      decrypt: this.cipher.decrypt,
      price: o.price,
      priceRoundId: o.priceRoundId ?? 1n,
      asOf: o.asOf,
      params: { grace: o.grace ?? 60n },
      treasury: TREASURY,
      demoMode: o.demoMode ?? true,
    })
    this.state = out.state
    this.stateRoot = out.report.newRoot
    this.cursor = out.report.inboxTo
    this.outputs.push(out)
    return out
  }
}

/** Rebuilds the state's Maps with entries inserted in a permuted order. */
export function shuffleState(s: LedgerState, rnd: (n: number) => number): LedgerState {
  const perm = <T>(xs: T[]) => {
    const a = [...xs]
    for (let i = a.length - 1; i > 0; i--) {
      const j = rnd(i + 1)
      ;[a[i], a[j]] = [a[j]!, a[i]!]
    }
    return a
  }
  return {
    meta: { ...s.meta },
    accounts: new Map(perm([...s.accounts])),
    orders: new Map(perm([...s.orders])),
    loans: new Map(perm([...s.loans])),
  }
}

export const lend = (nonce: bigint, tenorId: number, rateBps: number, amount: bigint, expiresAtEpoch = 0n) =>
  payload({ action: ACTION_LEND, nonce, tenorId, rateBps, amount, expiresAtEpoch })
