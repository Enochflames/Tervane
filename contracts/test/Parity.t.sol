// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Base} from "./utils/Base.t.sol";
import {TervaneCore} from "../src/TervaneCore.sol";
import {TervaneLeaves} from "../src/lib/TervaneLeaves.sol";
import {TervaneMath} from "../src/lib/TervaneMath.sol";

/// @notice TS ↔ Solidity parity against packages/core/test/vectors (PROTOCOL-SPEC §15).
contract ParityTest is Base {
    using TervaneLeaves for *;

    function _j(string memory file) internal view returns (string memory) {
        return vm.readFile(string.concat(VEC, file));
    }

    function _k(string memory a, uint256 i, string memory b) internal pure returns (string memory) {
        return string.concat(a, "[", vm.toString(i), "]", b);
    }

    function test_genesisRootIsMetaLeaf() public view {
        assertEq(TervaneLeaves.hashMeta(0, 0, 1), genesisRoot);
        assertEq(core.stateRoot(), genesisRoot);
    }

    function test_inbox() public view {
        string memory j = _j("inbox.json");
        bytes32 acc = vm.parseJsonBytes32(j, ".acc0");
        for (uint256 i; i < 5; ++i) {
            bytes32 h = TervaneLeaves.msgHash(
                uint64(vm.parseJsonUint(j, _k(".messages", i, ".index"))),
                uint8(vm.parseJsonUint(j, _k(".messages", i, ".kind"))),
                vm.parseJsonAddress(j, _k(".messages", i, ".sender")),
                uint8(vm.parseJsonUint(j, _k(".messages", i, ".asset"))),
                vm.parseJsonUint(j, _k(".messages", i, ".amount")),
                vm.parseJsonBytes32(j, _k(".messages", i, ".blobHash"))
            );
            assertEq(h, vm.parseJsonBytes32(j, _k(".messages", i, ".msgHash")), "msgHash");
            acc = TervaneLeaves.accStep(acc, h);
            assertEq(acc, vm.parseJsonBytes32(j, _k(".messages", i, ".acc")), "acc");
        }
    }

    /// _append (deposit / submitIntent / requestWithdraw) produces the same accumulator as the spec formula.
    function test_appendMatchesSpecHashing() public {
        string memory e = _j("ecies.json");
        bytes memory blob = vm.parseJsonBytes(e, ".blob");
        address sender = vm.parseJsonAddress(e, ".sender");
        _deposit(sender, 0, 600e6);
        vm.prank(sender);
        core.submitIntent(blob);
        vm.prank(sender);
        core.requestWithdraw(1, 5);
        bytes32 acc;
        acc = TervaneLeaves.accStep(acc, TervaneLeaves.msgHash(1, 1, sender, 0, 600e6, bytes32(0)));
        acc = TervaneLeaves.accStep(acc, TervaneLeaves.msgHash(2, 2, sender, 0, 0, vm.parseJsonBytes32(e, ".blobHash")));
        acc = TervaneLeaves.accStep(acc, TervaneLeaves.msgHash(3, 3, sender, 1, 5, bytes32(0)));
        assertEq(core.inboxCount(), 3);
        assertEq(core.inboxAcc(3), acc);
        assertEq(keccak256(blob), vm.parseJsonBytes32(e, ".blobHash"));
    }

    function test_leaves() public view {
        string memory j = _j("leaves.json");
        assertEq(
            TervaneLeaves.hashMeta(
                uint64(vm.parseJsonUint(j, ".meta.value.epoch")),
                uint64(vm.parseJsonUint(j, ".meta.value.cursor")),
                uint64(vm.parseJsonUint(j, ".meta.value.nextLoanId"))
            ),
            vm.parseJsonBytes32(j, ".meta.leaf")
        );

        TervaneLeaves.Account memory a = TervaneLeaves.Account({
            addr: vm.parseJsonAddress(j, ".account.value.addr"),
            usdFree: vm.parseJsonUint(j, ".account.value.usdFree"),
            usdReserved: vm.parseJsonUint(j, ".account.value.usdReserved"),
            ethFree: vm.parseJsonUint(j, ".account.value.ethFree"),
            ethReserved: vm.parseJsonUint(j, ".account.value.ethReserved"),
            ethLocked: vm.parseJsonUint(j, ".account.value.ethLocked"),
            tier: uint8(vm.parseJsonUint(j, ".account.value.tier")),
            repaidVolume: vm.parseJsonUint(j, ".account.value.repaidVolume"),
            nonce: uint64(vm.parseJsonUint(j, ".account.value.nonce"))
        });
        assertEq(TervaneLeaves.hashAccount(a), vm.parseJsonBytes32(j, ".account.leaf"));

        TervaneLeaves.Order memory o = TervaneLeaves.Order({
            id: uint64(vm.parseJsonUint(j, ".order.value.id")),
            owner: vm.parseJsonAddress(j, ".order.value.owner"),
            side: uint8(vm.parseJsonUint(j, ".order.value.side")),
            tenorId: uint8(vm.parseJsonUint(j, ".order.value.tenorId")),
            remaining: vm.parseJsonUint(j, ".order.value.remaining"),
            collateral: vm.parseJsonUint(j, ".order.value.collateral"),
            expiresAtEpoch: uint64(vm.parseJsonUint(j, ".order.value.expiresAtEpoch")),
            blobHash: vm.parseJsonBytes32(j, ".order.value.blobHash")
        });
        assertEq(TervaneLeaves.hashOrder(o), vm.parseJsonBytes32(j, ".order.leaf"));

        TervaneLeaves.LenderShare[] memory s = new TervaneLeaves.LenderShare[](3);
        for (uint256 i; i < 3; ++i) {
            s[i] = TervaneLeaves.LenderShare(
                vm.parseJsonAddress(j, _k(".lenders3.value", i, ".lender")), vm.parseJsonUint(j, _k(".lenders3.value", i, ".amount"))
            );
        }
        bytes32 lh = TervaneLeaves.lendersHash(s);
        assertEq(lh, vm.parseJsonBytes32(j, ".lenders3.lendersHash"));

        TervaneLeaves.Loan memory l = TervaneLeaves.Loan({
            id: uint64(vm.parseJsonUint(j, ".loan.value.id")),
            borrower: vm.parseJsonAddress(j, ".loan.value.borrower"),
            tenorId: uint8(vm.parseJsonUint(j, ".loan.value.tenorId")),
            principal: vm.parseJsonUint(j, ".loan.value.principal"),
            rateBps: uint32(vm.parseJsonUint(j, ".loan.value.rateBps")),
            owed: vm.parseJsonUint(j, ".loan.value.owed"),
            collateral: vm.parseJsonUint(j, ".loan.value.collateral"),
            tierAtOpen: uint8(vm.parseJsonUint(j, ".loan.value.tierAtOpen")),
            openedAt: uint64(vm.parseJsonUint(j, ".loan.value.openedAt")),
            maturity: uint64(vm.parseJsonUint(j, ".loan.value.maturity")),
            lendersHash: lh
        });
        assertEq(TervaneLeaves.hashLoan(l), vm.parseJsonBytes32(j, ".loan.leaf"));
    }

    function test_treeProofsVerifyWithOZ() public view {
        string memory j = _j("tree.json");
        uint256[5] memory ns = [uint256(1), 2, 3, 7, 8];
        for (uint256 t; t < 5; ++t) {
            string memory base = string.concat(".trees[", vm.toString(t), "]");
            bytes32 root = vm.parseJsonBytes32(j, string.concat(base, ".root"));
            for (uint256 i; i < ns[t]; ++i) {
                bytes32 leaf = vm.parseJsonBytes32(j, _k(string.concat(base, ".proofs"), i, ".leaf"));
                bytes32[] memory proof = vm.parseJsonBytes32Array(j, _k(string.concat(base, ".proofs"), i, ".proof"));
                assertTrue(MerkleProof.verify(proof, root, leaf), "proof");
                assertFalse(MerkleProof.verify(proof, root, keccak256(abi.encode(leaf))), "forged leaf");
            }
        }
    }

    function test_liquidationAndSplit() public view {
        string memory j = _j("liquidation.json");
        for (uint256 c; c < 4; ++c) {
            string memory b = string.concat(".cases[", vm.toString(c), "]");
            uint256 owed = vm.parseJsonUint(j, string.concat(b, ".loan.owed"));
            uint256 coll = vm.parseJsonUint(j, string.concat(b, ".loan.collateral"));
            uint256 price = vm.parseJsonUint(j, string.concat(b, ".price"));
            bool liq = TervaneMath.isLiquidatable(
                coll, owed, uint8(vm.parseJsonUint(j, string.concat(b, ".loan.tierAtOpen"))),
                uint64(vm.parseJsonUint(j, string.concat(b, ".loan.maturity"))), price,
                vm.parseJsonUint(j, string.concat(b, ".asOf")), vm.parseJsonUint(j, string.concat(b, ".grace"))
            );
            assertEq(liq, vm.parseJsonBool(j, string.concat(b, ".liquidatable")), "liquidatable");
            (uint256 seized, uint256 fee, uint256 pot, uint256 returned) = TervaneMath.liquidationAmounts(owed, coll, price);
            assertEq(seized, vm.parseJsonUint(j, string.concat(b, ".seized")), "seized");
            assertEq(fee, vm.parseJsonUint(j, string.concat(b, ".fee")), "fee");
            assertEq(pot, vm.parseJsonUint(j, string.concat(b, ".pot")), "pot");
            assertEq(returned, vm.parseJsonUint(j, string.concat(b, ".returned")), "returned");
            address[] memory addrs = new address[](2);
            uint256[] memory w = new uint256[](2);
            for (uint256 i; i < 2; ++i) {
                addrs[i] = vm.parseJsonAddress(j, _k(string.concat(b, ".loan.lenders"), i, ".lender"));
                w[i] = vm.parseJsonUint(j, _k(string.concat(b, ".loan.lenders"), i, ".amount"));
            }
            uint256[] memory out = TervaneMath.split(pot, addrs, w);
            for (uint256 i; i < 2; ++i) assertEq(out[i], vm.parseJsonUint(j, _k(string.concat(b, ".lenderPayouts"), i, ".amount")));
        }
        uint256[3] memory sizes = [uint256(2), 3, 2];
        for (uint256 k; k < 3; ++k) {
            string memory b = string.concat(".splits[", vm.toString(k), "]");
            address[] memory addrs = new address[](sizes[k]);
            uint256[] memory w = new uint256[](sizes[k]);
            for (uint256 i; i < sizes[k]; ++i) {
                addrs[i] = vm.parseJsonAddress(j, _k(string.concat(b, ".shares"), i, ".addr"));
                w[i] = vm.parseJsonUint(j, _k(string.concat(b, ".shares"), i, ".weight"));
            }
            uint256[] memory out = TervaneMath.split(vm.parseJsonUint(j, string.concat(b, ".total")), addrs, w);
            for (uint256 i; i < sizes[k]; ++i) assertEq(out[i], vm.parseJsonUint(j, _k(string.concat(b, ".amounts"), i, "")));
        }
    }

    function test_reportDecodes() public view {
        string memory j = _j("report.json");
        (uint8 v, TervaneCore.SettlementReport memory r) =
            abi.decode(vm.parseJsonBytes(j, ".encoded"), (uint8, TervaneCore.SettlementReport));
        assertEq(v, 1);
        assertEq(r.epoch, vm.parseJsonUint(j, ".report.epoch"));
        assertEq(r.prevRoot, vm.parseJsonBytes32(j, ".report.prevRoot"));
        assertEq(r.newRoot, vm.parseJsonBytes32(j, ".report.newRoot"));
        assertEq(r.inboxTo, vm.parseJsonUint(j, ".report.inboxTo"));
        assertEq(r.inboxAccTo, vm.parseJsonBytes32(j, ".report.inboxAccTo"));
        assertEq(r.asOf, vm.parseJsonUint(j, ".report.asOf"));
        assertEq(r.priceRoundId, vm.parseJsonUint(j, ".report.priceRoundId"));
        assertEq(uint256(r.priceUsed), vm.parseJsonUint(j, ".report.priceUsed"));
        assertEq(r.clears.length, 2);
        for (uint256 i; i < 2; ++i) {
            assertEq(r.clears[i].tenorId, vm.parseJsonUint(j, _k(".report.clears", i, ".tenorId")));
            assertEq(r.clears[i].rateBps, vm.parseJsonUint(j, _k(".report.clears", i, ".rateBps")));
            assertEq(r.clears[i].volume, vm.parseJsonUint(j, _k(".report.clears", i, ".volume")));
        }
        assertEq(r.payouts.length, 2);
        for (uint256 i; i < 2; ++i) {
            assertEq(r.payouts[i].to, vm.parseJsonAddress(j, _k(".report.payouts", i, ".to")));
            assertEq(r.payouts[i].asset, vm.parseJsonUint(j, _k(".report.payouts", i, ".asset")));
            assertEq(r.payouts[i].requested, vm.parseJsonUint(j, _k(".report.payouts", i, ".requested")));
            assertEq(r.payouts[i].paid, vm.parseJsonUint(j, _k(".report.payouts", i, ".paid")));
        }
        // and re-encoding gives the exact TS bytes
        assertEq(abi.encode(uint8(1), r), vm.parseJsonBytes(j, ".encoded"));
    }
}
