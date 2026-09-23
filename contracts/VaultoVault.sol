// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/// @title Vaulto testnet mirror of an IXS RWA vault
/// @notice Plain ERC-4626 vault used on testnet so the full approve -> deposit -> shares flow is a real
///         on-chain transaction. Mirrors the interface IXS Agent Rail builds calldata for (sync settlement).
contract VaultoVault is ERC4626 {
    string public strategyId;

    constructor(IERC20 asset_, string memory name_, string memory symbol_, string memory strategyId_)
        ERC20(name_, symbol_)
        ERC4626(asset_)
    {
        strategyId = strategyId_;
    }

    /// @dev Never paused; kept for interface parity with the IXS vault reads.
    function paused() external pure returns (bool) {
        return false;
    }

    function availableAssets() external view returns (uint256) {
        return totalAssets();
    }
}
