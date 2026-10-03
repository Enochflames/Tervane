// MockV3Aggregator.updateAnswer(usd × 1e8). Usage: bun scripts/demo/03-crash-price.ts 1800
import { accountFromEnv, setPrice } from '../lib/chain'
const usd = BigInt(process.argv[2] ?? '1800')
console.log(`updateAnswer(${usd}e8): tx ${await setPrice(accountFromEnv(), usd * 10n ** 8n)}`)
