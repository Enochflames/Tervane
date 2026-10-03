# Tervane — Web Client (`web/`)

Vite + React + wagmi/viem, talking to Monad testnet. The client is where plaintext intents are born and the only place outside the enclave where a user's own rate exists. Keep it small and correct; the demo needs clarity more than polish.

---

## 1. Screens

| Screen | Contents |
|---|---|
| **Market** | Per-tenor last clearing rate + volume (from `Cleared` events / `/v1/market`), epoch, seconds since last settlement, escape status banner |
| **Wallet** | Faucet buttons (tUSD, tETH), deposit, request withdrawal, ledger balances (free / reserved / locked) from `/v1/account` |
| **Lend** | Tenor, amount, minimum rate → encrypt → `submitIntent`. List of my open lend orders with **my bid shown from local storage only** |
| **Borrow** | Tenor, amount, maximum rate, collateral; live collateral requirement for my tier at the current price; encrypt → `submitIntent` |
| **Positions** | My loans as borrower (owed, maturity, health, liquidation price) and as lender (share, clearing rate, expected payout); Repay button (REPAY intent) |
| **Credit** | Tier, repaid volume, next tier threshold; **"Prove my tier"** button that fetches my account proof and calls `verifyAccount` on-chain, showing `true` without revealing anything else |
| **Escape** | Only when `escaped == true` or `now > lastSettleAt + ESCAPE_DELAY`: activate escape, exit account, escape-repay, escape-liquidate (any loan), claim |

---

## 2. The encryption path (must match PROTOCOL-SPEC §5–§6 exactly)

1. **Read `enclavePubKey` from `TervaneCore` on chain.** Never from the server. Validate: 33 bytes, prefix `0x02`/`0x03`, and `secp256k1.Point.fromHex` succeeds.
2. Read `nonce` from `/v1/account` (the ledger's last used nonce) and use `max(serverNonce, localNonce) + 1`; persist `localNonce` immediately so two quick submissions can't reuse a nonce.
3. Build `IntentPayload` with `encodeAbiParameters` (viem) — use the shared `@tervane/core` encoder, not a local copy.
4. Encrypt with `@tervane/core/crypto.encryptIntent(payload, enclavePubKey, { chainId: 10143n, core, sender })`. The `sender` **must be the connected account** that will send the transaction; otherwise the enclave's AAD check fails and the intent is silently ignored.
5. Send `submitIntent(blob)` with an explicit gas limit from the gas snapshot (+20%). On Monad, users pay for the limit.
6. Record locally: `{ txHash, inboxIndex (from the receipt's InboxMessage log), action, tenor, amount, rateBps, collateral, nonce }`. The inbox index becomes the order id, so the UI can join server-reported orders to local rates.

Golden-vector test in `web` CI: `encryptIntent` with the fixed ephemeral key and IV from `ecies.json` must reproduce the vector blob byte-for-byte.

---

## 3. Local storage policy

- Key by `chainId:core:account`. Store only the user's own submitted intents and the last fetched proof bundle.
- This is the user's device; storing their own rate there is fine and is the only way to show "your bid" without a server that knows it.
- Provide "export my data" (JSON) and "clear" buttons.
- Never send local rates anywhere. There is no API that accepts them.

---

## 4. Status tracking

After `submitIntent`, poll `/v1/account` until the order appears (or the next epoch passes without it, which means the intent was rejected; show the likely reasons: balance, nonce, tier cap, collateral ratio, tenor). The client knows its own payload, so it can pre-validate most rules before sending (balance, cap, collateral at current price) and should, to avoid wasted gas.

---

## 5. Proof caching for the escape hatch

Every time the user opens Positions or Credit, fetch `/v1/proof` and cache it with its root. In Escape mode the UI uses the cached bundle if the server is unreachable, and checks that its root equals the onchain `stateRoot` before submitting (otherwise it explains that the cached proof is stale and which epoch it belongs to).

---

## 6. Copy rules

All user-facing text follows `THREAT-MODEL.md §5`. In particular, say "your rate is visible only to you and the enclave", not "nobody can ever see your rate", and show the trust model link in the footer.
