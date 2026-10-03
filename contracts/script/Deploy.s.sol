// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TervaneCore} from "../src/TervaneCore.sol";
import {TestToken} from "../src/TestToken.sol";
import {MockV3Aggregator} from "../src/MockV3Aggregator.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

/// @notice CONTRACTS.md §6 deploy for Monad testnet with the CRE simulation (mock) forwarder.
/// Env: DEPLOYER_PK (0x-prefixed), TERVANE_ENCLAVE_SK (0x-prefixed). Neither is logged; only the
/// derived public key is written. Writes ../deployments/monad-testnet.json.
contract Deploy is Script {
    /// MockKeystoneForwarder for monad-testnet (spike S7: `cre workflow supported-chains` mockAddress).
    address constant MOCK_FORWARDER = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;

    // Demo params, PROTOCOL-SPEC §2
    uint64 constant GRACE = 60;
    uint64 constant ESCAPE_DELAY = 600;
    uint64 constant MAX_SKEW = 120;
    uint64 constant MAX_PRICE_AGE = 86_400;

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        bytes memory enclavePubKey = _compressedPubKey(vm.envUint("TERVANE_ENCLAVE_SK"));
        bytes32 genesisRoot = vm.parseJsonBytes32(vm.readFile("../packages/core/test/vectors/genesis.json"), ".root");
        uint256 deployBlock = block.number;

        vm.startBroadcast(deployerPk);
        TestToken usd = new TestToken("Tervane USD", "tUSD", 6, 10_000e6, 1 days);
        TestToken eth = new TestToken("Tervane ETH", "tETH", 18, 10e18, 1 days);
        MockV3Aggregator feed = new MockV3Aggregator(8, 2500e8);
        TervaneCore core = new TervaneCore(
            MOCK_FORWARDER, IERC20(address(usd)), IERC20(address(eth)), AggregatorV3Interface(address(feed)),
            deployer, // treasury: the deployer EOA for the demo
            genesisRoot, GRACE, ESCAPE_DELAY, MAX_SKEW, MAX_PRICE_AGE
        );
        core.setEnclavePubKey(enclavePubKey);
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeString(o, "chainName", "monad-testnet");
        vm.serializeUint(o, "deployBlock", deployBlock);
        vm.serializeAddress(o, "forwarder", MOCK_FORWARDER);
        vm.serializeAddress(o, "owner", deployer);
        vm.serializeAddress(o, "treasury", deployer);
        vm.serializeAddress(o, "tervaneCore", address(core));
        vm.serializeAddress(o, "usdToken", address(usd));
        vm.serializeAddress(o, "ethToken", address(eth));
        vm.serializeAddress(o, "priceFeed", address(feed));
        vm.serializeBytes32(o, "genesisRoot", genesisRoot);
        vm.serializeBytes(o, "enclavePubKey", enclavePubKey);
        vm.serializeUint(o, "grace", GRACE);
        vm.serializeUint(o, "escapeDelay", ESCAPE_DELAY);
        vm.serializeUint(o, "maxSkew", MAX_SKEW);
        string memory json = vm.serializeUint(o, "maxPriceAge", MAX_PRICE_AGE);
        vm.writeJson(json, "../deployments/monad-testnet.json");

        console.log("TervaneCore", address(core));
        console.log("tUSD", address(usd));
        console.log("tETH", address(eth));
        console.log("feed", address(feed));
    }

    /// 33-byte compressed secp256k1 public key (0x02/0x03 ‖ X).
    function _compressedPubKey(uint256 sk) internal returns (bytes memory) {
        Vm.Wallet memory w = vm.createWallet(sk);
        return abi.encodePacked(w.publicKeyY % 2 == 0 ? bytes1(0x02) : bytes1(0x03), bytes32(w.publicKeyX));
    }
}

import {Vm} from "forge-std/Vm.sol";
