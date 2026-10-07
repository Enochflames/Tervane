// Live-demo prep (DEMO-SCRIPT §1): puts the two background lenders of the demo book (§2) into the inbox from the local
// demo wallets — Bola LEND 600 tUSD and Chidi LEND 1,000 tUSD, tenor 2 (DEMO-10m). On camera, your browser wallets play
// Ada (LEND 600 @ min 4.13%) and Dayo (BORROW 1,000 @ max 5.52%, 0.85 tETH), so the epoch clears at 5.27% exactly as
// in §2, and Chidi's bid never fills. Rates are encrypted here and never printed.
// Needs: server + auto-settler running (the auto-settler settles these within seconds).
//   set -a; . settler/.env; set +a; TERVANE_SERVER_PORT=8797 bun scripts/demo/seed-lenders.ts
import { ACTION_LEND, PAYLOAD_VERSION, erc20Abi, type IntentPayload } from '@tervane/core'
import { parseEther, type Account } from 'viem'
import { accountView, waitIndexed } from '../lib/api'
import { accountFromEnv, dep, deposit, faucet, pub, settlement, submitIntent, walletFor } from '../lib/chain'
import { RATES, wallets } from './lib'

const USD = (n: number) => BigInt(n) * 1_000_000n
const DEMO_TENOR = 2
const deployer = accountFromEnv()
const { bola, chidi } = await wallets()

async function gas(a: Account) {
  const bal = await pub.getBalance({ address: a.address })
  if (bal >= parseEther('0.15')) return
  const hash = await walletFor(deployer).sendTransaction({ to: a.address, value: parseEther('0.3') - bal, gas: 21_000n } as never)
  if ((await pub.waitForTransactionReceipt({ hash })).status !== 'success') throw new Error('funding gas reverted (deployer out of MON?)')
}

async function lend(name: string, a: Account, amount: bigint, rateBps: number) {
  await gas(a)
  const bal = await pub.readContract({ address: dep.usdToken, abi: erc20Abi, functionName: 'balanceOf', args: [a.address] })
  if (bal < amount) await faucet(a, dep.usdToken) // 10,000 tUSD, once a day per wallet
  await deposit(a, 0, amount)
  // Next nonce = last nonce the ledger consumed + 1 (CLIENT.md §2). A brand-new account starts at 1.
  const view = await accountView(a).catch(() => null)
  const nonce = BigInt(view?.account?.nonce ?? '0') + 1n
  const p: IntentPayload = { version: PAYLOAD_VERSION, action: ACTION_LEND, tenorId: DEMO_TENOR, rateBps, nonce, refId: 0n, expiresAtEpoch: 0n, amount, collateral: 0n }
  const tx = await submitIntent(a, p)
  console.log(`  ${name}: deposit ${amount / 1_000_000n} tUSD + sealed LEND ${amount / 1_000_000n} tUSD (10-min tenor)  tx ${tx}`)
}

if ((await settlement()).escaped) throw new Error('this deployment is in escape; deploy fresh')
console.log(`core ${dep.tervaneCore}: seeding the background lenders`)
await lend('Bola', bola, USD(600), RATES.bola)
await lend('Chidi', chidi, USD(1000), RATES.chidi)
await waitIndexed(Number((await settlement()).inboxCount))
console.log('done: the auto-settler settles both within ~20 s. Their rates exist only in this process and the enclave.')
