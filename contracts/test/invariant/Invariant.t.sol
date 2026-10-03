// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Base} from "../utils/Base.t.sol";
import {TervaneCore} from "../../src/TervaneCore.sol";
import {TestToken} from "../../src/TestToken.sol";
import {MockV3Aggregator} from "../../src/MockV3Aggregator.sol";

/// Drives TervaneCore with deposits, withdrawal requests, honest and malicious settlement reports, time and escape.
contract Handler is Test {
    TervaneCore internal core;
    TestToken[2] internal tok;
    address internal forwarder;
    MockV3Aggregator internal feed;
    address[4] public users = [address(0xA1), address(0xB2), address(0xC3), address(0xD4)];

    uint256[2] public deposited;
    uint256[2] public paidOut;
    mapping(address => mapping(uint8 => uint256)) public requested;
    mapping(address => mapping(uint8 => uint256)) public requestCleared;
    mapping(address => mapping(uint8 => uint256)) public paid;
    uint256 public settledAfterEscape;
    uint256 public settles;
    uint256 public honestRejected;  // honest pre-escape report that reverted (must stay 0)
    uint256 public cheatAccepted;   // report with a payout above its request that succeeded (must stay 0)

    constructor(TervaneCore c, TestToken u, TestToken e, address fwd, MockV3Aggregator f) {
        core = c;
        tok = [u, e];
        forwarder = fwd;
        feed = f;
    }

    function deposit(uint256 who, uint256 asset, uint256 amount) external {
        if (core.escaped()) return;
        address a = users[who % 4];
        uint8 as_ = uint8(asset % 2);
        amount = bound(amount, 1, 1e27);
        tok[as_].mint(a, amount);
        vm.startPrank(a);
        tok[as_].approve(address(core), amount);
        core.deposit(as_, amount);
        vm.stopPrank();
        deposited[as_] += amount;
    }

    function requestWithdraw(uint256 who, uint256 asset, uint256 amount) external {
        if (core.escaped()) return;
        address a = users[who % 4];
        uint8 as_ = uint8(asset % 2);
        amount = bound(amount, 1, 1e27);
        vm.prank(a);
        core.requestWithdraw(as_, amount);
        requested[a][as_] += amount;
    }

    /// Builds a report; `cheat` makes some payouts exceed requests or pending, which must revert.
    function settle(uint256 seed, bool cheat) external {
        vm.warp(block.timestamp + 1 + seed % 50);
        feed.updateAnswer(2500e8);
        TervaneCore.SettlementReport memory r;
        (bool ok, bytes memory ret) = address(core).staticcall(abi.encodeCall(core.settlementState, ()));
        require(ok);
        TervaneCore.SettlementState memory st = abi.decode(ret, (TervaneCore.SettlementState));
        r.epoch = st.lastEpoch + 1;
        r.prevRoot = st.stateRoot;
        r.newRoot = keccak256(abi.encode(seed, st.lastEpoch));
        r.inboxTo = st.inboxCount;
        r.inboxAccTo = core.inboxAcc(st.inboxCount);
        r.asOf = uint64(block.timestamp);
        r.priceRoundId = feed.latestRound();
        r.priceUsed = 2500e8;
        uint256 n = seed % 9;
        r.payouts = new TervaneCore.Payout[](n);
        uint256[2] memory bal = [tok[0].balanceOf(address(core)), tok[1].balanceOf(address(core))];
        for (uint256 k; k < n; ++k) {
            address a = users[(seed >> (k * 4)) % 4];
            uint8 as_ = uint8((seed >> (k * 4 + 2)) % 2);
            uint256 pend = core.pendingWithdraw(a, as_);
            for (uint256 m; m < k; ++m) {
                if (r.payouts[m].to == a && r.payouts[m].asset == as_) {
                    pend = pend > r.payouts[m].requested ? pend - r.payouts[m].requested : 0;
                }
            }
            uint256 rq = pend == 0 ? 0 : uint256(keccak256(abi.encode(seed, k))) % (pend + 1);
            uint256 pd = rq == 0 ? 0 : uint256(keccak256(abi.encode(seed, k, 1))) % (rq + 1);
            if (pd > bal[as_]) pd = bal[as_];
            bal[as_] -= pd;
            if (cheat && k == 0) rq = pend + 1;
            r.payouts[k] = TervaneCore.Payout(a, as_, rq, pd);
        }
        bool cheated = cheat && n > 0;
        vm.prank(forwarder);
        try core.onReport(new bytes(64), abi.encode(uint8(1), r)) {
            settles++;
            if (cheated) cheatAccepted++;
            if (st.escaped) settledAfterEscape++;
            for (uint256 k; k < n; ++k) {
                TervaneCore.Payout memory p = r.payouts[k];
                requestCleared[p.to][p.asset] += p.requested;
                paid[p.to][p.asset] += p.paid;
                paidOut[p.asset] += p.paid;
            }
        } catch {
            if (!cheated && !st.escaped) honestRejected++;
        }
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 400));
    }

    function activateEscape() external {
        try core.activateEscape() {} catch {}
    }
}

contract InvariantTest is Base {
    Handler internal h;

    function setUp() public override {
        super.setUp();
        h = new Handler(core, usd, eth, forwarder, feed);
        feed.transferOwnership(address(h));
        usd.transferOwnership(address(h));
        eth.transferOwnership(address(h));
        targetContract(address(h));
    }

    /// Token conservation: balance == Σ deposits − Σ paid payouts (no escape exits are driven here).
    function invariant_tokenConservation() public view {
        assertEq(usd.balanceOf(address(core)), h.deposited(0) - h.paidOut(0));
        assertEq(eth.balanceOf(address(core)), h.deposited(1) - h.paidOut(1));
    }

    /// I7: per user/asset, paid ≤ requests cleared ≤ requested, and pendingWithdraw is exactly the remainder.
    function invariant_I7_payoutsBoundedByRequests() public view {
        for (uint256 i; i < 4; ++i) {
            address a = h.users(i);
            for (uint8 as_; as_ < 2; ++as_) {
                assertLe(h.paid(a, as_), h.requestCleared(a, as_));
                assertLe(h.requestCleared(a, as_), h.requested(a, as_));
                assertEq(core.pendingWithdraw(a, as_), h.requested(a, as_) - h.requestCleared(a, as_));
            }
        }
    }

    /// Every honest pre-escape report passes all §11 checks; every over-request is rejected.
    function invariant_honestReportsSettleCheatsRevert() public view {
        assertEq(h.honestRejected(), 0, "honest report rejected");
        assertEq(h.cheatAccepted(), 0, "cheating report accepted");
    }

    function invariant_noSettlementAfterEscape() public view {
        assertEq(h.settledAfterEscape(), 0);
    }
}
