// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Vaulto testnet faucet token
/// @notice Test asset for the Vaulto demo. Only the faucet wallet can mint.
contract FaucetToken is ERC20 {
    uint8 private immutable _decimals;
    address public faucet;

    event FaucetTransferred(address indexed previousFaucet, address indexed newFaucet);
    event Claimed(address indexed to, uint256 amount);

    error NotFaucet();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address faucet_) ERC20(name_, symbol_) {
        _decimals = decimals_;
        faucet = faucet_;
    }

    modifier onlyFaucet() {
        if (msg.sender != faucet) revert NotFaucet();
        _;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mint test tokens to a wallet (faucet only).
    function mint(address to, uint256 amount) external onlyFaucet {
        _mint(to, amount);
        emit Claimed(to, amount);
    }

    function setFaucet(address newFaucet) external onlyFaucet {
        emit FaucetTransferred(faucet, newFaucet);
        faucet = newFaucet;
    }
}
