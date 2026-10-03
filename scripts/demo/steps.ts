// Demo steps and Gate 5 scenarios (BUILD-PLAN Phase 5, DEMO-SCRIPT §2–§3). Used by scenarios.ts (one command)
// and by the individual 0x-*.ts scripts for the video. Every expected number comes from DEMO-SCRIPT §2 or core.
import { Database } from 'bun:sqlite'
import { copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACTION_BORROW, ACTION_LEND, ACTION_REPAY, PAYLOAD_VERSION, coreAbi, encodeReport, erc20Abi, owedFor,
  type Hex, type IntentPayload,
} from '@tervane/core'
import { bytesToHex, formatEther, parseEther, parseEventLogs, type Account } from 'viem'
import { accountView, health, proof, waitIndexed } from '../lib/api'
import { account, dep, deposit, faucet, pub, requestWithdraw, setPrice, settlement, submitIntent, walletFor } from '../lib/chain'
import { simulate, type SimResult } from '../lib/cre'
import { CLEARING_RATE, Checks, OUT, RATES, ServerProc, fmt, table, type DemoState, type Name } from './lib'

export interface Ctx { w: Record<Name, Account>; deployer: Account; state: DemoState; checks: Checks; server: ServerProc }

const USD = (n: number) => BigInt(Math.round(n * 1e6))
const DEMO_TENOR = 2
const intent = (p: Partial<IntentPayload> & { action: number; nonce: bigint }): IntentPayload =>
  ({ version: PAYLOAD_VERSION, tenorId: DEMO_TENOR, rateBps: 0, refId: 0n, expiresAtEpoch: 0n, amount: 0n, collateral: 0n, ...p })

// ── generic ─────────────────────────────────────────────────

/** Tops up demo wallets with gas (Monad charges the gas limit; viem reserves maxFee × limit). */
export async function fund(ctx: Ctx, min = parseEther('0.2'), topUp = parseEther('0.35')) {
  const rows = []
  for (const [n, a] of Object.entries(ctx.w)) {
    const bal = await pub.getBalance({ address: a.address })
    if (bal < min) {
      const hash = await walletFor(ctx.deployer).sendTransaction({ to: a.address, value: topUp - bal, gas: 21_000n } as never)
      await pub.waitForTransactionReceipt({ hash })
    }
    rows.push({ wallet: n, address: a.address, MON: formatEther(await pub.getBalance({ address: a.address })).slice(0, 6) })
  }
  table(rows)
}

/** Runs one broadcast simulate with full capture, then waits for the server root to match the chain root. */
export async function settle(ctx: Ctx, label: string, o: { trigger: 0 | 1; txHash?: Hex }): Promise<SimResult> {
  const r = await simulate({ ...o, broadcast: true, verbose: true })
  await Bun.write(join(OUT, `sim-${label}.log`), r.output)
  console.log(`  simulate ${label}: ${r.ok ? `tx ${r.result}` : 'FAILED'}`)
  for (const l of r.userLogs) console.log(`    ${l}`)
  if (r.ok && r.result.startsWith('0x')) {
    ctx.state.txs[`settle-${label}`] = r.result as Hex
    await syncedRoot()
  }
  return r
}

export async function syncedRoot(timeoutMs = 45_000) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const st = await settlement()
    const h = await health()
    if (h.root === st.stateRoot.toLowerCase()) return { chain: st, server: h }
    if (Date.now() > end) throw new Error(`server root ${h.root} != chain root ${st.stateRoot}`)
    await Bun.sleep(1000)
  }
}

const receipt = (hash: Hex) => pub.getTransactionReceipt({ hash })
const events = async (hash: Hex) => parseEventLogs({ abi: coreAbi, logs: (await receipt(hash)).logs })
const view = (a: Account) => accountView(a)
const big = (x: unknown) => BigInt(String(x ?? '0'))

// ── 01: seed the demo book ──────────────────────────────────

