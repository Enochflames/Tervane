export interface TenorInfo {
  id: number
  seconds: number
  label: string
  description: string
  defaultRateBps: number
}

export const TENORS: TenorInfo[] = [
  { id: 0, seconds: 604_800, label: '7 Days', description: 'Short-term liquidity', defaultRateBps: 413 },
  { id: 1, seconds: 2_592_000, label: '30 Days', description: 'Standard term credit', defaultRateBps: 527 },
  { id: 2, seconds: 600, label: 'DEMO-10m', description: 'Fast settlement testnet tenor', defaultRateBps: 552 },
]

export interface CreditTier {
  tier: number
  name: string
  openRatioBps: number
  liqRatioBps: number
  minRepaidUsd: number
  maxBorrowCap: string
  badgeColor: string
}

export const CREDIT_TIERS: CreditTier[] = [
  {
    tier: 0,
    name: 'Bronze',
    openRatioBps: 20_000, // 200%
    liqRatioBps: 16_000,  // 160%
    minRepaidUsd: 0,
    maxBorrowCap: '$2,000 max principal',
    badgeColor: '#c28859',
  },
  {
    tier: 1,
    name: 'Silver',
    openRatioBps: 18_000, // 180%
    liqRatioBps: 14_500,  // 145%
    minRepaidUsd: 1_000,
    maxBorrowCap: 'Max($2,000, 100% repaid volume)',
    badgeColor: '#a8b3be',
  },
  {
    tier: 2,
    name: 'Gold',
    openRatioBps: 15_000, // 150%
    liqRatioBps: 12_500,  // 125%
    minRepaidUsd: 5_000,
    maxBorrowCap: '150% of repaid volume',
    badgeColor: '#eab308',
  },
  {
    tier: 3,
    name: 'Platinum',
    openRatioBps: 13_000, // 130%
    liqRatioBps: 11_500,  // 115%
    minRepaidUsd: 20_000,
    maxBorrowCap: '200% of repaid volume',
    badgeColor: '#38bdf8',
  },
]

export interface DemoBid {
  id: string
  wallet: string
  role: 'lender' | 'borrower'
  deposit: string
  amount: number // tUSD
  rateBps: number // bps: 413 = 4.13%
  collateralEth?: number // tETH for borrower
  tier?: number
  cipherBlobHex: string
}

export const DEMO_BOOK: DemoBid[] = [
  {
    id: 'bid-ada',
    wallet: 'Ada (0x7a39...4f12)',
    role: 'lender',
    deposit: '600 tUSD',
    amount: 600,
    rateBps: 413, // 4.13%
    cipherBlobHex: '0x01b8e4f1a29c30d944e89123847291aebc523491823791823478912347891234...[350 bytes]',
  },
  {
    id: 'bid-bola',
    wallet: 'Bola (0x3d12...98c1)',
    role: 'lender',
    deposit: '600 tUSD',
    amount: 600,
    rateBps: 527, // 5.27%
    cipherBlobHex: '0x01a39f029c48b211a78491823749182348912374891237489123748912374891...[350 bytes]',
  },
  {
    id: 'bid-chidi',
    wallet: 'Chidi (0x99e1...12ab)',
    role: 'lender',
    deposit: '1,000 tUSD',
    amount: 1000,
    rateBps: 611, // 6.11%
    cipherBlobHex: '0x01772910cde49182374918237491823749182374918237491823749182374918...[350 bytes]',
  },
  {
    id: 'bid-dayo',
    wallet: 'Dayo (0x4b88...77e9)',
    role: 'borrower',
    deposit: '0.85 tETH',
    amount: 1000,
    rateBps: 552, // 5.52% max
    collateralEth: 0.85,
    tier: 0, // Bronze
    cipherBlobHex: '0x01f481923ab49182374918237491823749182374918237491823749182374918...[350 bytes]',
  },
]

export interface EnvelopeSegment {
  name: string
  bytes: number
  hexPreview: string
  role: string
  color: string
}

export const ENVELOPE_SEGMENTS: EnvelopeSegment[] = [
  {
    name: 'Version Tag',
    bytes: 1,
    hexPreview: '0x01',
    role: 'Fixed protocol version tag. Rejects incompatible payload encodings.',
    color: '#a78bfa',
  },
  {
    name: 'Ephemeral Public Key',
    bytes: 33,
    hexPreview: '0x028a3f...d8',
    role: 'Compressed secp256k1 key generated per-intent in the browser. Never reused.',
    color: '#38bdf8',
  },
  {
    name: 'Initialization Vector',
    bytes: 12,
    hexPreview: '0x9e120...f4',
    role: '12-byte random nonce for AES-256-GCM authenticated cipher.',
    color: '#34d399',
  },
  {
    name: 'Encrypted Payload + Tag',
    bytes: 304,
    hexPreview: '0x49c81b...ae',
    role: '288-byte ABI IntentPayload + 16-byte Poly1305/GCM auth tag. Rates exist in plaintext only inside TEE memory.',
    color: '#f43f5e',
  },
]
