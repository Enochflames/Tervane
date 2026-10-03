# Tervane — Contracts (`contracts/`)

Foundry project targeting Monad testnet. Use Foundry ≥ 1.8 with `network = "monad"` in `foundry.toml` (the old `foundryup --network monad` is ignored, O-7) so `forge test` runs with Monad's gas model (charged on gas limit, no refunds), 128 KB code size limit, and repriced cold access (account ~10,100, storage ~8,100 gas). Solidity 0.8.30, `evm_version = "prague"` (Monad testnet also accepts Osaka opcodes), via-IR, OpenZeppelin v5.4.0 and forge-std as git submodules under `contracts/lib`.

---

## 1. Contracts

| File | Role |
|---|---|
| `src/TervaneCore.sol` | Custody, inbox, settlement report receiver, escape hatch, selective-disclosure views |
| `src/cre/ReceiverTemplate.sol`, `IReceiver.sol`, `IERC165.sol` | Vendored unmodified from Chainlink docs (`public/samples/CRE/` in `smartcontractkit/documentation`) |
| `src/TestToken.sol` | ERC-20 + ERC20Permit with public `faucet()` (rate-limited per address); deployed twice: tUSD (6 dp), tETH (18 dp) |
| `src/MockV3Aggregator.sol` | AggregatorV3-compatible feed, 8 decimals, owner `updateAnswer(int256)`; keeps full round history so `getRoundData(id)` works for past rounds |
| `src/lib/TervaneMath.sol` | Split rule, value/health math, interest — identical to `packages/core/src/math.ts` |
| `src/lib/TervaneLeaves.sol` | Leaf structs + `hashAccount/hashLoan/hashOrder/hashMeta` + `lendersHash` |

Why a mock feed: the demo must crash the ETH price on command to show liquidation. Production config points `priceFeed` at a Chainlink ETH/USD feed on Monad; the contract only depends on the AggregatorV3 interface (`latestRoundData`, `getRoundData`, `decimals`). Check Chainlink's Monad feed directory before claiming a testnet feed address.

---

## 2. `TervaneCore` storage

```solidity
// immutables / config
IERC20 public immutable usd;            // tUSD
IERC20 public immutable eth;            // tETH
AggregatorV3Interface public priceFeed; // owner-settable (timelocked in prod)
address public treasury;
bytes   public enclavePubKey;           // 33-byte compressed secp256k1; owner-settable
uint64  public immutable GRACE;
uint64  public immutable ESCAPE_DELAY;
uint64  public immutable MAX_SKEW;
uint64  public immutable MAX_PRICE_AGE;
uint256 public constant BLOB_LEN = 350;
uint256 public constant MAX_PAYOUTS_PER_EPOCH = 32;

// inbox
uint64 public inboxCount;
mapping(uint64 => bytes32) public inboxAcc;          // inboxAcc[0] = 0

// settlement
bytes32 public stateRoot;                             // genesis root set in constructor
uint64  public lastEpoch;
uint64  public cursor;
uint64  public lastAsOf;
uint80  public lastPriceRoundId;
uint64  public lastSettleAt;
mapping(address => mapping(uint8 => uint256)) public pendingWithdraw;

// escape
bool public escaped;
mapping(address => bool) public exited;
mapping(uint64 => bool) public resolved;             // loanId
mapping(address => uint256) public claimUsd;
mapping(address => uint256) public claimEth;
```

**Genesis root:** the root of a state containing only `META{epoch:0, cursor:0, nextLoanId:1}`. Compute it in TS, pass it to the constructor, and assert in a Foundry test that `TervaneLeaves.hashMeta(0,0,1) == genesisRoot` (single-leaf tree root = the leaf).

Pack hot settlement fields into as few slots as possible: `lastEpoch`, `cursor`, `lastAsOf`, `lastSettleAt` fill one slot (4 × 64 bits; `escaped` does not fit there), and `lastPriceRoundId`, `inboxCount`, `escaped` share a second. Cold SSTOREs are expensive on Monad. `lastSettleAt` is set at deploy so the escape clock starts then.

---

## 3. External functions