export async function seed(ctx: Ctx) {
  const { ada, bola, chidi, dayo } = ctx.w
  for (const a of [ada, bola, chidi]) await faucet(a, dep.usdToken)
  await faucet(dayo, dep.ethToken)
  // Inbox order matters (DEMO-SCRIPT §2): four deposits, then three lends, then the borrow.
  await deposit(ada, 0, USD(600)); await deposit(bola, 0, USD(600)); await deposit(chidi, 0, USD(1000)); await deposit(dayo, 1, parseEther('0.85'))
  ctx.state.txs.adaLend = await submitIntent(ada, intent({ action: ACTION_LEND, nonce: 1n, rateBps: RATES.ada, amount: USD(600) }))
  ctx.state.txs.bolaLend = await submitIntent(bola, intent({ action: ACTION_LEND, nonce: 1n, rateBps: RATES.bola, amount: USD(600) }))
  ctx.state.txs.chidiLend = await submitIntent(chidi, intent({ action: ACTION_LEND, nonce: 1n, rateBps: RATES.chidi, amount: USD(1000) }))
  ctx.state.txs.dayoBorrow = await submitIntent(dayo, intent({ action: ACTION_BORROW, nonce: 1n, rateBps: RATES.dayo, amount: USD(1000), collateral: parseEther('0.85') }))
  table([
    { wallet: 'Ada', action: 'deposit 600 tUSD → LEND 600', 'rate (client-side only)': `${RATES.ada} bps` },
    { wallet: 'Bola', action: 'deposit 600 tUSD → LEND 600', 'rate (client-side only)': `${RATES.bola} bps` },
    { wallet: 'Chidi', action: 'deposit 1,000 tUSD → LEND 1,000', 'rate (client-side only)': `${RATES.chidi} bps` },
    { wallet: 'Dayo', action: 'deposit 0.85 tETH → BORROW 1,000', 'rate (client-side only)': `max ${RATES.dayo} bps` },
  ])
  console.log(`  DAYO_TX = ${ctx.state.txs.dayoBorrow}  (every intent onchain is a 350-byte blob)`)
  await waitIndexed(8)
}

// ── Scenario 1: demo book clears at 527; 611 stays open ─────

export async function scenario1(ctx: Ctx) {
  console.log('\n[1] demo book clears at 527 bps')
  const r = await settle(ctx, 'E1-intents', { trigger: 0, txHash: ctx.state.txs.dayoBorrow })
  const c = ctx.checks
  if (!c.ok('1', 'H0 settle succeeded', r.ok)) return
  const cleared = (await events(r.result as Hex)).filter((e) => e.eventName === 'Cleared').map((e) => e.args as { epoch: bigint; tenorId: number; rateBps: number; volume: bigint })
  c.ok('1', 'Cleared(epoch 1, tenor 2, 527, 1000e6) onchain', cleared.length === 1 && cleared[0]!.epoch === 1n && cleared[0]!.tenorId === 2 && cleared[0]!.rateBps === CLEARING_RATE && cleared[0]!.volume === USD(1000))
  const chidi = await view(ctx.w.chidi), bola = await view(ctx.w.bola), dayo = await view(ctx.w.dayo)
  c.ok('1', "Chidi's 1,000 lend stays open (rate never revealed)", chidi.openOrders.length === 1 && big(chidi.openOrders[0]!.remaining) === USD(1000))
  c.ok('1', "Bola's order has 200 left", bola.openOrders.length === 1 && big(bola.openOrders[0]!.remaining) === USD(200))
  const loan = dayo.loans[0] as Record<string, unknown> | undefined
  c.ok('1', 'loan #1: principal 1,000, rate 527, owed 1,000.001003', !!loan && big(loan.principal) === USD(1000) && loan.clearingRateBps === CLEARING_RATE && big(loan.owed) === 1_000_001_003n)
}

// ── Scenarios 2 + 5: a second loan with a garbage blob in the same epoch, then repay ──

