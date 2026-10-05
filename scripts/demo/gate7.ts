// Gate 7 (BUILD-PLAN Phase 7): the escape hatch end to end on a fresh deployment.
// The book is packages/core/test/vectors/escape2.json with the demo wallets: two 7-day loans clear at 527 bps,
// settlement stops, and after ESCAPE_DELAY every account exits with a Merkle proof. Dayo escape-repays, an unrelated
// keeper escape-liquidates Chidi's loan at $1,500, everyone claims, and the contract's token balances end at zero.
// Every expected amount comes from @tervane/core (owedFor, split, liquidationAmounts).
//   set -a; . settler/.env; set +a; bun scripts/demo/run-gate7.ts   (deploys, runs this, restores the web deployment)
import { join } from 'node:path'
import {
  ACTION_BORROW, ACTION_LEND, PAYLOAD_VERSION, coreAbi, erc20Abi, liquidationAmounts, owedFor, split,
  type Address, type Hex, type IntentPayload,
} from '@tervane/core'
import { parseEther, parseEventLogs, type Account } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { proof, waitIndexed } from '../lib/api'
import { accountFromEnv, dep, deposit, faucet, pub, setPrice, settlement, submitIntent, walletFor } from '../lib/chain'
import { CLEARING_RATE, Checks, OUT, RATES, ServerProc, fmt, loadState, saveState, table, wallets, type DemoState } from './lib'
import { fund, settle, type Ctx } from './steps'

const USD = (n: number) => BigInt(Math.round(n * 1e6))
const TENOR = 0 // 7 days: escape has to work for loans that are nowhere near maturity
const SEVEN_DAYS = 604_800n
const intent = (p: Partial<IntentPayload> & { action: number }): IntentPayload =>
  ({ version: PAYLOAD_VERSION, tenorId: TENOR, rateBps: 0, nonce: 1n, refId: 0n, expiresAtEpoch: 0n, amount: 0n, collateral: 0n, ...p })

interface Bundle {
  root: Hex
  account: { value: Record<string, string | number>; proof: Hex[] }
  loans: { value: Record<string, string | number>; lenders: { lender: string; amount: string }[]; proof: Hex[] }[]
}
const big = (x: unknown) => BigInt(String(x ?? '0'))
const shareOf = (l: Bundle['loans'][number], who: Address) => big(l.lenders.find((x) => x.lender.toLowerCase() === who.toLowerCase())?.amount)
const accountArg = (v: Bundle['account']['value']) => ({
  addr: v.addr as Address, usdFree: big(v.usdFree), usdReserved: big(v.usdReserved), ethFree: big(v.ethFree), ethReserved: big(v.ethReserved),
  ethLocked: big(v.ethLocked), tier: Number(v.tier), repaidVolume: big(v.repaidVolume), nonce: big(v.nonce),
})
const loanArgs = (l: Bundle['loans'][number]) => [
  { id: big(l.value.id), borrower: l.value.borrower as Address, tenorId: Number(l.value.tenorId), principal: big(l.value.principal),
    rateBps: Number(l.value.rateBps), owed: big(l.value.owed), collateral: big(l.value.collateral), tierAtOpen: Number(l.value.tierAtOpen),
    openedAt: big(l.value.openedAt), maturity: big(l.value.maturity), lendersHash: l.value.lendersHash as Hex },
  l.lenders.map((s) => ({ lender: s.lender as Address, amount: big(s.amount) })),
  l.proof,
] as const

const bal = (token: Hex, who: Address) => pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [who] })
const read = <T>(functionName: string, args: unknown[] = []) =>
  pub.readContract({ address: dep.tervaneCore, abi: coreAbi, functionName, args } as never) as Promise<T>

async function write(ctx: Ctx, label: string, from: Account, functionName: string, args: unknown[], gas: bigint) {
  const hash = await walletFor(from).writeContract({ address: dep.tervaneCore, abi: coreAbi, functionName, args, gas } as never)
  const r = await pub.waitForTransactionReceipt({ hash })
  ctx.state.txs[label] = hash
  if (r.status !== 'success') throw new Error(`${label} reverted: ${hash}`)
  return r
}

