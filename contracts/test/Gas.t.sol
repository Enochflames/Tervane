// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/console.sol";
import {Base} from "./utils/Base.t.sol";
import {TervaneCore} from "../src/TervaneCore.sol";

/// @notice Gas for user calls and _processReport under the Monad gas model (foundry.toml network = "monad").
///         Feed the 32-payout/3-clear figure (+ forwarder overhead + intrinsic, +20%) into config.writeGasLimit.
contract GasTest is Base {
    function _blob() internal pure returns (bytes memory b) {
        b = new bytes(350);
        b[0] = 0x01;
    }

    function test_gas_userCalls() public {
        address a = makeAddr("a");
        usd.mint(a, 2e6);
        vm.startPrank(a);
        usd.approve(address(core), 2e6);
        uint256 g = gasleft();
        core.deposit(0, 1e6);
        console.log("deposit (first)", g - gasleft());
        g = gasleft();
        core.deposit(0, 1e6);
        console.log("deposit (warm user)", g - gasleft());
        g = gasleft();
        core.submitIntent(_blob());
        console.log("submitIntent", g - gasleft());
        g = gasleft();
        core.requestWithdraw(0, 1e6);
        console.log("requestWithdraw", g - gasleft());
        vm.stopPrank();
    }

    function _settleGas(uint256 nPayouts, uint256 nClears) internal returns (uint256 used) {
        for (uint256 k; k < nPayouts; ++k) {
            address u = address(uint160(0x10000 + k));
            uint8 asset = uint8(k % 2);
            _deposit(u, asset, 1e18);
            vm.prank(u);
            core.requestWithdraw(asset, 1e18);
        }
        vm.warp(block.timestamp + 30);
        TervaneCore.SettlementReport memory r = _report(keccak256("gas"));
        r.clears = new TervaneCore.Clear[](nClears);
        for (uint256 c; c < nClears; ++c) r.clears[c] = TervaneCore.Clear(uint8(c), 500, 1000e6);
        r.payouts = new TervaneCore.Payout[](nPayouts);
        for (uint256 k; k < nPayouts; ++k) r.payouts[k] = TervaneCore.Payout(address(uint160(0x10000 + k)), uint8(k % 2), 1e18, 1e18);
        bytes memory rep = _encode(r);
        vm.prank(forwarder);
        uint256 g = gasleft();
        core.onReport(new bytes(64), rep);
        used = g - gasleft();
        console.log(string.concat("processReport payouts=", vm.toString(nPayouts), " clears=", vm.toString(nClears),
            " gas=", vm.toString(used), " reportBytes=", vm.toString(rep.length)));
    }

    function test_gas_report_0_0() public { _settleGas(0, 0); }
    function test_gas_report_0_3() public { _settleGas(0, 3); }
    function test_gas_report_8_0() public { _settleGas(8, 0); }
    function test_gas_report_8_3() public { _settleGas(8, 3); }
    function test_gas_report_32_3() public { _settleGas(32, 3); }
}