export async function scenario2and5(ctx: Ctx) {
  const { ada, bola, chidi } = ctx.w
  console.log('\n[5] garbage blob consumed as invalid; [2] second loan then repay')
  await faucet(ada, dep.ethToken)
  await deposit(ada, 1, parseEther('0.2'))
  await deposit(ada, 0, USD(1)) // covers interest on repay
  // Garbage: right length and version byte, but not encrypted to the enclave key.
  const junk = new Uint8Array(350); crypto.getRandomValues(junk); junk[0] = 1
  ctx.state.txs.garbage = await walletFor(chidi).writeContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'submitIntent', args: [bytesToHex(junk)], gas: 150_000n } as never)
  await pub.waitForTransactionReceipt({ hash: ctx.state.txs.garbage })
  ctx.state.txs.adaBorrow = await submitIntent(ada, intent({ action: ACTION_BORROW, nonce: 2n, rateBps: RATES.adaBorrow, amount: USD(150), collateral: parseEther('0.2') }))
  await waitIndexed(12)
  const r = await settle(ctx, 'E2-borrow-garbage', { trigger: 0, txHash: ctx.state.txs.adaBorrow })
  const c = ctx.checks
  c.ok('5', 'epoch with a garbage intent still settles', r.ok)
  c.ok('5', 'garbage counted as E_DECRYPT', r.userLogs.some((l) => /rejected=1\b/.test(l)))
  const av = await view(ada)
  const loan2 = av.loans.find((l) => (l as Record<string, unknown>).role === 'borrower') as Record<string, unknown> | undefined
  c.ok('2', 'loan #2 for Ada at the clearing rate 527 from Bola', !!loan2 && big(loan2.principal) === USD(150) && loan2.clearingRateBps === CLEARING_RATE)

  const bolaBefore = big((await view(bola)).account?.usdFree)
  ctx.state.txs.adaRepay = await submitIntent(ada, intent({ action: ACTION_REPAY, nonce: 3n, refId: big(loan2?.id), tenorId: 0 }))
  await waitIndexed(13)
  const r3 = await settle(ctx, 'E3-repay', { trigger: 0, txHash: ctx.state.txs.adaRepay })
  c.ok('2', 'repay epoch settles', r3.ok)
  const owed = owedFor(USD(150), BigInt(CLEARING_RATE), 600n)
  const after = await view(ada), bolaAfter = big((await view(bola)).account?.usdFree)
  c.ok('2', 'lender credited principal + interest', bolaAfter - bolaBefore === owed, `Bola +${fmt(bolaAfter - bolaBefore, 6)} tUSD, owed ${fmt(owed, 6)}`)
  c.ok('2', 'borrower repaid volume grows (tier progress)', big(after.account?.repaidVolume) === USD(150) && big(after.account?.ethLocked) === 0n,
    `repaidVolume ${fmt(big(after.account?.repaidVolume), 6)}, tier ${after.account?.tier}`)
}

// ── Scenarios 3 + 4: crash + liquidation, and a capped withdrawal ──

export async function scenario3and4(ctx: Ctx, crashUsd = 1800) {
  const { ada, bola, dayo } = ctx.w
  console.log(`\n[3] price crash to $${crashUsd} → liquidation; [4] withdrawal capped by ledger balance`)
  const before = { ada: await view(ada), bola: await view(bola), dayo: await view(dayo), tre: await view(ctx.deployer) }
  const bolaWallet0 = await pub.readContract({ address: dep.usdToken, abi: erc20Abi, functionName: 'balanceOf', args: [bola.address] })
  await setPrice(ctx.deployer, BigInt(crashUsd) * 10n ** 8n)
  ctx.state.txs.bolaWithdraw = await requestWithdraw(bola, 0, USD(500)) // more than Bola's free balance
  await waitIndexed(14)
  const r = await settle(ctx, 'E4-crash-withdraw', { trigger: 1 })
  const c = ctx.checks
  if (!c.ok('3', 'cron settle succeeded', r.ok)) return
  c.ok('3', 'liquidations=1', r.userLogs.some((l) => /liq=1\b/.test(l)))
  const after = { ada: await view(ada), bola: await view(bola), dayo: await view(dayo), tre: await view(ctx.deployer) }
  const d = (k: keyof typeof before) => big(after[k].account?.ethFree) - big(before[k].account?.ethFree)
  // DEMO-SCRIPT §2 numbers
  c.ok('3', 'Ada +0.348333682711666668 tETH (incl. 1 wei dust)', d('ada') === 348_333_682_711_666_668n, fmt(d('ada'), 18))
  c.ok('3', 'Bola +0.232222455141111111 tETH', d('bola') === 232_222_455_141_111_111n, fmt(d('bola'), 18))
  c.ok('3', 'treasury +0.030555586202777777 tETH', d('tre') === 30_555_586_202_777_777n, fmt(d('tre'), 18))
  c.ok('3', 'Dayo gets back 0.238888275944444444 tETH, keeps 1,000 tUSD, tier floor', d('dayo') === 238_888_275_944_444_444n && big(after.dayo.account?.ethLocked) === 0n && Number(after.dayo.account?.tier) === 0)

  const payouts = (await events(r.result as Hex)).filter((e) => e.eventName === 'PayoutExecuted').map((e) => e.args as { to: Hex; asset: number; requested: bigint; paid: bigint })
  const freeBefore = big(before.bola.account?.usdFree)
  const p = payouts.find((x) => x.to.toLowerCase() === account(bola))
  c.ok('4', 'PayoutExecuted: requested 500, paid = ledger free balance', !!p && p.requested === USD(500) && p.paid === freeBefore, p ? `paid ${fmt(p.paid, 6)}` : 'missing')
  const bolaWallet1 = await pub.readContract({ address: dep.usdToken, abi: erc20Abi, functionName: 'balanceOf', args: [bola.address] })
  c.ok('4', 'tokens arrived; pendingWithdraw cleared', bolaWallet1 - bolaWallet0 === freeBefore &&
    (await pub.readContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'pendingWithdraw', args: [bola.address, 0] })) === 0n)
}

