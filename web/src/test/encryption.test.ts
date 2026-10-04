// CLIENT.md §2: the browser's encryption path must reproduce the ecies.json golden vector byte for byte.
import { describe, expect, test } from 'bun:test'
import { decryptIntent, encryptIntent, validateEnclavePubKey } from '@tervane/core'
import { bytesToHex, hexToBytes, type Address } from 'viem'
import v from '../../../packages/core/test/vectors/ecies.json'

describe('web encryption path', () => {
  test('reproduces the ecies.json blob with the fixed ephemeral key and IV', () => {
    const pk = validateEnclavePubKey(hexToBytes(v.enclavePubKey as `0x${string}`))
    const blob = encryptIntent(pk, hexToBytes(v.payload as `0x${string}`), { chainId: BigInt(v.chainId), core: v.core as Address, sender: v.sender as Address },
      { ephSk: hexToBytes(v.ephSk as `0x${string}`), iv: hexToBytes(v.iv as `0x${string}`) })
    expect(bytesToHex(blob)).toBe(v.blob)
  })
  test('a blob bound to another sender does not decrypt', () => {
    const ctx = { chainId: BigInt(v.chainId), core: v.core as Address, sender: v.tampered.sender as Address }
    expect(decryptIntent(hexToBytes(v.enclaveSk as `0x${string}`), hexToBytes(v.blob as `0x${string}`), ctx)).toBeNull()
  })
})
