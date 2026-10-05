// Auto-settler for live demos: plays the part of CRE's triggers against `cre workflow simulate --broadcast`.
// In production the log trigger fires on every intent and the cron runs on its own; a local simulate runs once and
// exits. This loop runs an epoch as soon as:
//   - the inbox has messages the server has indexed (any deposit, intent, withdrawal: settled within seconds),
//   - the feed has a new price round (a price crash liquidates on the next tick),
//   - or HEARTBEAT seconds passed since the last epoch (keeps ESCAPE_DELAY from ever opening the escape hatch).
// It also republishes the current feed price before it goes stale (MAX_PRICE_AGE), so epochs never fail E_PRICE.
// The server must already be running (on TERVANE_SERVER_PORT, default 8787) and the settler config must point at it.
//   set -a; . settler/.env; set +a; TERVANE_SERVER_PORT=8797 bun scripts/demo/autosettle.ts
import { writeSync } from 'node:fs'
import { join } from 'node:path'
import { feedAbi } from '@tervane/core'
import { health, SERVER } from '../lib/api'
import { accountFromEnv, dep, pub, setPrice, settlement } from '../lib/chain'
import { simulate } from '../lib/cre'
import { OUT } from './lib'

const HEARTBEAT = BigInt(process.env.HEARTBEAT_SECONDS ?? 300) // must stay well under ESCAPE_DELAY (600 s in demo mode)
const PRICE_REFRESH_AFTER = 20n * 3600n // MAX_PRICE_AGE is 24 h
const deployer = accountFromEnv()
const ts = () => new Date().toISOString().slice(11, 19)
// writeSync: console.log is block-buffered when stdout is a pipe, which would hide epochs for minutes
const say = (s: string) => writeSync(1, `${ts()}  ${s}\n`)

async function feed() {
  const [roundId, answer, , updatedAt] = await pub.readContract({ address: dep.priceFeed, abi: feedAbi, functionName: 'latestRoundData' })
  return { roundId, answer, updatedAt }
}

async function epoch(reason: string) {
  say(`epoch → ${reason}`)
  const r = await simulate({ trigger: 1, broadcast: true, verbose: true })
  await Bun.write(join(OUT, `sim-auto-${Date.now()}.log`), r.output)
  const stats = r.userLogs.find((l) => l.startsWith('trigger=')) ?? ''
  if (r.ok && r.result.startsWith('0x')) say(`  settled ${stats.replace(/^trigger=\w+ /, '')}  tx ${r.result}`)
  else if (r.ok) say(`  ${r.result}${stats ? `  (${stats})` : ''}`)
  else say(`  FAILED: ${r.output.match(/E_[A-Z_]+[^\n]*/)?.[0] ?? 'see the sim-auto log in scripts/demo/.out'}`)
  return r.ok
}

const cfg = await Bun.file(join(import.meta.dir, '..', '..', 'settler', 'settle', 'config.staging.json')).json() as { serverUrl: string; coreAddress?: string }
if (cfg.serverUrl.replace(/\/$/, '') !== SERVER) {
  console.error(`settler config points at ${cfg.serverUrl}, this loop watches ${SERVER}. Run: bun scripts/gen-settler-config.ts --server ${SERVER}`)
  process.exit(1)
}
say(`core ${dep.tervaneCore}  server ${SERVER}  heartbeat ${HEARTBEAT}s`)
let lastWait = ''
for (;;) {
  try {
    const st = await settlement()
    if (st.escaped) { say('escape is active on this deployment; nothing to settle. Exiting.'); process.exit(0) }
    const h = await health()
    const now = (await pub.getBlock()).timestamp
    const f = await feed()

    if (now - f.updatedAt > PRICE_REFRESH_AFTER) {
      say(`price feed is ${(now - f.updatedAt) / 3600n} h old; republishing ${f.answer / 10n ** 8n} USD`)
      await setPrice(deployer, f.answer)
      continue
    }

    const pending = st.inboxCount > st.cursor
    const indexed = BigInt(h.indexer?.lastInboxIdx ?? 0) >= st.inboxCount
    let reason = ''
    if (pending && indexed) reason = `${st.inboxCount - st.cursor} new inbox message(s)`
    else if (f.roundId > st.lastPriceRoundId && st.lastEpoch > 0n) reason = `new price ${f.answer / 10n ** 8n} USD`
    else if (now - st.lastSettleAt >= HEARTBEAT) reason = 'heartbeat'

    if (reason) {
      lastWait = ''
      if (!(await epoch(reason))) await Bun.sleep(10_000) // don't hammer on a persistent failure
    } else if (pending && !indexed) {
      const msg = `waiting for the server to index inbox #${st.inboxCount} (at #${h.indexer?.lastInboxIdx ?? 0}, ${h.indexer?.lagBlocks ?? '?'} blocks behind)`
      if (msg.split('(')[0] !== lastWait) { say(msg); lastWait = msg.split('(')[0]! }
    }
  } catch (e) {
    say(`error: ${(e as Error).message.split('\n')[0]}`)
    await Bun.sleep(5_000)
  }
  await Bun.sleep(2_000)
}