// ── Scenario 6: tampered server DB → E_ROOT_MISMATCH, nothing written ──

export async function scenario6(ctx: Ctx) {
  console.log('\n[6] server tampering (edit a balance in SQLite)')
  const c = ctx.checks
  const db = ctx.server.dbPath
  const epochBefore = (await settlement()).lastEpoch
  await ctx.server.stop()
  const bak = `${db}.bak`
  rmSync(bak, { force: true })
  const snapshot = new Database(db)
  snapshot.run(`VACUUM INTO '${bak}'`) // consistent copy including WAL contents
  snapshot.close()
  const sql = new Database(db)
  const row = sql.query<{ root: string; snapshot: string }, []>("SELECT root, snapshot FROM states WHERE status='committed' ORDER BY epoch DESC LIMIT 1").get()!
  const snap = JSON.parse(row.snapshot)
  const ada = snap.accounts.find((a: { addr: string }) => a.addr === account(ctx.w.ada))
  ada.usdFree = (BigInt(ada.usdFree) + 1_000_000n).toString() // +1 tUSD for Ada
  sql.query('UPDATE states SET snapshot = ? WHERE root = ?').run(JSON.stringify(snap), row.root)
  sql.close()
  await ctx.server.start()
  const r = await simulate({ trigger: 1, broadcast: true, verbose: true })
  await Bun.write(join(OUT, 'sim-tamper.log'), r.output)
  c.ok('6', 'enclave aborts with E_ROOT_MISMATCH', !r.ok && r.output.includes('E_ROOT_MISMATCH'))
  c.ok('6', 'nothing written onchain', (await settlement()).lastEpoch === epochBefore)
  await ctx.server.stop()
  for (const f of [db, `${db}-wal`, `${db}-shm`]) rmSync(f, { force: true })
  copyFileSync(bak, db)
  await ctx.server.start()
  await syncedRoot()
  console.log('  server DB restored; roots agree again')
}

// ── Scenario 7: forged report from an EOA → InvalidSender ──

export async function scenario7(ctx: Ctx) {
  console.log('\n[7] forged report from an EOA')
  const st = await settlement()
  const forged = encodeReport({
    epoch: st.lastEpoch + 1n, prevRoot: st.stateRoot, newRoot: `0x${'ab'.repeat(32)}`, inboxTo: st.cursor, inboxAccTo: `0x${'00'.repeat(32)}`,
    asOf: BigInt(Math.floor(Date.now() / 1000)), priceRoundId: 1n, priceUsed: 2500n * 10n ** 8n, clears: [],
    payouts: [{ to: account(ctx.w.ada), asset: 0, requested: USD(1000), paid: USD(1000) }],
  })
  let reason = ''
  try {
    await pub.simulateContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'onReport', args: [`0x${'00'.repeat(64)}`, forged], account: ctx.w.ada })
  } catch (e) {
    reason = (e as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName ?? String((e as Error).message).match(/InvalidSender/)?.[0] ?? 'other'
  }
  ctx.checks.ok('7', 'onReport from Ada reverts InvalidSender', reason === 'InvalidSender', reason || 'did not revert')
}

