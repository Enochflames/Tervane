// Demo plumbing (DEMO-SCRIPT §3): local test wallets, run state, captured output, server process, tables.
// wallets.json holds throwaway testnet keys generated on this machine; it is gitignored and never printed.
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Hex } from '@tervane/core'
import type { Account } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { SERVER, SERVER_PORT } from '../lib/api'
import { ROOT } from '../lib/chain'

export const DEMO = join(ROOT, 'scripts/demo')
export const OUT = join(DEMO, '.out')
mkdirSync(OUT, { recursive: true })

export const NAMES = ['ada', 'bola', 'chidi', 'dayo'] as const
export type Name = (typeof NAMES)[number]

/** Bid values used in the run. Client-side only: printed by the seed table, audited everywhere else. */
export const RATES = { ada: 413, bola: 527, chidi: 611, dayo: 552, adaBorrow: 593 } as const
export const CLEARING_RATE = 527

export async function wallets(): Promise<Record<Name, Account>> {
  const file = join(DEMO, 'wallets.json')
  if (!existsSync(file)) {
    const keys = Object.fromEntries(NAMES.map((n) => [n, generatePrivateKey()]))
    await Bun.write(file, JSON.stringify(keys, null, 2))
    await Bun.$`chmod 600 ${file}`
  }
  const keys = (await Bun.file(file).json()) as Record<Name, Hex>
  return Object.fromEntries(NAMES.map((n) => [n, privateKeyToAccount(keys[n])])) as Record<Name, Account>
}

// ── run state (.demo-state.json) ─────────────────────────────
export interface DemoState {
  core?: Hex
  txs: Record<string, Hex>
  serverDb?: string
  notes: Record<string, string>
}
const stateFile = join(DEMO, '.demo-state.json')
export async function loadState(): Promise<DemoState> {
  return existsSync(stateFile) ? Bun.file(stateFile).json() : { txs: {}, notes: {} }
}
export async function saveState(s: DemoState) {
  await Bun.write(stateFile, JSON.stringify(s, null, 2))
}

// ── server process ──────────────────────────────────────────
export class ServerProc {
  private p?: ReturnType<typeof Bun.spawn>
  constructor(readonly dbPath: string, readonly logFile = join(OUT, 'server.log')) {}

  async start() {
    const env: Record<string, string> = {
      PATH: `${join(homedir(), '.bun/bin')}:${process.env.PATH}`,
      MONAD_TESTNET_RPC: process.env.MONAD_TESTNET_RPC || 'https://testnet-rpc.monad.xyz',
      INTERNAL_API_KEY: process.env.TERVANE_SERVER_API_KEY ?? '', // the server never gets signing keys
      DB_PATH: this.dbPath,
      PORT: String(SERVER_PORT),
    }
    // Anything already answering here would be mistaken for our server (and the settler would call it too).
    const busy = await fetch(`${SERVER}/ping`).then(() => true, () => false)
    if (busy) throw new Error(`port ${SERVER_PORT} is already in use; set TERVANE_SERVER_PORT to a free port`)
    const log = Bun.file(this.logFile)
    const prev = existsSync(this.logFile) ? await log.text() : ''
    this.p = Bun.spawn(['bun', 'src/main.ts'], { cwd: join(ROOT, 'server'), env, stdout: 'pipe', stderr: 'pipe' })
    const sink = Bun.file(this.logFile).writer()
    sink.write(prev)
    for (const stream of [this.p.stdout, this.p.stderr] as ReadableStream<Uint8Array>[]) {
      ;(async () => { for await (const chunk of stream) { sink.write(chunk); sink.flush() } })()
    }
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${SERVER}/ping`)).ok) return } catch {}
      await Bun.sleep(500)
    }
    throw new Error('server did not start')
  }

  async stop() {
    if (!this.p) return
    this.p.kill()
    await this.p.exited
    this.p = undefined
    await Bun.sleep(300)
  }
}

// ── output ──────────────────────────────────────────────────
export function table(rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const cols = Object.keys(rows[0]!)
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)))
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(w[i]!)).join('  ')
  console.log(line(cols))
  console.log(line(w.map((n) => '─'.repeat(n))))
  for (const r of rows) console.log(line(cols.map((c) => String(r[c] ?? ''))))
}

export class Checks {
  results: { scenario: string; check: string; ok: boolean; detail: string }[] = []
  ok(scenario: string, check: string, cond: boolean, detail = '') {
    this.results.push({ scenario, check, ok: cond, detail })
    console.log(`  ${cond ? '✔' : '✘'} ${check}${detail ? `  (${detail})` : ''}`)
    return cond
  }
  get passed() { return this.results.every((r) => r.ok) }
}

export const fmt = (x: bigint, decimals: number) => {
  const neg = x < 0n, v = neg ? -x : x
  const s = v.toString().padStart(decimals + 1, '0')
  return `${neg ? '-' : ''}${s.slice(0, -decimals)}.${s.slice(-decimals)}`
}
