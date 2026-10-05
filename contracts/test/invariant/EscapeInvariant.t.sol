// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {Base} from "../utils/Base.t.sol";
import {TervaneCore} from "../../src/TervaneCore.sol";
import {TestToken} from "../../src/TestToken.sol";
import {MockV3Aggregator} from "../../src/MockV3Aggregator.sol";
import {TervaneLeaves} from "../../src/lib/TervaneLeaves.sol";

/// Random post-escape activity over the two-loan ledger committed by packages/core (escape2.json).
contract EscapeHandler is Test {
    TervaneCore internal core;
    TestToken internal usd;
    TestToken internal eth;
    MockV3Aggregator internal feed;
    address internal forwarder;

    TervaneLeaves.Account[] internal accts;
    bytes32[][] internal acctProofs;
    TervaneLeaves.Loan[] internal loans;
    TervaneLeaves.LenderShare[][] internal shares;
    bytes32[][] internal loanProofs;

    mapping(address => uint256) public exitCount;
    mapping(uint64 => uint256) public resolveCount;
    uint256 public settledAfterEscape;
    uint256[2] public inflow;   // usd, eth into core (escape repays)
    uint256[2] public outflow;  // usd, eth out of core (exits, repay collateral, claims)
    uint256 public exits;
    uint256 public repays;
    uint256 public liquidations;
    uint256 public claims;

    constructor(TervaneCore c, TestToken u, TestToken e, MockV3Aggregator f, address fwd, string memory j) {
        (core, usd, eth, feed, forwarder) = (c, u, e, f, fwd);
        for (uint256 i; i < 4; ++i) {
            string memory b = string.concat(".accounts[", vm.toString(i), "]");
            TervaneLeaves.Account memory a;
            a.addr = vm.parseJsonAddress(j, string.concat(b, ".account.addr"));
            a.usdFree = vm.parseJsonUint(j, string.concat(b, ".account.usdFree"));
            a.usdReserved = vm.parseJsonUint(j, string.concat(b, ".account.usdReserved"));
            a.ethFree = vm.parseJsonUint(j, string.concat(b, ".account.ethFree"));
            a.ethReserved = vm.parseJsonUint(j, string.concat(b, ".account.ethReserved"));
            a.ethLocked = vm.parseJsonUint(j, string.concat(b, ".account.ethLocked"));
            a.tier = uint8(vm.parseJsonUint(j, string.concat(b, ".account.tier")));
            a.repaidVolume = vm.parseJsonUint(j, string.concat(b, ".account.repaidVolume"));
            a.nonce = uint64(vm.parseJsonUint(j, string.concat(b, ".account.nonce")));
            accts.push(a);
            acctProofs.push(vm.parseJsonBytes32Array(j, string.concat(b, ".proof")));
        }
        for (uint256 i; i < 2; ++i) {
            string memory b = string.concat(".loans[", vm.toString(i), "]");
            TervaneLeaves.Loan memory l;
            l.id = uint64(vm.parseJsonUint(j, string.concat(b, ".loan.id")));
            l.borrower = vm.parseJsonAddress(j, string.concat(b, ".loan.borrower"));
            l.tenorId = uint8(vm.parseJsonUint(j, string.concat(b, ".loan.tenorId")));
            l.principal = vm.parseJsonUint(j, string.concat(b, ".loan.principal"));
            l.rateBps = uint32(vm.parseJsonUint(j, string.concat(b, ".loan.rateBps")));
            l.owed = vm.parseJsonUint(j, string.concat(b, ".loan.owed"));
            l.collateral = vm.parseJsonUint(j, string.concat(b, ".loan.collateral"));
            l.tierAtOpen = uint8(vm.parseJsonUint(j, string.concat(b, ".loan.tierAtOpen")));
            l.openedAt = uint64(vm.parseJsonUint(j, string.concat(b, ".loan.openedAt")));
            l.maturity = uint64(vm.parseJsonUint(j, string.concat(b, ".loan.maturity")));
            l.lendersHash = vm.parseJsonBytes32(j, string.concat(b, ".loan.lendersHash"));
            loans.push(l);
            loanProofs.push(vm.parseJsonBytes32Array(j, string.concat(b, ".proof")));
        }
        // lenders: loan 0 has one share, loan 1 has two (escape2.json)
        uint256[2] memory counts = [uint256(1), 2];
        for (uint256 i; i < 2; ++i) {
            shares.push();
            for (uint256 k; k < counts[i]; ++k) {
                string memory b = string.concat(".loans[", vm.toString(i), "].lenders[", vm.toString(k), "]");
                shares[i].push(TervaneLeaves.LenderShare(vm.parseJsonAddress(j, string.concat(b, ".lender")), vm.parseJsonUint(j, string.concat(b, ".amount"))));
            }
        }
    }

    function accountCount() external view returns (uint256) { return accts.length; }
    function account(uint256 i) external view returns (TervaneLeaves.Account memory) { return accts[i]; }
    function loan(uint256 i) external view returns (TervaneLeaves.Loan memory) { return loans[i]; }

    function exit(uint256 seed) external {
        TervaneLeaves.Account memory a = accts[seed % accts.length];
        vm.prank(a.addr);
        try core.exitAccount(a, acctProofs[seed % accts.length]) {
            exitCount[a.addr]++;
            exits++;
            outflow[0] += a.usdFree + a.usdReserved;
            outflow[1] += a.ethFree + a.ethReserved;
        } catch {}
    }

    function repay(uint256 seed) external {
        uint256 i = seed % loans.length;
        TervaneLeaves.Loan memory l = loans[i];
        usd.mint(l.borrower, l.owed);
        vm.startPrank(l.borrower);
        usd.approve(address(core), l.owed);
        try core.escapeRepay(l, shares[i], loanProofs[i]) {
            resolveCount[l.id]++;
            repays++;
            inflow[0] += l.owed;
            outflow[1] += l.collateral;
        } catch {}
        vm.stopPrank();
    }

    function liquidate(uint256 seed, uint256 priceSeed, address liquidator) external {
        uint256 i = seed % loans.length;
        feed.updateAnswer(int256(bound(priceSeed, 500, 3000)) * 1e8);
        vm.prank(liquidator);
        try core.escapeLiquidate(loans[i], shares[i], loanProofs[i]) {
            resolveCount[loans[i].id]++;
            liquidations++;
        } catch {}
    }

    function claim(uint256 seed) external {
        address who = seed % 5 == 4 ? core.treasury() : accts[seed % accts.length].addr;
        uint256 u = core.claimUsd(who);
        uint256 e = core.claimEth(who);
        vm.prank(who);
        core.claim();
        outflow[0] += u;
        outflow[1] += e;
        if (u + e > 0) claims++;
    }

    function trySettle(uint256 seed) external {
        TervaneCore.SettlementReport memory r;
        r.epoch = core.lastEpoch() + 1;
        r.prevRoot = core.stateRoot();
        r.newRoot = keccak256(abi.encode(seed));
        r.inboxTo = core.inboxCount();
        r.inboxAccTo = core.inboxAcc(r.inboxTo);
        r.asOf = uint64(block.timestamp);
        r.priceRoundId = feed.latestRound();
        (, r.priceUsed,,,) = feed.latestRoundData();
        vm.prank(forwarder);
        try core.onReport(new bytes(64), abi.encode(uint8(1), r)) { settledAfterEscape++; } catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 3 days));
    }
}