// ── 08: selective-disclosure credit proof ──

export async function creditProof(ctx: Ctx, who: Name = 'ada') {
  const b = await proof(ctx.w[who]) as { root: Hex; account: { value: Record<string, string | number>; proof: Hex[] } }
  const v = b.account.value
  const a = { addr: v.addr as Hex, usdFree: big(v.usdFree), usdReserved: big(v.usdReserved), ethFree: big(v.ethFree), ethReserved: big(v.ethReserved),
    ethLocked: big(v.ethLocked), tier: Number(v.tier), repaidVolume: big(v.repaidVolume), nonce: big(v.nonce) }
  const ok = await pub.readContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'verifyAccount', args: [a, b.account.proof] })
  console.log(`  ${who}: verifyAccount → ${ok}; disclosed: tier ${a.tier}, repaid volume ${fmt(a.repaidVolume, 6)} tUSD`)
  return ok
}

// ── Scenario 8: escape hatch ──

export async function scenario8(ctx: Ctx) {
  console.log('\n[8] escape hatch: stop settling, wait ESCAPE_DELAY, activateEscape, exit with a proof')
  const { chidi } = ctx.w
  const st = await settlement()
  const delay = 600n
  for (;;) {
    const now = (await pub.getBlock()).timestamp
    const left = st.lastSettleAt + delay + 2n - now
    if (left <= 0n) break
    console.log(`  waiting ${left}s for ESCAPE_DELAY …`)
    await Bun.sleep(Number(left > 60n ? 60n : left) * 1000)
  }
  const b = await proof(chidi) as { root: Hex; account: { value: Record<string, string | number>; proof: Hex[] } }
  const v = b.account.value
  const a = { addr: v.addr as Hex, usdFree: big(v.usdFree), usdReserved: big(v.usdReserved), ethFree: big(v.ethFree), ethReserved: big(v.ethReserved),
    ethLocked: big(v.ethLocked), tier: Number(v.tier), repaidVolume: big(v.repaidVolume), nonce: big(v.nonce) }
  const w = walletFor(chidi)
  ctx.state.txs.activateEscape = await w.writeContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'activateEscape', gas: 120_000n } as never)
  await pub.waitForTransactionReceipt({ hash: ctx.state.txs.activateEscape })
  const bal0 = await pub.readContract({ address: dep.usdToken, abi: erc20Abi, functionName: 'balanceOf', args: [chidi.address] })
  ctx.state.txs.chidiExit = await w.writeContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'exitAccount', args: [a, b.account.proof], gas: 400_000n } as never)
  const rc = await pub.waitForTransactionReceipt({ hash: ctx.state.txs.chidiExit })
  const bal1 = await pub.readContract({ address: dep.usdToken, abi: erc20Abi, functionName: 'balanceOf', args: [chidi.address] })
  const c = ctx.checks
  c.ok('8', 'escape activated', (await settlement()).escaped)
  c.ok('8', 'Chidi exits with a Merkle proof and gets 1,000 tUSD back', rc.status === 'success' && bal1 - bal0 === USD(1000), `+${fmt(bal1 - bal0, 6)} tUSD`)
}

export async function showAccounts(ctx: Ctx) {
  const rows = []
  for (const [n, a] of [...Object.entries(ctx.w), ['treasury', ctx.deployer]] as [string, Account][]) {
    const v = await view(a)
    rows.push({ wallet: n, usdFree: fmt(big(v.account?.usdFree), 6), usdReserved: fmt(big(v.account?.usdReserved), 6),
      ethFree: fmt(big(v.account?.ethFree), 18), ethLocked: fmt(big(v.account?.ethLocked), 18), tier: v.account?.tier ?? '-',
      orders: v.openOrders.length, loans: v.loans.length })
  }
  table(rows)
}
