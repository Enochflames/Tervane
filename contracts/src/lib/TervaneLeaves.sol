// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title TervaneLeaves — inbox hashing (PROTOCOL-SPEC §4) and Merkle leaf encodings (§7.2).
/// @dev Identical to packages/core/src/abi.ts; parity tested against inbox.json and leaves.json.
///      Leaves use the OpenZeppelin double-hash convention: keccak(bytes.concat(keccak(abi.encode(...)))).
library TervaneLeaves {
    struct Account {
        address addr;
        uint256 usdFree;
        uint256 usdReserved;
        uint256 ethFree;
        uint256 ethReserved;
        uint256 ethLocked;
        uint8 tier;
        uint256 repaidVolume;
        uint64 nonce;
    }

    struct Order {
        uint64 id;
        address owner;
        uint8 side;
        uint8 tenorId;
        uint256 remaining;
        uint256 collateral;
        uint64 expiresAtEpoch;
        bytes32 blobHash;
    }

    struct LenderShare {
        address lender;
        uint256 amount;
    }

    /// @dev Onchain form of a loan leaf: the lender list is committed as `lendersHash` (§7.2).
    struct Loan {
        uint64 id;
        address borrower;
        uint8 tenorId;
        uint256 principal;
        uint32 rateBps;
        uint256 owed;
        uint256 collateral;
        uint8 tierAtOpen;
        uint64 openedAt;
        uint64 maturity;
        bytes32 lendersHash;
    }

    // ── §4 inbox ────────────────────────────────────────────

    function msgHash(uint64 index, uint8 kind, address sender, uint8 asset, uint256 amount, bytes32 blobHash)
        internal pure returns (bytes32)
    {
        return keccak256(abi.encode(index, kind, sender, asset, amount, blobHash));
    }

    function accStep(bytes32 prevAcc, bytes32 mHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(prevAcc, mHash));
    }

    // ── §7.2 leaves ─────────────────────────────────────────

    function _leaf(bytes memory inner) private pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(inner)));
    }

    function hashMeta(uint64 epoch, uint64 cursor, uint64 nextLoanId) internal pure returns (bytes32) {
        return _leaf(abi.encode(uint8(0), epoch, cursor, nextLoanId));
    }

    function hashAccount(Account memory a) internal pure returns (bytes32) {
        return _leaf(abi.encode(
            uint8(1), a.addr, a.usdFree, a.usdReserved, a.ethFree, a.ethReserved, a.ethLocked, a.tier, a.repaidVolume, a.nonce
        ));
    }

    function hashOrder(Order memory o) internal pure returns (bytes32) {
        return _leaf(abi.encode(
            uint8(2), o.id, o.owner, o.side, o.tenorId, o.remaining, o.collateral, o.expiresAtEpoch, o.blobHash
        ));
    }

    function hashLoan(Loan memory l) internal pure returns (bytes32) {
        // Two-step encode keeps the stack shallow without via-IR; the bytes equal one 12-field abi.encode.
        bytes memory head = abi.encode(uint8(3), l.id, l.borrower, l.tenorId, l.principal, l.rateBps);
        bytes memory tail = abi.encode(l.owed, l.collateral, l.tierAtOpen, l.openedAt, l.maturity, l.lendersHash);
        return _leaf(bytes.concat(head, tail));
    }

    function lendersHash(LenderShare[] memory s) internal pure returns (bytes32) {
        return keccak256(abi.encode(s));
    }
}
