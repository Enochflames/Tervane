// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title TervaneMath — protocol constants and math, identical to packages/core/src/{params,math}.ts.
/// @dev PROTOCOL-SPEC §1 (rounding, split), §2 (constants), §9 (interest), §10 (tiers, value, liquidation).
///      Owed amounts round up; paid/credited amounts round down. Parity is tested against liquidation.json.
library TervaneMath {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 31_536_000;
    uint256 internal constant LIQ_PENALTY_BPS = 1_000;
    uint256 internal constant LIQ_FEE_BPS = 500;
    uint256 internal constant VALUE_SCALE = 1e20;

    error UnknownTier(uint8 tier);
    error EmptySplit();

    function ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    function openRatioBps(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return 20_000;
        if (tier == 1) return 18_000;
        if (tier == 2) return 15_000;
        if (tier == 3) return 13_000;
        revert UnknownTier(tier);
    }

    function liqRatioBps(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return 16_000;
        if (tier == 1) return 14_500;
        if (tier == 2) return 12_500;
        if (tier == 3) return 11_500;
        revert UnknownTier(tier);
    }

    function minRepaid(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return 0;
        if (tier == 1) return 1_000e6;
        if (tier == 2) return 5_000e6;
        if (tier == 3) return 20_000e6;
        revert UnknownTier(tier);
    }

    function interest(uint256 principal, uint256 rateBps, uint256 tenorSecs) internal pure returns (uint256) {
        return ceilDiv(principal * rateBps * tenorSecs, BPS * YEAR);
    }

    /// @notice Conservative USD (6 dp) value of tETH wei at an 8-dp price, rounded down (§10.2).
    function valueUsd(uint256 collWei, uint256 price) internal pure returns (uint256) {
        return collWei * price / VALUE_SCALE;
    }

    function isLiquidatable(
        uint256 collateral, uint256 owed, uint8 tierAtOpen, uint64 maturity,
        uint256 price, uint256 asOf, uint256 grace
    ) internal pure returns (bool) {
        return valueUsd(collateral, price) * BPS < owed * liqRatioBps(tierAtOpen) || asOf > uint256(maturity) + grace;
    }

    /// @notice §10.4: seize at most owed × 1.10 worth of collateral; 5% fee; the rest of seized to lenders.
    function liquidationAmounts(uint256 owed, uint256 collateral, uint256 price)
        internal pure returns (uint256 seized, uint256 fee, uint256 pot, uint256 returned)
    {
        uint256 seizeCap = ceilDiv(owed * (BPS + LIQ_PENALTY_BPS) * VALUE_SCALE, BPS * price);
        seized = collateral < seizeCap ? collateral : seizeCap;
        fee = seized * LIQ_FEE_BPS / BPS;
        pot = seized - fee;
        returned = collateral - seized;
    }

    /// @notice §1 split: every share floors; the remainder goes to the largest weight, ties to the lowest address.
    function split(uint256 total, address[] memory addrs, uint256[] memory weights)
        internal pure returns (uint256[] memory out)
    {
        uint256 n = weights.length;
        if (n == 0 || addrs.length != n) revert EmptySplit();
        uint256 sum;
        for (uint256 i; i < n; ++i) sum += weights[i];
        if (sum == 0) revert EmptySplit();
        out = new uint256[](n);
        uint256 dust = total;
        uint256 best;
        for (uint256 i; i < n; ++i) {
            out[i] = total * weights[i] / sum;
            dust -= out[i];
            if (i > 0 && (weights[i] > weights[best] || (weights[i] == weights[best] && addrs[i] < addrs[best]))) best = i;
        }
        out[best] += dust;
    }
}