// ── run ─────────────────────────────────────────────────────

const st0 = await settlement()
if (st0.lastEpoch !== 0n || st0.inboxCount !== 0n) throw new Error('deployment is not fresh (epoch 0, empty inbox)')

const state: DemoState = { ...(await loadState()), core: dep.tervaneCore, txs: {}, notes: {} }
const server = new ServerProc(join(import.meta.dir, '..', '..', 'server', 'data', `gate7-${Date.now()}.db`))
state.serverDb = server.dbPath
await Bun.write(join(OUT, 'server.log'), '')
const ctx: Ctx = { w: await wallets(), deployer: accountFromEnv(), state, checks: new Checks(), server }
const c = ctx.checks
const { ada, bola, chidi, dayo } = ctx.w
// A keeper with no position and no relation to the deployment: escape liquidation is permissionless and unpaid.
const keeper = privateKeyToAccount(generatePrivateKey())

try {
  await server.start()
  console.log(`core ${dep.tervaneCore}\n\n[setup] fund demo wallets and a fresh keeper`)
  await fund(ctx)
  const fk = await walletFor(ctx.deployer).sendTransaction({ to: keeper.address, value: parseEther('0.15'), gas: 21_000n } as never)
  if ((await pub.waitForTransactionReceipt({ hash: fk })).status !== 'success') throw new Error('funding the keeper reverted (deployer out of MON?)')

  // ── book: escape2.json ──
  console.log('\n[G7.1] seed the escape2 book (7-day tenor) and settle')
  for (const a of [ada, bola, dayo]) await faucet(a, dep.usdToken) // Dayo's tUSD covers interest on the escape repay
  for (const a of [chidi, dayo]) await faucet(a, dep.ethToken)
  await deposit(ada, 0, USD(600)); await deposit(bola, 0, USD(600))
  await deposit(chidi, 1, parseEther('0.4')); await deposit(dayo, 1, parseEther('0.6'))
  state.txs.adaLend = await submitIntent(ada, intent({ action: ACTION_LEND, rateBps: RATES.ada, amount: USD(600) }))
  state.txs.bolaLend = await submitIntent(bola, intent({ action: ACTION_LEND, rateBps: RATES.bola, amount: USD(600) }))
  state.txs.chidiBorrow = await submitIntent(chidi, intent({ action: ACTION_BORROW, rateBps: RATES.chidi, amount: USD(400), collateral: parseEther('0.4') }))
  state.txs.dayoBorrow = await submitIntent(dayo, intent({ action: ACTION_BORROW, rateBps: RATES.dayo, amount: USD(600), collateral: parseEther('0.6') }))
  await waitIndexed(8)
  const r = await settle(ctx, 'G7-E1', { trigger: 0, txHash: state.txs.dayoBorrow })
  if (!c.ok('G7.1', 'epoch 1 settles', r.ok)) throw new Error('settle failed')
  const cleared = parseEventLogs({ abi: coreAbi, logs: (await pub.getTransactionReceipt({ hash: r.result as Hex })).logs })
    .filter((e) => e.eventName === 'Cleared').map((e) => e.args as { tenorId: number; rateBps: number; volume: bigint })
  c.ok('G7.1', 'Cleared(tenor 0, 527, 1,000 tUSD)', cleared.length === 1 && cleared[0]!.tenorId === TENOR && cleared[0]!.rateBps === CLEARING_RATE && cleared[0]!.volume === USD(1000))

  // Proofs against the last committed root. In escape the server may be gone: users keep these bundles.
  const b = {
    ada: await proof(ada) as Bundle, bola: await proof(bola) as Bundle, chidi: await proof(chidi) as Bundle, dayo: await proof(dayo) as Bundle,
  }
  const root = (await settlement()).stateRoot
  c.ok('G7.1', 'every bundle is for the onchain root', Object.values(b).every((x) => x.root.toLowerCase() === root.toLowerCase()))
  const chidiLoan = b.chidi.loans.find((l) => String(l.value.borrower).toLowerCase() === chidi.address.toLowerCase())!
  const dayoLoan = b.dayo.loans.find((l) => String(l.value.borrower).toLowerCase() === dayo.address.toLowerCase())!
  const owedC = owedFor(USD(400), BigInt(CLEARING_RATE), SEVEN_DAYS), owedD = owedFor(USD(600), BigInt(CLEARING_RATE), SEVEN_DAYS)
  c.ok('G7.1', `loans: Chidi owes ${fmt(owedC, 6)}, Dayo owes ${fmt(owedD, 6)} (lenders Ada 200 / Bola 400)`,
    big(chidiLoan.value.owed) === owedC && big(dayoLoan.value.owed) === owedD &&
    shareOf(dayoLoan, ada.address) === USD(200) && shareOf(dayoLoan, bola.address) === USD(400) && dayoLoan.lenders.length === 2)
  // Ada is a lender on Chidi's loan, so her bundle carries its proof; she hands it to the keeper.
  const chidiLoanFromAda = b.ada.loans.find((l) => l.value.id === chidiLoan.value.id)!

  // ── escape ──
  console.log('\n[G7.2] settlement stops; wait ESCAPE_DELAY; anyone activates escape')
  const st = await settlement()
  const delay = BigInt((dep as unknown as { escapeDelay: number }).escapeDelay)
  for (;;) {
    const left = st.lastSettleAt + delay + 2n - (await pub.getBlock()).timestamp
    if (left <= 0n) break
    console.log(`  waiting ${left}s …`)
    await Bun.sleep(Number(left > 60n ? 60n : left) * 1000)
  }
  await write(ctx, 'activateEscape', keeper, 'activateEscape', [], 120_000n)
  c.ok('G7.2', 'escaped', (await settlement()).escaped)
  const sim = await settle(ctx, 'G7-after-escape', { trigger: 1 })
  c.ok('G7.2', 'the settler stands down after escape (no tx)', sim.result === 'escaped' && (await settlement()).lastEpoch === 1n, sim.result || 'no result')

  // ── exits ──
  console.log('\n[G7.3] every account exits with its own proof')
  const rows = []
  for (const [name, who] of [['ada', ada], ['bola', bola], ['chidi', chidi], ['dayo', dayo]] as const) {
    const a = accountArg(b[name].account.value)
    const u0 = await bal(dep.usdToken, who.address), e0 = await bal(dep.ethToken, who.address)
    await write(ctx, `exit-${name}`, who, 'exitAccount', [a, b[name].account.proof], 400_000n)
    const du = (await bal(dep.usdToken, who.address)) - u0, de = (await bal(dep.ethToken, who.address)) - e0
    c.ok('G7.3', `${name} exits: free + reserved returned, locked collateral stays`, du === a.usdFree + a.usdReserved && de === a.ethFree + a.ethReserved)
    rows.push({ wallet: name, tUSD: `+${fmt(du, 6)}`, tETH: `+${fmt(de, 18)}`, 'locked (stays)': fmt(a.ethLocked, 18) })
  }
  table(rows)
  let again = ''
  try { await pub.simulateContract({ address: dep.tervaneCore, abi: coreAbi, functionName: 'exitAccount', args: [accountArg(b.bola.account.value), b.bola.account.proof], account: bola }) }
  catch (e) { again = (e as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName ?? 'other' }
  c.ok('G7.3', 'a second exit reverts AlreadyExited', again === 'AlreadyExited', again || 'did not revert')

  // ── Dayo escape-repays ──
  console.log('\n[G7.4] Dayo repays in escape: owed to lenders as claims, collateral back')
  const [dLoan, dShares, dProof] = loanArgs(dayoLoan)
  // Lenders are sorted by address in the ledger (PROTOCOL-SPEC §7.1), so look shares up by lender, not position.
  const dSplit = split(owedD, dShares.map((s) => ({ addr: s.lender, weight: s.amount })))
  const dueTo = (who: Address) => dSplit[dShares.findIndex((s) => s.lender.toLowerCase() === who.toLowerCase())]!
  const e0 = await bal(dep.ethToken, dayo.address)
  const ap = await walletFor(dayo).writeContract({ address: dep.usdToken, abi: erc20Abi, functionName: 'approve', args: [dep.tervaneCore, owedD], gas: 80_000n } as never)
  await pub.waitForTransactionReceipt({ hash: ap })
  await write(ctx, 'escapeRepay-dayo', dayo, 'escapeRepay', [dLoan, dShares, dProof], 400_000n)
  c.ok('G7.4', 'Dayo gets 0.6 tETH collateral back', (await bal(dep.ethToken, dayo.address)) - e0 === parseEther('0.6'))
  c.ok('G7.4', `claims: Ada ${fmt(dueTo(ada.address), 6)}, Bola ${fmt(dueTo(bola.address), 6)} tUSD`,
    (await read<bigint>('claimUsd', [ada.address])) === dueTo(ada.address) && (await read<bigint>('claimUsd', [bola.address])) === dueTo(bola.address))

  // ── keeper escape-liquidates Chidi ──
  console.log('\n[G7.5] ETH to $1,500; an unrelated keeper liquidates Chidi\'s loan with the proof Ada handed over')
  const price = 1500n * 10n ** 8n
  await setPrice(ctx.deployer, price)
  const [cLoan, cShares, cProof] = loanArgs(chidiLoanFromAda)
  const liq = liquidationAmounts(owedC, parseEther('0.4'), price)
  const tre = dep.treasury
  const k0 = await bal(dep.ethToken, keeper.address)
  const tre0 = await read<bigint>('claimEth', [tre])
  await write(ctx, 'escapeLiquidate-chidi', keeper, 'escapeLiquidate', [cLoan, cShares, cProof], 400_000n)
  c.ok('G7.5', `seized ${fmt(liq.seized, 18)}: Ada claims ${fmt(liq.pot, 18)}, treasury ${fmt(liq.fee, 18)}, Chidi ${fmt(liq.returned, 18)} tETH`,
    (await read<bigint>('claimEth', [ada.address])) === liq.pot && (await read<bigint>('claimEth', [tre])) - tre0 === liq.fee &&
    (await read<bigint>('claimEth', [chidi.address])) === liq.returned)
  c.ok('G7.5', 'the keeper receives nothing', (await bal(dep.ethToken, keeper.address)) === k0)
  c.ok('G7.5', 'both loans resolved', (await read<boolean>('resolved', [dLoan.id])) && (await read<boolean>('resolved', [cLoan.id])))

  // ── claims ──
  console.log('\n[G7.6] everyone claims; the contract ends empty')
  const claimants: [string, Account][] = [['ada', ada], ['bola', bola], ['chidi', chidi], ['treasury', ctx.deployer]]
  const crows = []
  for (const [name, who] of claimants) {
    const cu = await read<bigint>('claimUsd', [who.address]), ce = await read<bigint>('claimEth', [who.address])
    const u0 = await bal(dep.usdToken, who.address), x0 = await bal(dep.ethToken, who.address)
    await write(ctx, `claim-${name}`, who, 'claim', [], 200_000n)
    const du = (await bal(dep.usdToken, who.address)) - u0, de = (await bal(dep.ethToken, who.address)) - x0
    c.ok('G7.6', `${name} claims exactly its balance`, du === cu && de === ce)
    crows.push({ wallet: name, tUSD: `+${fmt(du, 6)}`, tETH: `+${fmt(de, 18)}` })
  }
  table(crows)
  const left = { usd: await bal(dep.usdToken, dep.tervaneCore), eth: await bal(dep.ethToken, dep.tervaneCore) }
  c.ok('G7.6', 'TervaneCore holds 0 tUSD and 0 tETH', left.usd === 0n && left.eth === 0n, `${fmt(left.usd, 6)} tUSD, ${fmt(left.eth, 18)} tETH`)
} catch (e) {
  c.ok('run', 'no unexpected error', false, (e as Error).message.split('\n')[0])
} finally {
  await saveState(state)
  await server.stop()
}

console.log('\n── Gate 7 summary ──')
const by = new Map<string, boolean>()
for (const r of c.results) by.set(r.scenario, (by.get(r.scenario) ?? true) && r.ok)
table([...by].map(([step, ok]) => ({ step, result: ok ? 'PASS' : 'FAIL' })))
process.exit(c.passed ? 0 : 1)
