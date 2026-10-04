// EIP-712-signed /v1/account for each wallet and the treasury.
import { demoCtx } from './ctx'
import { showAccounts } from './steps'
await showAccounts(await demoCtx())