contract EscapeInvariantTest is Base {
    EscapeHandler internal h;
    uint256[2] internal deposited;

    function setUp() public override {
        super.setUp();
        string memory j = vm.readFile(string.concat(VEC, "escape2.json"));
        for (uint256 i; i < 4; ++i) {
            string memory b = string.concat(".deposits[", vm.toString(i), "]");
            uint8 asset = uint8(vm.parseJsonUint(j, string.concat(b, ".asset")));
            uint256 amt = vm.parseJsonUint(j, string.concat(b, ".amount"));
            _deposit(vm.parseJsonAddress(j, string.concat(b, ".sender")), asset, amt);
            deposited[asset] += amt;
        }
        _deliver(_report(vm.parseJsonBytes32(j, ".root")));
        vm.warp(block.timestamp + ESCAPE_DELAY + 1);
        core.activateEscape();

        h = new EscapeHandler(core, usd, eth, feed, forwarder, j);
        usd.transferOwnership(address(h));
        feed.transferOwnership(address(h));
        targetContract(address(h));
    }

    /// Exact solvency: what the contract holds equals what it still owes, per asset.
    function invariant_exactSolvency() public view {
        uint256 owedUsd;
        uint256 owedEth;
        for (uint256 i; i < h.accountCount(); ++i) {
            TervaneLeaves.Account memory a = h.account(i);
            if (!core.exited(a.addr)) {
                owedUsd += a.usdFree + a.usdReserved;
                owedEth += a.ethFree + a.ethReserved;
            }
            owedUsd += core.claimUsd(a.addr);
            owedEth += core.claimEth(a.addr);
        }
        owedUsd += core.claimUsd(treasury);
        owedEth += core.claimEth(treasury);
        for (uint256 i; i < 2; ++i) {
            TervaneLeaves.Loan memory l = h.loan(i);
            if (!core.resolved(l.id)) owedEth += l.collateral;
        }
        assertEq(usd.balanceOf(address(core)), owedUsd, "usd solvency");
        assertEq(eth.balanceOf(address(core)), owedEth, "eth solvency");
    }

    /// Conservation: balance == deposits + escape inflows − every outflow.
    function invariant_conservation() public view {
        assertEq(usd.balanceOf(address(core)), deposited[0] + h.inflow(0) - h.outflow(0), "usd conservation");
        assertEq(eth.balanceOf(address(core)), deposited[1] + h.inflow(1) - h.outflow(1), "eth conservation");
    }

    function invariant_atMostOnce() public view {
        for (uint256 i; i < h.accountCount(); ++i) assertLe(h.exitCount(h.account(i).addr), 1, "double exit");
        for (uint256 i; i < 2; ++i) assertLe(h.resolveCount(h.loan(i).id), 1, "double resolve");
    }

    /// Proves the fuzzer reaches the interesting states rather than reverting everywhere.
    function afterInvariant() public view {
        console.log("exits %s repays %s liquidations %s", h.exits(), h.repays(), h.liquidations());
        console.log("claims %s", h.claims());
    }

    /// Gate 7 shape: everyone exits, Dayo repays, Chidi's loan is liquidated at $1,500, all claim. Nothing is left.
    function test_fullUnwindDrainsToZero() public {
        for (uint256 i; i < 4; ++i) h.exit(i);
        h.repay(1);
        vm.warp(block.timestamp + 1 days);
        h.liquidate(0, 1500, makeAddr("keeper"));
        for (uint256 i; i < 5; ++i) h.claim(i);
        assertEq(h.exits(), 4);
        assertEq(h.repays(), 1);
        assertEq(h.liquidations(), 1);
        assertEq(usd.balanceOf(address(core)), 0, "usd left");
        assertEq(eth.balanceOf(address(core)), 0, "eth left");
        assertEq(eth.balanceOf(makeAddr("keeper")), 0, "keeper is unpaid in escape");
    }

    function invariant_noSettlementAfterEscape() public view {
        assertEq(h.settledAfterEscape(), 0);
        assertTrue(core.escaped());
    }
}
