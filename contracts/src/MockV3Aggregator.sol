// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @title MockV3Aggregator — AggregatorV3-compatible demo feed with full round history (D-8).
/// @dev Rounds start at 1. getRoundData works for every past round so TervaneCore can verify the
///      exact round the enclave priced against (PROTOCOL-SPEC §11 check 7).
contract MockV3Aggregator is AggregatorV3Interface, Ownable {
    struct Round { int256 answer; uint256 startedAt; uint256 updatedAt; }

    uint8 public immutable override decimals;
    uint80 public latestRound;
    mapping(uint80 => Round) private _rounds;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    error NoDataPresent();

    constructor(uint8 decimals_, int256 initialAnswer) Ownable(msg.sender) {
        decimals = decimals_;
        _push(initialAnswer);
    }

    function updateAnswer(int256 answer) external onlyOwner {
        _push(answer);
    }

    function _push(int256 answer) private {
        uint80 id = ++latestRound;
        _rounds[id] = Round(answer, block.timestamp, block.timestamp);
        emit AnswerUpdated(answer, id, block.timestamp);
    }

    function description() external pure override returns (string memory) {
        return "Tervane mock ETH / USD";
    }

    function version() external pure override returns (uint256) {
        return 4;
    }

    function getRoundData(uint80 roundId) public view override returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[roundId];
        if (r.updatedAt == 0) revert NoDataPresent();
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return getRoundData(latestRound);
    }
}