### User
```solidity
function deposit(uint8 asset, uint256 amount) external;
    // asset ∈ {0,1}; amount > 0; SafeERC20.safeTransferFrom; _append(DEPOSIT, sender, asset, amount, 0, "")
function submitIntent(bytes calldata blob) external;
    // blob.length == BLOB_LEN && blob[0] == 0x01; _append(INTENT, sender, 0, 0, keccak256(blob), blob)
function requestWithdraw(uint8 asset, uint256 amount) external;
    // amount > 0; pendingWithdraw[sender][asset] += amount; _append(WITHDRAW, sender, asset, amount, 0, "")
```
`_append` increments `inboxCount`, computes `msgHash` and `inboxAcc[i]` per PROTOCOL-SPEC §4, emits `InboxMessage`. Unit test it against `inbox.json`. All three entry points revert `Escaped()` once escape is active (a deposit then would be stranded: no report can credit it and no leaf proves it, D-21).

Gas: `submitIntent` writes one new slot (`inboxAcc[i]`) + updates `inboxCount`; calldata ~350 B. Measure with Monad Foundry and give the web client an explicit gas limit (users pay the limit, not usage).

### Report receiver
```solidity
constructor(address forwarder, ...) ReceiverTemplate(forwarder) { ... }   // ReceiverTemplate already calls Ownable(msg.sender)
function _processReport(bytes calldata report) internal override;
```
Implements PROTOCOL-SPEC §11 checks 1–10 in that order, each with a distinct custom error:
`Escaped()`, `BadReportVersion()`, `BadEpoch(expected, got)`, `RootMismatch()`, `InboxOutOfRange()`, `InboxAccMismatch()`, `AsOfRegressed()`, `AsOfSkew()`, `PriceRoundRegressed()`, `PriceMismatch()`, `PriceStale()`, `TooManyPayouts()`, `PayoutExceedsRequest()`, `PayoutExceedsPending()`.

Payout transfers use `SafeERC20.safeTransfer`. Reentrancy: tokens are our own `TestToken`s, but still apply checks-effects-interactions (update all state, then transfer in a loop) and `nonReentrant` on every function that moves tokens.

### Views (shaped to minimize CRE chain reads)
```solidity
struct SettlementState { bytes32 stateRoot; uint64 lastEpoch; uint64 cursor; uint64 inboxCount;
                         uint64 lastSettleAt; bool escaped; uint64 lastAsOf; uint80 lastPriceRoundId; }
struct Params { uint64 grace; uint64 escapeDelay; uint64 maxSkew; uint64 maxPriceAge; }
function settlementState() external view returns (SettlementState memory);
function params() external view returns (Params memory);
function verifyAccount(Account calldata a, bytes32[] calldata proof) external view returns (bool);
function verifyLoan(Loan calldata l, bytes32[] calldata proof) external view returns (bool);
```
Returning single structs makes viem decode them as named objects in the workflow.

`verifyAccount` is the **selective-disclosure credit attestation**: a user can prove `tier` and `repaidVolume` to any third party (or another contract) against the live `stateRoot` while revealing nothing about their open orders or loans. It is the concrete form of "lending priced on onchain credit history" in the Track 01 pitch.

### Escape hatch (PROTOCOL-SPEC §14)
```solidity
function activateEscape() external;   // block.timestamp > lastSettleAt + ESCAPE_DELAY → escaped = true (latch)
function exitAccount(Account calldata a, bytes32[] calldata proof) external;
function escapeRepay(Loan calldata l, LenderShare[] calldata s, bytes32[] calldata proof) external;
function escapeLiquidate(Loan calldata l, LenderShare[] calldata s, bytes32[] calldata proof) external;
function claim() external;
```
`exitAccount` also pays nothing for `ethLocked` (released by loan resolution) and ignores `pendingWithdraw` (those funds are still in `free` in the leaf).

