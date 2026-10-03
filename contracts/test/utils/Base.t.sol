// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TervaneCore} from "../../src/TervaneCore.sol";
import {TestToken} from "../../src/TestToken.sol";
import {MockV3Aggregator} from "../../src/MockV3Aggregator.sol";
import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";

abstract contract Base is Test {
    string internal constant VEC = "../packages/core/test/vectors/";

    // demo params (PROTOCOL-SPEC §2)
    uint64 internal constant GRACE = 60;
    uint64 internal constant ESCAPE_DELAY = 600;
    uint64 internal constant MAX_SKEW = 120;
    uint64 internal constant MAX_PRICE_AGE = 86_400;
    uint256 internal constant T0 = 1_760_000_000;

    address internal forwarder = makeAddr("forwarder");
    address internal treasury = address(0x7E45);
    TestToken internal usd;
    TestToken internal eth;
    MockV3Aggregator internal feed;
    TervaneCore internal core;
    bytes32 internal genesisRoot;

    function setUp() public virtual {
        vm.warp(T0);
        usd = new TestToken("Tervane USD", "tUSD", 6, 10_000e6, 1 days);
        eth = new TestToken("Tervane ETH", "tETH", 18, 10e18, 1 days);
        feed = new MockV3Aggregator(8, 2500e8);
        genesisRoot = vm.parseJsonBytes32(vm.readFile(string.concat(VEC, "genesis.json")), ".root");
        core = new TervaneCore(
            forwarder, IERC20(address(usd)), IERC20(address(eth)), AggregatorV3Interface(address(feed)), treasury,
            genesisRoot, GRACE, ESCAPE_DELAY, MAX_SKEW, MAX_PRICE_AGE
        );
    }

    // ── helpers ─────────────────────────────────────────────

    function _deposit(address who, uint8 asset, uint256 amount) internal {
        TestToken t = asset == 0 ? usd : eth;
        t.mint(who, amount);
        vm.startPrank(who);
        t.approve(address(core), amount);
        core.deposit(asset, amount);
        vm.stopPrank();
    }

    /// A report that passes every check against the current onchain state (no payouts, no clears).
    function _report(bytes32 newRoot) internal view returns (TervaneCore.SettlementReport memory r) {
        (uint80 round, int256 answer,,,) = feed.latestRoundData();
        uint64 to = core.inboxCount();
        r.epoch = core.lastEpoch() + 1;
        r.prevRoot = core.stateRoot();
        r.newRoot = newRoot;
        r.inboxTo = to;
        r.inboxAccTo = core.inboxAcc(to);
        r.asOf = uint64(block.timestamp);
        r.priceRoundId = round;
        r.priceUsed = answer;
    }

    function _encode(TervaneCore.SettlementReport memory r) internal pure returns (bytes memory) {
        return abi.encode(uint8(1), r);
    }

    /// Delivers a report the way the (mock) KeystoneForwarder does: forwarder calls onReport(metadata, report).
    function _deliver(TervaneCore.SettlementReport memory r) internal {
        vm.prank(forwarder);
        core.onReport(new bytes(64), _encode(r));
    }

    function _deliverRaw(bytes memory report) internal {
        vm.prank(forwarder);
        core.onReport(new bytes(64), report);
    }
}
