// Leak audit (CRE-WORKFLOW §8.4, DEMO-SCRIPT §3). Looks for every bid used in the demo run in:
//   - captured simulator output (-v --engine-logs) and the server log   (scripts/demo/.out/*.log)
//   - the server's SQLite DB (all columns; ciphertext blobs excluded)
//   - calldata and event logs of every transaction recorded for the run
// in decimal, percent, hex and uint32 big-endian. The clearing rate is public by design (Cleared event,
// clears table, loan.rateBps) and is reported but not failed. Also asserts no secret value appears in
// any captured output (counts only, never values). Exit code 1 on any leak.
import { Database } from 'bun:sqlite'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { coreAbi, type Hex } from '@tervane/core'
import { toEventSelector, getAbiItem } from 'viem'
import { pub } from './lib/chain'
import { CLEARING_RATE, OUT, RATES, loadState, table } from './demo/lib'

const state = await loadState()
const forbidden = [...new Set(Object.values(RATES))].filter((r) => r !== CLEARING_RATE)
const all = [...forbidden, CLEARING_RATE]
const hex32 = (r: number) => r.toString(16).padStart(8, '0')
const patterns = (r: number) => [
  { fmt: 'decimal', re: new RegExp(`(?<![0-9A-Za-z.])${r}(?![0-9A-Za-z])`, 'g') },
  { fmt: 'percent', re: new RegExp(`(?<![0-9.])${Math.floor(r / 100)}\\.${String(r % 100).padStart(2, '0')}(?![0-9])`, 'g') },
  { fmt: 'hex', re: new RegExp(`(?<![0-9a-fA-Fx])0x0*${r.toString(16)}(?![0-9a-fA-F])`, 'gi') },
  { fmt: 'uint32-be', re: new RegExp(hex32(r), 'gi') },
]
type Hits = Record<number, Record<string, number>>
const hits: Hits = Object.fromEntries(all.map((r) => [r, { logs: 0, db: 0, calldata: 0, events: 0 }]))
const where: string[] = []

// ── 1. captured logs ─────────────────────────────────────────
const logFiles = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith('.log')) : []
let secretHits = 0
const secrets = ['CRE_ETH_PRIVATE_KEY', 'TERVANE_ENCLAVE_SK', 'TERVANE_SERVER_API_KEY']
  .map((k) => (process.env[k] ?? '').replace(/^0x/, '')).filter((v) => v.length >= 32)
for (const f of logFiles) {
  const text = await Bun.file(join(OUT, f)).text()
  for (const s of secrets) if (text.toLowerCase().includes(s.toLowerCase())) secretHits++
  for (const r of all) for (const p of patterns(r)) {
    const n = text.match(p.re)?.length ?? 0
    if (n) { hits[r]!.logs! += n; if (r !== CLEARING_RATE) where.push(`${f}: ${p.fmt} ${r} ×${n}`) }
  }
}

// ── 2. database ─────────────────────────────────────────────
const dbPath = state.serverDb
let dbRows = 0
if (dbPath && existsSync(dbPath)) {
  const db = new Database(dbPath, { readonly: true })
  for (const t of ['inbox', 'states', 'epochs', 'clears', 'cursor']) {
    for (const row of db.query(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]) {
      dbRows++
      for (const [col, v] of Object.entries(row)) {
        if (v instanceof Uint8Array) continue // ciphertext
        const values: string[] = []
        if (col === 'snapshot') JSON.parse(String(v), (_k, x) => { if (typeof x !== 'object') values.push(String(x)); return x })
        else values.push(String(v))
        for (const s of secrets) if (values.some((x) => x.toLowerCase().includes(s.toLowerCase()))) secretHits++
        for (const r of all) {
          const n = values.filter((x) => x === String(r) || x.toLowerCase() === `0x${r.toString(16)}`).length
          if (n) { hits[r]!.db! += n; if (r !== CLEARING_RATE) where.push(`db ${t}.${col}: ${r} ×${n}`) }
        }
      }
    }
  }
  db.close()
}

// ── 3. calldata + events of every tx in the run ─────────────
const clearedTopic = toEventSelector(getAbiItem({ abi: coreAbi, name: 'Cleared' }) as never)
const words = (data: string) => {
  const h = data.replace(/^0x/, '')
  const body = h.length % 64 === 8 ? h.slice(8) : h // drop a 4-byte selector
  return Array.from({ length: Math.floor(body.length / 64) }, (_, i) => BigInt(`0x${body.slice(i * 64, i * 64 + 64)}`))
}
const txs = Object.entries(state.txs) as [string, Hex][]
for (const [label, hash] of txs) {
  const [tx, rc] = await Promise.all([pub.getTransaction({ hash }), pub.getTransactionReceipt({ hash })])
  const isCiphertext = /Lend|Borrow|Repay|garbage/i.test(label) // submitIntent: payload is AES-GCM ciphertext
  for (const r of all) {
    let n = words(tx.input).filter((w) => w === BigInt(r)).length
    if (!isCiphertext) n += (tx.input.toLowerCase().match(new RegExp(hex32(r), 'g'))?.length ?? 0)
    if (n) { hits[r]!.calldata! += n; if (r !== CLEARING_RATE) where.push(`calldata ${label}: ${r} ×${n}`) }
    for (const l of rc.logs) {
      const isCleared = l.topics[0] === clearedTopic
      const m = [...l.topics.slice(1).map((t) => BigInt(t!)), ...words(l.data)].filter((w) => w === BigInt(r)).length
      if (m) { hits[r]!.events! += m; if (r !== CLEARING_RATE || !isCleared) where.push(`event ${label} ${isCleared ? 'Cleared' : l.topics[0]?.slice(0, 10)}: ${r} ×${m}`) }
    }
  }
}

// ── report ──────────────────────────────────────────────────
console.log(`\nleak audit: ${logFiles.length} log files, ${dbRows} DB rows, ${txs.length} transactions`)
table(all.map((r) => ({ rate: `${r} bps`, role: r === CLEARING_RATE ? 'clearing rate (public)' : 'bid (must not leak)', ...hits[r] })))
const leaks = forbidden.reduce((s, r) => s + Object.values(hits[r]!).reduce((a, b) => a + b, 0), 0)
const clearingOutsideAllowed = where.filter((w) => w.includes(` ${CLEARING_RATE} `) && !w.includes('Cleared')).length
for (const w of where) console.log(`  hit: ${w}`)
console.log(`secret values found in captured output/DB: ${secretHits}`)
console.log(leaks === 0 && secretHits === 0 ? 'CLEAN: no bid outside client storage, no secret in any output' : 'LEAK FOUND')
void clearingOutsideAllowed
process.exit(leaks === 0 && secretHits === 0 ? 0 : 1)
