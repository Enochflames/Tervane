// Contract ABIs used by the settler, server, web app and scripts (CONTRACTS.md §3–§4).
import { parseAbi } from 'viem'

export const coreAbi = parseAbi([
  'struct SettlementState { bytes32 stateRoot; uint64 lastEpoch; uint64 cursor; uint64 inboxCount; uint64 lastSettleAt; bool escaped; uint64 lastAsOf; uint80 lastPriceRoundId; }',
  'struct Params { uint64 grace; uint64 escapeDelay; uint64 maxSkew; uint64 maxPriceAge; }',
  'function settlementState() view returns (SettlementState)',
  'function params() view returns (Params)',
  'function inboxAcc(uint64) view returns (bytes32)',
  'function enclavePubKey() view returns (bytes)',
  'function pendingWithdraw(address, uint8) view returns (uint256)',
  'function deposit(uint8 asset, uint256 amount)',
  'function submitIntent(bytes blob)',
  'function requestWithdraw(uint8 asset, uint256 amount)',
  'event InboxMessage(uint64 indexed index, uint8 indexed kind, address indexed sender, uint8 asset, uint256 amount, bytes blob)',
  'event EpochSettled(uint64 indexed epoch, bytes32 newRoot, uint64 inboxTo, uint64 asOf, int256 priceUsed)',
  'event Cleared(uint64 indexed epoch, uint8 indexed tenorId, uint32 rateBps, uint256 volume)',
  'event PayoutExecuted(uint64 indexed epoch, address indexed to, uint8 asset, uint256 requested, uint256 paid)',
  'event EscapeActivated(uint64 at)',
])

export const feedAbi = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function getRoundData(uint80) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function updateAnswer(int256 answer)',
])

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
  'function faucet()',
])
