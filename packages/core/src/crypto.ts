// ECIES over secp256k1 + HKDF-SHA256 + AES-256-GCM. PROTOCOL-SPEC §6.
// QuickJS-safe (verified in spike S2): noble v2 only, no Buffer, no WebCrypto in the decrypt path.

import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { encodeAbiParameters, hexToBytes, keccak256, toBytes } from 'viem'
import { BLOB_LEN, PAYLOAD_LEN } from './params'
import type { Address, Hex } from './types'

const BLOB_VERSION = 0x01
const INFO = new TextEncoder().encode('tervane/ecies/v1')
const AAD_DOMAIN = keccak256(toBytes('TERVANE_INTENT_V1'))

export interface AadContext { chainId: bigint; core: Address; sender: Address }

/** §6.3 */
export function buildAad(ctx: AadContext): Uint8Array {
  return hexToBytes(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }],
    [AAD_DOMAIN, ctx.chainId, ctx.core, ctx.sender],
  ))
}

/** HKDF over the shared x-coordinate, salted with the ephemeral public key (§6.2). */
export function deriveKey(sharedCompressed: Uint8Array, ephPk: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedCompressed.subarray(1, 33), ephPk, INFO, 32)
}

/** CLIENT.md §2.1: 33 bytes, 0x02/0x03 prefix, and a valid secp256k1 point. Throws otherwise. */
export function validateEnclavePubKey(pk: Uint8Array): Uint8Array {
  if (pk.length !== 33 || (pk[0] !== 0x02 && pk[0] !== 0x03)) throw new Error('enclave key must be a 33-byte compressed point')
  secp256k1.Point.fromBytes(pk) // throws if not on the curve
  return pk
}

export function enclavePublicKey(enclaveSk: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(enclaveSk, true)
}

export interface EncryptOptions {
  /** Fixed ephemeral key and IV for golden vectors only. Production callers omit both. */
  ephSk?: Uint8Array
  iv?: Uint8Array
}

/** Client side (§6.2). Returns the 350-byte blob. */
export function encryptIntent(enclavePk: Uint8Array, payload: Uint8Array, ctx: AadContext, opts: EncryptOptions = {}): Uint8Array {
  if (payload.length !== PAYLOAD_LEN) throw new RangeError('payload must be 288 bytes')
  const ephSk = opts.ephSk ?? secp256k1.utils.randomSecretKey()
  const iv = opts.iv ?? randomBytes(12)
  const ephPk = secp256k1.getPublicKey(ephSk, true)
  const key = deriveKey(secp256k1.getSharedSecret(ephSk, enclavePk, true), ephPk)
  const ct = gcm(key, iv, buildAad(ctx)).encrypt(payload)
  const blob = new Uint8Array(BLOB_LEN)
  blob[0] = BLOB_VERSION
  blob.set(ephPk, 1)
  blob.set(iv, 34)
  blob.set(ct, 46)
  return blob
}

/** Enclave side (§6.4). Returns null on any failure; callers map that to E_DECRYPT. */
export function decryptIntent(enclaveSk: Uint8Array, blob: Uint8Array, ctx: AadContext): Uint8Array | null {
  if (blob.length !== BLOB_LEN || blob[0] !== BLOB_VERSION) return null
  try {
    const ephPk = blob.subarray(1, 34)
    const key = deriveKey(secp256k1.getSharedSecret(enclaveSk, ephPk, true), ephPk)
    const pt = gcm(key, blob.subarray(34, 46), buildAad(ctx)).decrypt(blob.subarray(46))
    return pt.length === PAYLOAD_LEN ? pt : null
  } catch {
    return null
  }
}

/** Decrypts one blob for a given inbox sender. Injected into runEpoch so the secret key never enters the transition. */
export type Decryptor = (blob: Uint8Array, sender: Address) => Uint8Array | null

export function makeDecryptor(enclaveSk: Uint8Array | Hex, chainId: bigint, core: Address): Decryptor {
  const sk = typeof enclaveSk === 'string' ? hexToBytes(enclaveSk) : enclaveSk
  return (blob, sender) => decryptIntent(sk, blob, { chainId, core, sender })
}