### Owner
```solidity
function setEnclavePubKey(bytes calldata pk) external onlyOwner;  // length 33, prefix 0x02/0x03
function setPriceFeed(address) external onlyOwner;
function setTreasury(address) external onlyOwner;
// inherited: setForwarderAddress, setExpectedWorkflowId, setExpectedAuthor, setExpectedWorkflowName
```
In the threat model, the owner is trusted for configuration (key rotation, forwarder). Production would put these behind a timelock so users can exit before a malicious key change. Changing `enclavePubKey` while orders are open strands their blobs (the enclave can't decrypt them with a new key); the settler treats undecryptable open orders as cancelled and releases reserves. Document this; don't rotate during the demo.

---

## 4. Events

```solidity
event InboxMessage(uint64 indexed index, uint8 indexed kind, address indexed sender,
                   uint8 asset, uint256 amount, bytes blob);
event EpochSettled(uint64 indexed epoch, bytes32 newRoot, uint64 inboxTo, uint64 asOf, int256 priceUsed);
event Cleared(uint64 indexed epoch, uint8 indexed tenorId, uint32 rateBps, uint256 volume);
event PayoutExecuted(uint64 indexed epoch, address indexed to, uint8 asset, uint256 requested, uint256 paid);
event EscapeActivated(uint64 at);
event AccountExited(address indexed account, uint256 usd, uint256 eth);
event LoanResolved(uint64 indexed loanId, bool repaid);
event Claimed(address indexed account, uint256 usd, uint256 eth);
```
`Cleared` is a public **fixed-rate oracle** per tenor: the market's clearing rate, with zero information about individual bids.

---

## 5. Tests (all must pass before the settler is wired)

**Unit**
- `_append` hashing vs `inbox.json`; leaf hashing vs `leaves.json`; proofs vs `tree.json`; split rule and liquidation math vs `liquidation.json`; report decoding vs `report.json`.
- Every `_processReport` check: one test per custom error, plus a happy path. Call `onReport` from the configured forwarder address (`vm.prank(forwarder)`), with `metadata` bytes as the mock forwarder would send.
- `onReport` from a non-forwarder EOA reverts with `InvalidSender` — this is a demo shot.

**Fuzz**
- Random payout arrays vs random `pendingWithdraw` → never pays more than requested, never underflows.
- Random `asOf`/`block.timestamp` → skew window enforced.

**Invariant (handler-based)**
- I7: `Σ paid ≤ Σ requested` per user/asset; `pendingWithdraw` never underflows.
- Token conservation: `balanceOf(core) == Σ deposits + Σ escapeRepay inflows − Σ paid payouts − Σ escape outflows (exits + claims)`.
- After escape: no `_processReport` succeeds; each account exits at most once; each loan resolves at most once.

**Gas snapshots** (Monad Foundry): `deposit`, `submitIntent`, `requestWithdraw`, `_processReport` with 0/8/32 payouts and 0/3 clears. Feed the 32-payout number (+20%) into `config.writeGasLimit`.

Measured 2026-10-03 (`test/Gas.t.sol`, `network = "monad"`; execution gas of the call, excluding intrinsic):

| Call | Gas |
|---|---|
| `deposit` (first / warm user) | 165,818 / 131,819 |
| `submitIntent` | 90,707 |
| `requestWithdraw` | 113,089 |
| `_processReport` 0 payouts, 0 / 3 clears | 101,608 / 111,735 |
| `_processReport` 8 payouts, 0 / 3 clears | 503,658 / 513,785 |
| `_processReport` 32 payouts, 3 clears (report 4,832 B) | 1,644,953 |

Whole report tx ≈ `_processReport` + ~40k forwarder overhead (S3 trace) + 21k + calldata (report + ~1.1 KB of signatures/metadata).

**On-chain calibration (Phase 3, O-15):** the Gate 3 trace shows `_processReport` at 48,894 gas on Monad testnet versus 101,608 in `forge test`, so Foundry's figures are upper bounds. The settler's D-22 constants are calibrated on chain (idle epoch: 127,434 real, 162,322 limit).

---

## 6. Deployment (`script/Deploy.s.sol`)

Order:
1. Deploy tUSD (6) and tETH (18) `TestToken`s.
2. Deploy `MockV3Aggregator(8, 2500e8)`.
3. Compute genesis root (from a JSON fixture written by `packages/core`).
4. Deploy `TervaneCore(forwarder=MOCK_FORWARDER_MONAD_TESTNET, usd, eth, feed, treasury, genesisRoot, GRACE, ESCAPE_DELAY, MAX_SKEW, MAX_PRICE_AGE)`; demo params from PROTOCOL-SPEC §2.
5. `setEnclavePubKey(<33 bytes derived from TERVANE_ENCLAVE_SK>)`.
6. Write `deployments/monad-testnet.json` (addresses, deploy block, genesis root). The server, settler config generator, web app, and scripts all read this one file.

`foundry.toml`:
```toml
[rpc_endpoints]
monad_testnet = "${MONAD_TESTNET_RPC}"
```
Run (key material only via env, never on the command line):
```bash
cd contracts
set -a; . ../settler/.env; set +a; export DEPLOYER_PK="0x${CRE_ETH_PRIVATE_KEY#0x}"
forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --gas-estimate-multiplier 115 --broadcast --slow
forge verify-contract --chain 10143 --verifier sourcify <addr> <path:Contract> --constructor-args <abi-encoded>
```
The script derives the 33-byte enclave public key from `TERVANE_ENCLAVE_SK` with `vm.createWallet` (cross-checked against noble). Verified on Sourcify (exact match), which MonadVision reads.
