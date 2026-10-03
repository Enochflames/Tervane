// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./utils/Base.t.sol";
import {TervaneCore} from "../src/TervaneCore.sol";
import {TervaneLeaves} from "../src/lib/TervaneLeaves.sol";

/// @notice Escape hatch (PROTOCOL-SPEC §14) against the demo ledger committed by packages/core (escape.json).
contract EscapeTest is Base {
    string internal j;
    address internal ada;
    address internal bola;
    address internal chidi;
    address internal dayo;

    function setUp() public override {
        super.setUp();
        j = vm.readFile(string.concat(VEC, "escape.json"));
        for (uint256 i; i < 4; ++i) {
            string memory b = string.concat(".deposits[", vm.toString(i), "]");
            _deposit(vm.parseJsonAddress(j, string.concat(b, ".sender")), uint8(vm.parseJsonUint(j, string.concat(b, ".asset"))),
                vm.parseJsonUint(j, string.concat(b, ".amount")));
        }
        _deliver(_report(vm.parseJsonBytes32(j, ".root")));
        ada = _acct(0).addr;
        bola = _acct(1).addr;
        chidi = _acct(2).addr;
        dayo = _acct(3).addr;
    }

    function _acct(uint256 i) internal view returns (TervaneLeaves.Account memory a) {
        string memory b = string.concat(".accounts[", vm.toString(i), "].account");
        a.addr = vm.parseJsonAddress(j, string.concat(b, ".addr"));
        a.usdFree = vm.parseJsonUint(j, string.concat(b, ".usdFree"));
        a.usdReserved = vm.parseJsonUint(j, string.concat(b, ".usdReserved"));
        a.ethFree = vm.parseJsonUint(j, string.concat(b, ".ethFree"));
        a.ethReserved = vm.parseJsonUint(j, string.concat(b, ".ethReserved"));
        a.ethLocked = vm.parseJsonUint(j, string.concat(b, ".ethLocked"));
        a.tier = uint8(vm.parseJsonUint(j, string.concat(b, ".tier")));
        a.repaidVolume = vm.parseJsonUint(j, string.concat(b, ".repaidVolume"));
        a.nonce = uint64(vm.parseJsonUint(j, string.concat(b, ".nonce")));
    }

    function _acctProof(uint256 i) internal view returns (bytes32[] memory) {
        return vm.parseJsonBytes32Array(j, string.concat(".accounts[", vm.toString(i), "].proof"));
    }

    function _loan() internal view returns (TervaneLeaves.Loan memory l, TervaneLeaves.LenderShare[] memory s, bytes32[] memory proof) {
        string memory b = ".loans[0].loan";
        l.id = uint64(vm.parseJsonUint(j, string.concat(b, ".id")));
        l.borrower = vm.parseJsonAddress(j, string.concat(b, ".borrower"));
        l.tenorId = uint8(vm.parseJsonUint(j, string.concat(b, ".tenorId")));
        l.principal = vm.parseJsonUint(j, string.concat(b, ".principal"));
        l.rateBps = uint32(vm.parseJsonUint(j, string.concat(b, ".rateBps")));
        l.owed = vm.parseJsonUint(j, string.concat(b, ".owed"));
        l.collateral = vm.parseJsonUint(j, string.concat(b, ".collateral"));
        l.tierAtOpen = uint8(vm.parseJsonUint(j, string.concat(b, ".tierAtOpen")));
        l.openedAt = uint64(vm.parseJsonUint(j, string.concat(b, ".openedAt")));
        l.maturity = uint64(vm.parseJsonUint(j, string.concat(b, ".maturity")));
        l.lendersHash = vm.parseJsonBytes32(j, string.concat(b, ".lendersHash"));
        s = new TervaneLeaves.LenderShare[](2);
        for (uint256 i; i < 2; ++i) {
            string memory k = string.concat(".loans[0].lenders[", vm.toString(i), "]");
            s[i] = TervaneLeaves.LenderShare(vm.parseJsonAddress(j, string.concat(k, ".lender")), vm.parseJsonUint(j, string.concat(k, ".amount")));
        }
        proof = vm.parseJsonBytes32Array(j, ".loans[0].proof");
    }

    function _escape() internal {
        vm.warp(block.timestamp + ESCAPE_DELAY + 1);
        core.activateEscape();
    }

    // ── tests ───────────────────────────────────────────────

    function test_rootMatchesCoreAndLeavesVerify() public view {
        assertEq(core.stateRoot(), vm.parseJsonBytes32(j, ".root"));
        for (uint256 i; i < 4; ++i) {
            assertEq(TervaneLeaves.hashAccount(_acct(i)), vm.parseJsonBytes32(j, string.concat(".accounts[", vm.toString(i), "].leaf")));
            assertTrue(core.verifyAccount(_acct(i), _acctProof(i)), "credit attestation");
        }
        (TervaneLeaves.Loan memory l, TervaneLeaves.LenderShare[] memory s, bytes32[] memory proof) = _loan();
        assertEq(TervaneLeaves.lendersHash(s), l.lendersHash);
        assertTrue(core.verifyLoan(l, proof));
        TervaneLeaves.Account memory forged = _acct(3);
        forged.tier = 3;
        assertFalse(core.verifyAccount(forged, _acctProof(3)), "forged tier");
    }

    function test_exitRequiresEscapeOwnerAndValidProof() public {
        TervaneLeaves.Account memory a = _acct(1);
        vm.prank(bola);
        vm.expectRevert(TervaneCore.NotEscaped.selector);
        core.exitAccount(a, _acctProof(1));
        _escape();
        vm.prank(ada);
        vm.expectRevert(TervaneCore.NotAccountOwner.selector);
        core.exitAccount(a, _acctProof(1));
        TervaneLeaves.Account memory inflated = _acct(1);
        inflated.usdReserved += 1;
        vm.prank(bola);
        vm.expectRevert(TervaneCore.InvalidProof.selector);
        core.exitAccount(inflated, _acctProof(1));
        vm.prank(bola);
        core.exitAccount(a, _acctProof(1));
        assertEq(usd.balanceOf(bola), 200e6);
        vm.prank(bola);
        vm.expectRevert(TervaneCore.AlreadyExited.selector);
        core.exitAccount(a, _acctProof(1));
    }

    function test_fullEscapeWithRepayDrainsExactly() public {
        _escape();
        for (uint256 i; i < 4; ++i) {
            TervaneLeaves.Account memory a = _acct(i);
            vm.prank(a.addr);
            core.exitAccount(a, _acctProof(i));
        }
        (TervaneLeaves.Loan memory l, TervaneLeaves.LenderShare[] memory s, bytes32[] memory proof) = _loan();
        vm.prank(ada);
        vm.expectRevert(TervaneCore.NotBorrower.selector);
        core.escapeRepay(l, s, proof);

        usd.mint(dayo, l.owed - l.principal); // borrower covers interest on top of the borrowed tUSD
        vm.startPrank(dayo);
        usd.approve(address(core), l.owed);
        core.escapeRepay(l, s, proof);
        vm.stopPrank();
        assertEq(eth.balanceOf(dayo), 0.85e18);
        assertEq(core.claimUsd(ada), 600_000_602);
        assertEq(core.claimUsd(bola), 400_000_401);

        vm.expectRevert(TervaneCore.AlreadyResolved.selector);
        core.escapeLiquidate(l, s, proof);

        vm.prank(ada);
        core.claim();
        vm.prank(bola);
        core.claim();
        assertEq(usd.balanceOf(address(core)), 0, "usd drained exactly");
        assertEq(eth.balanceOf(address(core)), 0, "eth drained exactly");
    }

    function test_escapeLiquidateAfterCrashMatchesDemo() public {
        _escape();
        (TervaneLeaves.Loan memory l, TervaneLeaves.LenderShare[] memory s, bytes32[] memory proof) = _loan();
        vm.expectRevert(TervaneCore.NotLiquidatable.selector); // healthy at $2,500, before maturity + grace
        core.escapeLiquidate(l, s, proof);

        TervaneLeaves.LenderShare[] memory bad = new TervaneLeaves.LenderShare[](2);
        bad[0] = TervaneLeaves.LenderShare(s[0].lender, s[0].amount + 1);
        bad[1] = s[1];
        vm.expectRevert(TervaneCore.LendersMismatch.selector);
        core.escapeLiquidate(l, bad, proof);

        feed.updateAnswer(1800e8);
        core.escapeLiquidate(l, s, proof);
        // DEMO-SCRIPT §2 crash numbers
        assertEq(core.claimEth(ada), 348_333_682_711_666_668);
        assertEq(core.claimEth(bola), 232_222_455_141_111_111);
        assertEq(core.claimEth(treasury), 30_555_586_202_777_777);
        assertEq(core.claimEth(dayo), 238_888_275_944_444_444);

        for (uint256 i; i < 4; ++i) {
            TervaneLeaves.Account memory a = _acct(i);
            vm.prank(a.addr);
            core.exitAccount(a, _acctProof(i));
        }
        address[4] memory who = [ada, bola, dayo, treasury];
        for (uint256 i; i < 4; ++i) {
            vm.prank(who[i]);
            core.claim();
        }
        assertEq(usd.balanceOf(address(core)), 0, "usd drained exactly");
        assertEq(eth.balanceOf(address(core)), 0, "eth drained exactly");
    }

    function test_escapeLiquidateOnMaturity() public {
        (TervaneLeaves.Loan memory l, TervaneLeaves.LenderShare[] memory s, bytes32[] memory proof) = _loan();
        vm.warp(uint256(l.maturity) + GRACE + 1);
        feed.updateAnswer(2500e8); // keep the price fresh
        core.activateEscape();
        core.escapeLiquidate(l, s, proof);
        assertTrue(core.resolved(l.id));
    }

    function test_escapeLiquidateRejectsStalePrice() public {
        _escape();
        (TervaneLeaves.Loan memory l, TervaneLeaves.LenderShare[] memory s, bytes32[] memory proof) = _loan();
        vm.warp(block.timestamp + MAX_PRICE_AGE + 1);
        vm.expectRevert(TervaneCore.PriceStale.selector);
        core.escapeLiquidate(l, s, proof);
    }
}
