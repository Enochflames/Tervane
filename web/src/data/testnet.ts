// The last end-to-end run (Gate 5, 2026-10-04) on Monad testnet. Real transactions; see docs/DECISIONS.md Phase 5 log.
// Rates shown on the landing page are the demo book from DEMO-SCRIPT §2, illustrating what the enclave sees.

export const EXPLORER = 'https://testnet.monadscan.com'
export const REPO = 'https://github.com/Enochflames/Tervane'
export const doc = (name: string) => `${REPO}/blob/main/docs/${name}`

export const CONTRACTS = {
  tervaneCore: '0x062836764f4B81B34D4BCe5DfeA100D96061B6b8',
  tUSD: '0x1B0184aC6Ad50bB9E008326Ed34340f225F58f52',
  tETH: '0xF92Aa695a8E87De5E876837e890325DbD52972FD',
  priceFeed: '0x5271305e7F51B1f77fe60e55Fd26E38B2da09Ac0',
  mockForwarder: '0xB9F79d863261869B234c481D1f9A7af84AeAd192',
} as const

export interface InboxRow {
  index: number
  kind: 'DEPOSIT' | 'INTENT'
  who: 'Ada' | 'Bola' | 'Chidi' | 'Dayo'
  /** deposits are public */
  deposit?: string
  /** intents: real 350-byte ciphertext prefix from the tx calldata */
  blob?: string
  /** what decryption reveals (enclave, or the owner on their own device) */
  plain?: { action: 'LEND' | 'BORROW'; amount: string; rate: string; extra?: string }
  tx?: string
}

export const INBOX: InboxRow[] = [
  { index: 1, kind: 'DEPOSIT', who: 'Ada', deposit: '600.00 tUSD' },
  { index: 2, kind: 'DEPOSIT', who: 'Bola', deposit: '600.00 tUSD' },
  { index: 3, kind: 'DEPOSIT', who: 'Chidi', deposit: '1,000.00 tUSD' },
  { index: 4, kind: 'DEPOSIT', who: 'Dayo', deposit: '0.85 tETH' },
  { index: 5, kind: 'INTENT', who: 'Ada', blob: '0x0103a36dd018cff3f6a5b118b4e8238cc957d2bb536a593b',
    plain: { action: 'LEND', amount: '600 tUSD', rate: 'min 4.13%' }, tx: '0x94523a0a1c41fd9ebab8d6aef79e906505c8680bcefc6c5f737f8d17c7aba4dc' },
  { index: 6, kind: 'INTENT', who: 'Bola', blob: '0x0103b834ffc5eb0d33b58246543115cd46e53f86ad864c4c',
    plain: { action: 'LEND', amount: '600 tUSD', rate: 'min 5.27%' }, tx: '0x718f6e699f6ec224af617b2988023c9e9403e08c1f4052f3ce8cb134d3d13df5' },
  { index: 7, kind: 'INTENT', who: 'Chidi', blob: '0x0103ef23e50ae7ff41612c0b4f1c2c309566df1bf817d612',
    plain: { action: 'LEND', amount: '1,000 tUSD', rate: 'min 6.11%' }, tx: '0xf8468c3a603f1b84a68c28944d6b212ca04897a5523b94083ecb2b71083f2689' },
  { index: 8, kind: 'INTENT', who: 'Dayo', blob: '0x0103d2619a81f77b89c05e8bc2f3375a834d40651ed12ab2',
    plain: { action: 'BORROW', amount: '1,000 tUSD', rate: 'max 5.52%', extra: '0.85 tETH collateral' }, tx: '0x5fa53eae72b623c5e60cf0d43bd3c6f0389093a6f468f0d53e0aba53636834f0' },
]

export const EPOCH_1 = { tx: '0x7bee003aea267c1592daf15cb9e69a03947e5fcdac48be82f47bf2c95adf3467', rate: '5.27%', volume: '1,000 tUSD', tenor: '10-min demo tenor' }

export const RUN = [
  { step: 'Seed', what: 'Four deposits, then three sealed lends and one sealed borrow', tx: '0x5fa53eae72b623c5e60cf0d43bd3c6f0389093a6f468f0d53e0aba53636834f0', result: '8 inbox messages · 4 × 350 B' },
  { step: 'Epoch 1', what: 'Log trigger on the borrow; the enclave clears the book', tx: '0x7bee003aea267c1592daf15cb9e69a03947e5fcdac48be82f47bf2c95adf3467', result: 'Cleared at 5.27% · 1,000 tUSD' },
  { step: 'Epoch 2', what: 'A second loan, with a garbage blob in the same epoch', tx: '0xe549c5fd614d8250319ca8f89f111c60969c07a9ed3691f2e18a48eafc9e01ed', result: 'Garbage consumed as invalid' },
  { step: 'Epoch 3', what: 'The borrower repays; lenders are credited principal + interest', tx: '0x3e8e1dd52c5d22a3cfd0a1f4f240b15cf6a1d2fad20a6379f7503385a9e5d4c8', result: '+150.000151 tUSD to the lender' },
  { step: 'Epoch 4', what: 'ETH falls to $1,800: liquidation, plus a withdrawal capped at the ledger balance', tx: '0xbe5fc99583d90f704c57851a25a31560f9d815541f8d5eb545ef9c0069e40cae', result: 'Seized owed + 10%, 5% to treasury' },
  { step: 'Escape', what: 'Settlement stops; after the delay a lender exits with a Merkle proof', tx: '0xbeb06c9941d053b765e098e950f4df4c1849c7b913839c80254cf4be7e367b3f', result: '1,000 tUSD returned' },
]

export const short = (h: string, a = 6, b = 4) => `${h.slice(0, a)}…${h.slice(-b)}`
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`
