// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./utils/Base.t.sol";
import {TervaneCore} from "../src/TervaneCore.sol";

contract FuzzTest is Base {
    address[3] internal users = [address(0xA11CE), address(0xB0B), address(0xCA401)];

    /// Random payout arrays vs random pendingWithdraw: either the report reverts, or nobody is paid more than
    /// they requested, no request exceeds what was pending, and pendingWithdraw never underflows.
    function testFuzz_payoutsNeverExceedRequests(uint96[3] memory pend, uint96[8] memory req, uint96[8] memory paid, uint8 n) public {
        n = uint8(bound(n, 0, 8));
        for (uint256 u; u < 3; ++u) {
            uint256 p = bound(pend[u], 1, 1e30);
            _deposit(users[u], 0, p);
            vm.prank(users[u]);
            core.requestWithdraw(0, p);
        }
        TervaneCore.SettlementReport memory r = _report(keccak256("r"));
        r.payouts = new TervaneCore.Payout[](n);
        uint256[3] memory sumReq;
        uint256[3] memory sumPaid;
        bool valid = true;
        for (uint256 k; k < n; ++k) {
            uint256 u = k % 3;
            r.payouts[k] = TervaneCore.Payout(users[u], 0, req[k], paid[k]);
            sumReq[u] += req[k];
            sumPaid[u] += paid[k];
            if (paid[k] > req[k] || sumReq[u] > core.pendingWithdraw(users[u], 0)) valid = false;
        }
        uint256[3] memory before;
        for (uint256 u; u < 3; ++u) before[u] = core.pendingWithdraw(users[u], 0);
        if (!valid) {
            vm.expectRevert();
            _deliver(r);
            return;
        }
        _deliver(r);
        for (uint256 u; u < 3; ++u) {
            assertEq(core.pendingWithdraw(users[u], 0), before[u] - sumReq[u]);
            assertEq(usd.balanceOf(users[u]), sumPaid[u]);
            assertLe(sumPaid[u], sumReq[u]);
        }
    }

    /// The skew window is |asOf − block.timestamp| ≤ MAX_SKEW, inclusive.
    function testFuzz_skewWindow(uint32 tsOffset, int32 skew) public {
        vm.warp(T0 + uint256(tsOffset) % 1e8);
        feed.updateAnswer(2500e8); // keep the price round fresh after the warp
        TervaneCore.SettlementReport memory r = _report(keccak256("r"));
        int256 a = int256(block.timestamp) + int256(skew);
        vm.assume(a >= 0);
        r.asOf = uint64(uint256(a));
        uint256 d = skew < 0 ? uint256(-int256(skew)) : uint256(int256(skew));
        if (d > MAX_SKEW) {
            vm.expectRevert(TervaneCore.AsOfSkew.selector);
            _deliver(r);
        } else {
            _deliver(r);
            assertEq(core.lastAsOf(), r.asOf);
        }
    }
}
