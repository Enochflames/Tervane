// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./utils/Base.t.sol";
import {TervaneCore} from "../src/TervaneCore.sol";
import {ReceiverTemplate} from "../src/cre/ReceiverTemplate.sol";
import {MockV3Aggregator} from "../src/MockV3Aggregator.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {TestToken} from "../src/TestToken.sol";

contract TervaneCoreTest is Base {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event EpochSettled(uint64 indexed epoch, bytes32 newRoot, uint64 inboxTo, uint64 asOf, int256 priceUsed);
    event Cleared(uint64 indexed epoch, uint8 indexed tenorId, uint32 rateBps, uint256 volume);
    event PayoutExecuted(uint64 indexed epoch, address indexed to, uint8 asset, uint256 requested, uint256 paid);
    event InboxMessage(uint64 indexed index, uint8 indexed kind, address indexed sender, uint8 asset, uint256 amount, bytes blob);

    function _blob() internal pure returns (bytes memory b) {
        b = new bytes(350);
        b[0] = 0x01;
    }

    // ── inbox ───────────────────────────────────────────────

    function test_depositPullsTokensAndAppends() public {
        usd.mint(alice, 100e6);
        vm.startPrank(alice);
        usd.approve(address(core), 100e6);
        vm.expectEmit(address(core));
        emit InboxMessage(1, 1, alice, 0, 100e6, "");
        core.deposit(0, 100e6);
        vm.stopPrank();
        assertEq(usd.balanceOf(address(core)), 100e6);
        assertEq(core.inboxCount(), 1);
    }

    function test_entryPointValidation() public {
        vm.startPrank(alice);
        vm.expectRevert(TervaneCore.InvalidAsset.selector);
        core.deposit(2, 1);
        vm.expectRevert(TervaneCore.ZeroAmount.selector);
        core.deposit(0, 0);
        vm.expectRevert(TervaneCore.InvalidAsset.selector);
        core.requestWithdraw(2, 1);
        vm.expectRevert(TervaneCore.ZeroAmount.selector);
        core.requestWithdraw(0, 0);
        vm.expectRevert(TervaneCore.InvalidBlob.selector);
        core.submitIntent(new bytes(349));
        bytes memory b = _blob();
        b[0] = 0x02;
        vm.expectRevert(TervaneCore.InvalidBlob.selector);
        core.submitIntent(b);
        core.submitIntent(_blob());
        core.requestWithdraw(1, 7);
        vm.stopPrank();
        assertEq(core.pendingWithdraw(alice, 1), 7);
        assertEq(core.inboxCount(), 2);
    }

    // ── report delivery ─────────────────────────────────────

    function test_onReportFromEOARevertsInvalidSender() public {
        bytes memory rep = _encode(_report(keccak256("r1")));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, alice, forwarder));
        core.onReport(new bytes(64), rep);
    }

    function test_happyPathSettlesPaysAndEmits() public {
        _deposit(alice, 0, 100e6);
        _deposit(bob, 1, 2e18);
        vm.prank(alice);
        core.requestWithdraw(0, 60e6);
        vm.prank(bob);
        core.requestWithdraw(1, 3e18);
        vm.warp(T0 + 30);

        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.clears = new TervaneCore.Clear[](1);
        r.clears[0] = TervaneCore.Clear(2, 527, 1000e6);
        r.payouts = new TervaneCore.Payout[](2);
        r.payouts[0] = TervaneCore.Payout(alice, 0, 60e6, 60e6);
        r.payouts[1] = TervaneCore.Payout(bob, 1, 3e18, 2e18); // ledger caps at free balance

        vm.expectEmit(address(core));
        emit EpochSettled(1, keccak256("r1"), 4, uint64(T0 + 30), 2500e8);
        vm.expectEmit(address(core));
        emit Cleared(1, 2, 527, 1000e6);
        vm.expectEmit(address(core));
        emit PayoutExecuted(1, alice, 0, 60e6, 60e6);
        _deliver(r);

        TervaneCore.SettlementState memory st = core.settlementState();
        assertEq(st.stateRoot, keccak256("r1"));
        assertEq(st.lastEpoch, 1);
        assertEq(st.cursor, 4);
        assertEq(st.lastAsOf, T0 + 30);
        assertEq(st.lastSettleAt, T0 + 30);
        assertEq(st.lastPriceRoundId, 1);
        assertEq(usd.balanceOf(alice), 60e6);
        assertEq(eth.balanceOf(bob), 2e18);
        assertEq(core.pendingWithdraw(alice, 0), 0);
        assertEq(core.pendingWithdraw(bob, 1), 0);
    }

    function test_emptyEpochWithNoMessages() public {
        _deliver(_report(keccak256("r1")));
        _deliver(_report(keccak256("r2")));
        assertEq(core.lastEpoch(), 2);
        assertEq(core.cursor(), 0);
    }

    // ── one test per §11 check ──────────────────────────────

    function test_check1_escaped() public {
        vm.warp(T0 + ESCAPE_DELAY + 1);
        core.activateEscape();
        bytes memory rep = _encode(_report(keccak256("r1")));
        vm.expectRevert(TervaneCore.Escaped.selector);
        _deliverRaw(rep);
    }

    function test_check2_reportVersion() public {
        bytes memory rep = abi.encode(uint8(2), _report(keccak256("r1")));
        vm.expectRevert(TervaneCore.BadReportVersion.selector);
        _deliverRaw(rep);
    }

    function test_check3_epoch() public {
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.epoch = 2;
        vm.expectRevert(abi.encodeWithSelector(TervaneCore.BadEpoch.selector, 1, 2));
        _deliver(r);
    }

    function test_check4_prevRoot() public {
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.prevRoot = keccak256("stale");
        vm.expectRevert(TervaneCore.RootMismatch.selector);
        _deliver(r);
    }

    function test_check5_inboxRange() public {
        _deposit(alice, 0, 1);
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.inboxTo = 2;
        vm.expectRevert(TervaneCore.InboxOutOfRange.selector);
        _deliver(r);
        _deliver(_report(keccak256("r1"))); // cursor = 1
        r = _report(keccak256("r2"));
        r.inboxTo = 0;
        r.inboxAccTo = bytes32(0);
        vm.expectRevert(TervaneCore.InboxOutOfRange.selector);
        _deliver(r);
    }

    function test_check5_inboxAcc() public {
        _deposit(alice, 0, 1);
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.inboxAccTo = keccak256("forged");
        vm.expectRevert(TervaneCore.InboxAccMismatch.selector);
        _deliver(r);
    }

    function test_check6_asOfRegressed() public {
        vm.warp(T0 + 100);
        _deliver(_report(keccak256("r1")));
        TervaneCore.SettlementReport memory r = _report(keccak256("r2"));
        r.asOf = uint64(T0 + 99);
        vm.expectRevert(TervaneCore.AsOfRegressed.selector);
        _deliver(r);
    }

    function test_check6_asOfSkew() public {
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.asOf = uint64(T0 + MAX_SKEW + 1);
        vm.expectRevert(TervaneCore.AsOfSkew.selector);
        _deliver(r);
        r.asOf = uint64(T0 - MAX_SKEW - 1);
        vm.expectRevert(TervaneCore.AsOfSkew.selector);
        _deliver(r);
        r.asOf = uint64(T0 + MAX_SKEW); // boundary passes
        _deliver(r);
    }

    function test_check7_priceRoundRegressed() public {
        feed.updateAnswer(2400e8); // round 2
        _deliver(_report(keccak256("r1")));
        TervaneCore.SettlementReport memory r = _report(keccak256("r2"));
        r.priceRoundId = 1;
        r.priceUsed = 2500e8;
        vm.expectRevert(TervaneCore.PriceRoundRegressed.selector);
        _deliver(r);
    }

    function test_check7_priceMismatch() public {
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.priceUsed = 2501e8;
        vm.expectRevert(TervaneCore.PriceMismatch.selector);
        _deliver(r);
        r.priceUsed = 2500e8;
        r.priceRoundId = 9; // unknown round
        vm.expectRevert(TervaneCore.PriceMismatch.selector);
        _deliver(r);
    }

    function test_check7_priceNonPositive() public {
        MockV3Aggregator bad = new MockV3Aggregator(8, 0);
        core.setPriceFeed(AggregatorV3Interface(address(bad)));
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.priceUsed = 0;
        vm.expectRevert(TervaneCore.PriceMismatch.selector);
        _deliver(r);
    }

    function test_check7_priceStale() public {
        vm.warp(T0 + MAX_PRICE_AGE + 1);
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        vm.expectRevert(TervaneCore.PriceStale.selector);
        _deliver(r);
    }

    function test_check8_tooManyPayouts() public {
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.payouts = new TervaneCore.Payout[](33);
        vm.expectRevert(TervaneCore.TooManyPayouts.selector);
        _deliver(r);
    }

    function test_check8_paidExceedsRequested() public {
        _deposit(alice, 0, 10e6);
        vm.prank(alice);
        core.requestWithdraw(0, 5e6);
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.payouts = new TervaneCore.Payout[](1);
        r.payouts[0] = TervaneCore.Payout(alice, 0, 5e6, 5e6 + 1);
        vm.expectRevert(TervaneCore.PayoutExceedsRequest.selector);
        _deliver(r);
    }

    function test_check8_requestExceedsPending() public {
        _deposit(alice, 0, 10e6);
        vm.prank(alice);
        core.requestWithdraw(0, 5e6);
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.payouts = new TervaneCore.Payout[](2);
        r.payouts[0] = TervaneCore.Payout(alice, 0, 3e6, 3e6);
        r.payouts[1] = TervaneCore.Payout(alice, 0, 3e6, 0); // cumulative 6 > 5 pending
        vm.expectRevert(TervaneCore.PayoutExceedsPending.selector);
        _deliver(r);
        // paying someone who never requested is impossible
        r.payouts = new TervaneCore.Payout[](1);
        r.payouts[0] = TervaneCore.Payout(bob, 0, 1, 1);
        vm.expectRevert(TervaneCore.PayoutExceedsPending.selector);
        _deliver(r);
    }

    function test_check8_invalidAsset() public {
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        r.payouts = new TervaneCore.Payout[](1);
        r.payouts[0] = TervaneCore.Payout(alice, 2, 0, 0);
        vm.expectRevert(TervaneCore.InvalidAsset.selector);
        _deliver(r);
    }

    function test_replayedReportReverts() public {
        TervaneCore.SettlementReport memory r = _report(keccak256("r1"));
        _deliver(r);
        vm.expectRevert(abi.encodeWithSelector(TervaneCore.BadEpoch.selector, 2, 1));
        _deliver(r);
    }

    // ── escape activation and post-escape lockout ───────────

    function test_escapeActivationTiming() public {
        vm.warp(T0 + ESCAPE_DELAY);
        vm.expectRevert(abi.encodeWithSelector(TervaneCore.EscapeTooEarly.selector, T0 + ESCAPE_DELAY));
        core.activateEscape();
        _deliver(_report(keccak256("r1"))); // settling resets the clock
        vm.warp(T0 + 2 * ESCAPE_DELAY);
        vm.expectRevert(abi.encodeWithSelector(TervaneCore.EscapeTooEarly.selector, T0 + 2 * ESCAPE_DELAY));
        core.activateEscape();
        vm.warp(T0 + 2 * ESCAPE_DELAY + 1);
        core.activateEscape();
        assertTrue(core.escaped());
        vm.expectRevert(TervaneCore.Escaped.selector);
        core.activateEscape();
    }

    function test_entryPointsLockedAfterEscape() public {
        vm.warp(T0 + ESCAPE_DELAY + 1);
        core.activateEscape();
        vm.startPrank(alice);
        vm.expectRevert(TervaneCore.Escaped.selector);
        core.deposit(0, 1);
        vm.expectRevert(TervaneCore.Escaped.selector);
        core.submitIntent(_blob());
        vm.expectRevert(TervaneCore.Escaped.selector);
        core.requestWithdraw(0, 1);
        vm.stopPrank();
    }

    // ── owner ───────────────────────────────────────────────

    function test_ownerSetters() public {
        bytes memory pk = abi.encodePacked(bytes1(0x02), keccak256("x"));
        core.setEnclavePubKey(pk);
        assertEq(core.enclavePubKey(), pk);
        vm.expectRevert(TervaneCore.InvalidPubKey.selector);
        core.setEnclavePubKey(abi.encodePacked(bytes1(0x04), keccak256("x")));
        vm.expectRevert(TervaneCore.InvalidPubKey.selector);
        core.setEnclavePubKey(new bytes(32));
        vm.expectRevert(TervaneCore.ZeroAddress.selector);
        core.setTreasury(address(0));
        core.setTreasury(bob);
        assertEq(core.treasury(), bob);

        vm.startPrank(alice);
        vm.expectRevert();
        core.setEnclavePubKey(pk);
        vm.expectRevert();
        core.setTreasury(alice);
        vm.expectRevert();
        core.setPriceFeed(AggregatorV3Interface(address(feed)));
        vm.expectRevert();
        core.setForwarderAddress(alice);
        vm.stopPrank();
    }

    function test_paramsView() public view {
        TervaneCore.Params memory p = core.params();
        assertEq(p.grace, GRACE);
        assertEq(p.escapeDelay, ESCAPE_DELAY);
        assertEq(p.maxSkew, MAX_SKEW);
        assertEq(p.maxPriceAge, MAX_PRICE_AGE);
    }

    // ── tokens / feed ───────────────────────────────────────

    function test_faucetRateLimited() public {
        vm.startPrank(alice);
        usd.faucet();
        vm.expectRevert(abi.encodeWithSelector(TestToken.FaucetCooldown.selector, T0 + 1 days));
        usd.faucet();
        vm.warp(T0 + 1 days);
        usd.faucet();
        vm.stopPrank();
        assertEq(usd.balanceOf(alice), 20_000e6);
        assertEq(usd.decimals(), 6);
        assertEq(eth.decimals(), 18);
    }

    function test_feedKeepsRoundHistory() public {
        vm.warp(T0 + 10);
        feed.updateAnswer(1800e8);
        (uint80 id, int256 a,,,) = feed.latestRoundData();
        assertEq(id, 2);
        assertEq(a, 1800e8);
        (, int256 old,, uint256 updatedAt,) = feed.getRoundData(1);
        assertEq(old, 2500e8);
        assertEq(updatedAt, T0);
        vm.expectRevert(MockV3Aggregator.NoDataPresent.selector);
        feed.getRoundData(3);
        vm.prank(alice);
        vm.expectRevert();
        feed.updateAnswer(1);
    }
}
