// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ReceiverTemplate} from "./cre/ReceiverTemplate.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {TervaneLeaves} from "./lib/TervaneLeaves.sol";
import {TervaneMath} from "./lib/TervaneMath.sol";

/// @title TervaneCore — custody, onchain inbox, CRE settlement receiver and escape hatch.
/// @notice Funds move only through (a) a settlement report delivered by the CRE forwarder and checked per
///         PROTOCOL-SPEC §11, or (b) the escape hatch (§14) after settlement has stopped for ESCAPE_DELAY.
contract TervaneCore is ReceiverTemplate, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ── types (§11) ─────────────────────────────────────────
    struct Clear { uint8 tenorId; uint32 rateBps; uint256 volume; }
    struct Payout { address to; uint8 asset; uint256 requested; uint256 paid; }
    struct SettlementReport {
        uint64 epoch;
        bytes32 prevRoot;
        bytes32 newRoot;
        uint64 inboxTo;
        bytes32 inboxAccTo;
        uint64 asOf;
        uint80 priceRoundId;
        int256 priceUsed;
        Clear[] clears;
        Payout[] payouts;
    }
    struct SettlementState {
        bytes32 stateRoot; uint64 lastEpoch; uint64 cursor; uint64 inboxCount;
        uint64 lastSettleAt; bool escaped; uint64 lastAsOf; uint80 lastPriceRoundId;
    }
    struct Params { uint64 grace; uint64 escapeDelay; uint64 maxSkew; uint64 maxPriceAge; }

    // ── constants / config ──────────────────────────────────
    uint8 public constant ASSET_USD = 0;
    uint8 public constant ASSET_ETH = 1;
    uint8 public constant KIND_DEPOSIT = 1;
    uint8 public constant KIND_INTENT = 2;
    uint8 public constant KIND_WITHDRAW = 3;
    uint8 public constant REPORT_VERSION = 1;
    uint256 public constant BLOB_LEN = 350;
    uint256 public constant MAX_PAYOUTS_PER_EPOCH = 32;

    IERC20 public immutable usd;
    IERC20 public immutable eth;
    uint64 public immutable GRACE;
    uint64 public immutable ESCAPE_DELAY;
    uint64 public immutable MAX_SKEW;
    uint64 public immutable MAX_PRICE_AGE;

    AggregatorV3Interface public priceFeed;
    address public treasury;
    bytes public enclavePubKey;

    // ── settlement state (hot fields packed: slot A = 4×u64, slot B = u80 + u64 + bool) ──
    bytes32 public stateRoot;
    uint64 public lastEpoch;
    uint64 public cursor;
    uint64 public lastAsOf;
    uint64 public lastSettleAt;
    uint80 public lastPriceRoundId;
    uint64 public inboxCount;
    bool public escaped;

    mapping(uint64 => bytes32) public inboxAcc; // inboxAcc[0] = 0
    mapping(address => mapping(uint8 => uint256)) public pendingWithdraw;

    // ── escape bookkeeping ──────────────────────────────────
    mapping(address => bool) public exited;
    mapping(uint64 => bool) public resolved;
    mapping(address => uint256) public claimUsd;
    mapping(address => uint256) public claimEth;

    // ── events (CONTRACTS.md §4) ────────────────────────────
    event InboxMessage(uint64 indexed index, uint8 indexed kind, address indexed sender, uint8 asset, uint256 amount, bytes blob);
    event EpochSettled(uint64 indexed epoch, bytes32 newRoot, uint64 inboxTo, uint64 asOf, int256 priceUsed);
    event Cleared(uint64 indexed epoch, uint8 indexed tenorId, uint32 rateBps, uint256 volume);
    event PayoutExecuted(uint64 indexed epoch, address indexed to, uint8 asset, uint256 requested, uint256 paid);
    event EscapeActivated(uint64 at);
    event AccountExited(address indexed account, uint256 usd, uint256 eth);
    event LoanResolved(uint64 indexed loanId, bool repaid);
    event Claimed(address indexed account, uint256 usd, uint256 eth);
    event EnclavePubKeyUpdated(bytes pubKey);
    event PriceFeedUpdated(address feed);
    event TreasuryUpdated(address treasury);

    // ── errors ──────────────────────────────────────────────
    // §11 checks, in order
    error Escaped();
    error BadReportVersion();
    error BadEpoch(uint64 expected, uint64 got);
    error RootMismatch();
    error InboxOutOfRange();
    error InboxAccMismatch();
    error AsOfRegressed();
    error AsOfSkew();
    error PriceRoundRegressed();
    error PriceMismatch();
    error PriceStale();
    error TooManyPayouts();
    error PayoutExceedsRequest();
    error PayoutExceedsPending();
    // inputs / escape / owner
    error InvalidAsset();
    error ZeroAmount();
    error InvalidBlob();
    error ZeroAddress();
    error InvalidPubKey();
    error NotEscaped();
    error EscapeTooEarly(uint256 availableAfter);
    error NotAccountOwner();
    error NotBorrower();
    error AlreadyExited();
    error AlreadyResolved();
    error LendersMismatch();
    error InvalidProof();
    error NotLiquidatable();

    constructor(
        address forwarder,
        IERC20 usd_,
        IERC20 eth_,
        AggregatorV3Interface feed,
        address treasury_,
        bytes32 genesisRoot,
        uint64 grace,
        uint64 escapeDelay,
        uint64 maxSkew,
        uint64 maxPriceAge
    ) ReceiverTemplate(forwarder) {
        if (address(usd_) == address(0) || address(eth_) == address(0) || address(feed) == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        usd = usd_;
        eth = eth_;
        priceFeed = feed;
        treasury = treasury_;
        stateRoot = genesisRoot;
        GRACE = grace;
        ESCAPE_DELAY = escapeDelay;
        MAX_SKEW = maxSkew;
        MAX_PRICE_AGE = maxPriceAge;
        lastSettleAt = uint64(block.timestamp); // escape clock starts at deploy
    }

    // ── user entry points (inbox, §4) ───────────────────────

    function deposit(uint8 asset, uint256 amount) external nonReentrant {
        if (escaped) revert Escaped();
        if (amount == 0) revert ZeroAmount();
        _token(asset).safeTransferFrom(msg.sender, address(this), amount);
        _append(KIND_DEPOSIT, msg.sender, asset, amount, bytes32(0), "");
    }

    function submitIntent(bytes calldata blob) external {
        if (escaped) revert Escaped();
        if (blob.length != BLOB_LEN || blob[0] != 0x01) revert InvalidBlob();
        _append(KIND_INTENT, msg.sender, 0, 0, keccak256(blob), blob);
    }

    function requestWithdraw(uint8 asset, uint256 amount) external {
        if (escaped) revert Escaped();
        if (asset > ASSET_ETH) revert InvalidAsset();
        if (amount == 0) revert ZeroAmount();
        pendingWithdraw[msg.sender][asset] += amount;
        _append(KIND_WITHDRAW, msg.sender, asset, amount, bytes32(0), "");
    }

    function _append(uint8 kind, address sender, uint8 asset, uint256 amount, bytes32 blobHash, bytes memory blob) private {
        uint64 i = inboxCount + 1;
        inboxCount = i;
        inboxAcc[i] = TervaneLeaves.accStep(inboxAcc[i - 1], TervaneLeaves.msgHash(i, kind, sender, asset, amount, blobHash));
        emit InboxMessage(i, kind, sender, asset, amount, blob);
    }

    // ── settlement (§11) ────────────────────────────────────

    function _processReport(bytes calldata report) internal override nonReentrant {
        if (escaped) revert Escaped();                                                         // 1
        (uint8 version, SettlementReport memory r) = abi.decode(report, (uint8, SettlementReport));
        if (version != REPORT_VERSION) revert BadReportVersion();                              // 2
        if (r.epoch != lastEpoch + 1) revert BadEpoch(lastEpoch + 1, r.epoch);                 // 3
        if (r.prevRoot != stateRoot) revert RootMismatch();                                    // 4
        if (r.inboxTo < cursor || r.inboxTo > inboxCount) revert InboxOutOfRange();            // 5
        if (r.inboxAccTo != inboxAcc[r.inboxTo]) revert InboxAccMismatch();
        if (r.asOf < lastAsOf) revert AsOfRegressed();                                         // 6
        uint256 skew = r.asOf > block.timestamp ? r.asOf - block.timestamp : block.timestamp - r.asOf;
        if (skew > MAX_SKEW) revert AsOfSkew();
        if (r.priceRoundId < lastPriceRoundId) revert PriceRoundRegressed();                  // 7
        _checkPriceRound(r.priceRoundId, r.priceUsed);
        uint256 n = r.payouts.length;                                                          // 8
        if (n > MAX_PAYOUTS_PER_EPOCH) revert TooManyPayouts();
        for (uint256 k; k < n; ++k) {
            Payout memory p = r.payouts[k];
            if (p.asset > ASSET_ETH) revert InvalidAsset();
            if (p.paid > p.requested) revert PayoutExceedsRequest();
            uint256 pending = pendingWithdraw[p.to][p.asset];
            if (p.requested > pending) revert PayoutExceedsPending();
            pendingWithdraw[p.to][p.asset] = pending - p.requested;
        }

        stateRoot = r.newRoot;                                                                 // 9
        lastEpoch = r.epoch;
        cursor = r.inboxTo;
        lastAsOf = r.asOf;
        lastPriceRoundId = r.priceRoundId;
        lastSettleAt = uint64(block.timestamp);

        emit EpochSettled(r.epoch, r.newRoot, r.inboxTo, r.asOf, r.priceUsed);                // 10
        for (uint256 k; k < r.clears.length; ++k) {
            emit Cleared(r.epoch, r.clears[k].tenorId, r.clears[k].rateBps, r.clears[k].volume);
        }
        for (uint256 k; k < n; ++k) {
            Payout memory p = r.payouts[k];
            emit PayoutExecuted(r.epoch, p.to, p.asset, p.requested, p.paid);
            if (p.paid > 0) _token(p.asset).safeTransfer(p.to, p.paid); // interactions last
        }
    }

    function _checkPriceRound(uint80 roundId, int256 priceUsed) private view {
        try priceFeed.getRoundData(roundId) returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (priceUsed <= 0 || answer != priceUsed) revert PriceMismatch();
            if (updatedAt < block.timestamp && block.timestamp - updatedAt > MAX_PRICE_AGE) revert PriceStale();
        } catch {
            revert PriceMismatch();
        }
    }

    // ── escape hatch (§14) ──────────────────────────────────

    function activateEscape() external {
        if (escaped) revert Escaped();
        uint256 after_ = uint256(lastSettleAt) + ESCAPE_DELAY;
        if (block.timestamp <= after_) revert EscapeTooEarly(after_);
        escaped = true;
        emit EscapeActivated(uint64(block.timestamp));
    }

    function exitAccount(TervaneLeaves.Account calldata a, bytes32[] calldata proof) external nonReentrant {
        if (!escaped) revert NotEscaped();
        if (msg.sender != a.addr) revert NotAccountOwner();
        if (exited[a.addr]) revert AlreadyExited();
        if (!MerkleProof.verifyCalldata(proof, stateRoot, TervaneLeaves.hashAccount(a))) revert InvalidProof();
        exited[a.addr] = true;
        uint256 u = a.usdFree + a.usdReserved;
        uint256 e = a.ethFree + a.ethReserved;
        emit AccountExited(a.addr, u, e);
        if (u > 0) usd.safeTransfer(a.addr, u);
        if (e > 0) eth.safeTransfer(a.addr, e);
    }

    function escapeRepay(TervaneLeaves.Loan calldata l, TervaneLeaves.LenderShare[] calldata s, bytes32[] calldata proof)
        external nonReentrant
    {
        _checkLoan(l, s, proof);
        if (msg.sender != l.borrower) revert NotBorrower();
        resolved[l.id] = true;
        uint256[] memory shares = _split(l.owed, s);
        for (uint256 i; i < s.length; ++i) claimUsd[s[i].lender] += shares[i];
        emit LoanResolved(l.id, true);
        usd.safeTransferFrom(msg.sender, address(this), l.owed);
        if (l.collateral > 0) eth.safeTransfer(l.borrower, l.collateral);
    }

    function escapeLiquidate(TervaneLeaves.Loan calldata l, TervaneLeaves.LenderShare[] calldata s, bytes32[] calldata proof)
        external nonReentrant
    {
        _checkLoan(l, s, proof);
        (, int256 answer,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (answer <= 0) revert PriceMismatch();
        if (updatedAt < block.timestamp && block.timestamp - updatedAt > MAX_PRICE_AGE) revert PriceStale();
        uint256 price = uint256(answer);
        if (!TervaneMath.isLiquidatable(l.collateral, l.owed, l.tierAtOpen, l.maturity, price, block.timestamp, GRACE)) {
            revert NotLiquidatable();
        }
        resolved[l.id] = true;
        (, uint256 fee, uint256 pot, uint256 returned) = TervaneMath.liquidationAmounts(l.owed, l.collateral, price);
        uint256[] memory shares = _split(pot, s);
        for (uint256 i; i < s.length; ++i) claimEth[s[i].lender] += shares[i];
        claimEth[treasury] += fee;
        claimEth[l.borrower] += returned;
        emit LoanResolved(l.id, false);
    }

    function claim() external nonReentrant {
        uint256 u = claimUsd[msg.sender];
        uint256 e = claimEth[msg.sender];
        claimUsd[msg.sender] = 0;
        claimEth[msg.sender] = 0;
        emit Claimed(msg.sender, u, e);
        if (u > 0) usd.safeTransfer(msg.sender, u);
        if (e > 0) eth.safeTransfer(msg.sender, e);
    }

    function _checkLoan(TervaneLeaves.Loan calldata l, TervaneLeaves.LenderShare[] calldata s, bytes32[] calldata proof)
        private view
    {
        if (!escaped) revert NotEscaped();
        if (resolved[l.id]) revert AlreadyResolved();
        if (keccak256(abi.encode(s)) != l.lendersHash) revert LendersMismatch();
        if (!MerkleProof.verifyCalldata(proof, stateRoot, TervaneLeaves.hashLoan(l))) revert InvalidProof();
    }

    function _split(uint256 total, TervaneLeaves.LenderShare[] calldata s) private pure returns (uint256[] memory) {
        address[] memory addrs = new address[](s.length);
        uint256[] memory weights = new uint256[](s.length);
        for (uint256 i; i < s.length; ++i) (addrs[i], weights[i]) = (s[i].lender, s[i].amount);
        return TervaneMath.split(total, addrs, weights);
    }

    // ── views ───────────────────────────────────────────────

    function settlementState() external view returns (SettlementState memory) {
        return SettlementState(stateRoot, lastEpoch, cursor, inboxCount, lastSettleAt, escaped, lastAsOf, lastPriceRoundId);
    }

    function params() external view returns (Params memory) {
        return Params(GRACE, ESCAPE_DELAY, MAX_SKEW, MAX_PRICE_AGE);
    }

    /// @notice Selective-disclosure credit attestation: proves an account leaf (tier, repaid volume) against
    ///         the live root without revealing anything else about the holder's orders or loans.
    function verifyAccount(TervaneLeaves.Account calldata a, bytes32[] calldata proof) external view returns (bool) {
        return MerkleProof.verifyCalldata(proof, stateRoot, TervaneLeaves.hashAccount(a));
    }

    function verifyLoan(TervaneLeaves.Loan calldata l, bytes32[] calldata proof) external view returns (bool) {
        return MerkleProof.verifyCalldata(proof, stateRoot, TervaneLeaves.hashLoan(l));
    }

    // ── owner (configuration only; timelocked in production) ──

    function setEnclavePubKey(bytes calldata pk) external onlyOwner {
        if (pk.length != 33 || (pk[0] != 0x02 && pk[0] != 0x03)) revert InvalidPubKey();
        enclavePubKey = pk;
        emit EnclavePubKeyUpdated(pk);
    }

    function setPriceFeed(AggregatorV3Interface feed) external onlyOwner {
        if (address(feed) == address(0)) revert ZeroAddress();
        priceFeed = feed;
        emit PriceFeedUpdated(address(feed));
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasuryUpdated(t);
    }

    function _token(uint8 asset) private view returns (IERC20) {
        if (asset == ASSET_USD) return usd;
        if (asset == ASSET_ETH) return eth;
        revert InvalidAsset();
    }
}
