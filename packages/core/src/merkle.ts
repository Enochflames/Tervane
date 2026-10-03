// Merkle commitment over the ledger. PROTOCOL-SPEC §7.2–§7.3.
// Sorted leaves, commutative keccak pairs, odd node carried up unchanged. Proofs verify with OZ v5 MerkleProof.

import { concat, keccak256 } from 'viem'
import { accountInner, leafFromInner, loanInner, metaInner, orderInner } from './abi'
import type { Account, Hex, LedgerState, Loan, Meta, Order } from './types'

export const metaLeaf = (m: Meta): Hex => leafFromInner(metaInner(m))
export const accountLeaf = (a: Account): Hex => leafFromInner(accountInner(a))
export const orderLeaf = (o: Order): Hex => leafFromInner(orderInner(o))
export const loanLeaf = (l: Loan): Hex => leafFromInner(loanInner(l))

export function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]))
}

export function stateLeaves(s: LedgerState): Hex[] {
  const leaves: Hex[] = [metaLeaf(s.meta)]
  for (const a of s.accounts.values()) leaves.push(accountLeaf(a))
  for (const o of s.orders.values()) leaves.push(orderLeaf(o))
  for (const l of s.loans.values()) leaves.push(loanLeaf(l))
  return leaves
}

function sortLeaves(leaves: readonly Hex[]): Hex[] {
  return leaves.map((l) => l.toLowerCase() as Hex).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0))
}

/** All levels bottom-up; level 0 is the sorted leaves. */
export function buildLevels(leaves: readonly Hex[]): Hex[][] {
  if (leaves.length === 0) throw new RangeError('empty tree')
  const levels: Hex[][] = [sortLeaves(leaves)]
  while (levels[levels.length - 1]!.length > 1) {
    const cur = levels[levels.length - 1]!
    const next: Hex[] = []
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? hashPair(cur[i]!, cur[i + 1]!) : cur[i]!)
    levels.push(next)
  }
  return levels
}

export function rootOf(leaves: readonly Hex[]): Hex {
  const levels = buildLevels(leaves)
  return levels[levels.length - 1]![0]!
}

export function merkleRoot(s: LedgerState): Hex {
  return rootOf(stateLeaves(s))
}

/** Sibling list bottom-up, skipping levels where the node was carried. */
export function proofFromLevels(levels: readonly Hex[][], leaf: Hex): Hex[] {
  let i = levels[0]!.indexOf(leaf.toLowerCase() as Hex)
  if (i < 0) throw new RangeError('leaf not in tree')
  const proof: Hex[] = []
  for (let d = 0; d < levels.length - 1; d++) {
    const sib = i ^ 1
    if (sib < levels[d]!.length) proof.push(levels[d]![sib]!)
    i >>= 1
  }
  return proof
}

export function getProof(leaves: readonly Hex[], leaf: Hex): Hex[] {
  return proofFromLevels(buildLevels(leaves), leaf)
}

export function verifyProof(proof: readonly Hex[], root: Hex, leaf: Hex): boolean {
  let h = leaf
  for (const s of proof) h = hashPair(h, s)
  return BigInt(h) === BigInt(root)
}
