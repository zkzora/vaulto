import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

/** ERC-4626 plus the ERC-7540 and IXS vault extensions Vaulto reads (all calls are optional via allowFailure). */
export const erc4626Abi = parseAbi([
  "function asset() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function paused() view returns (bool)",
  "function whitelistEnabled() view returns (bool)",
  "function whitelist(address account) view returns (bool)",
  "function feeBps() view returns (uint256)",
  "function redeemFeeBps() view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function requestDeposit(uint256 assets, address controller, address owner) returns (uint256 requestId)",
  "function pendingDepositRequest(uint256 requestId, address controller) view returns (uint256 pendingAssets)",
  "function claimableDepositRequest(uint256 requestId, address controller) view returns (uint256 claimableAssets)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
]);

/** Custom errors decoded from simulation reverts (OpenZeppelin ERC-4626 / ERC-20 / Pausable + IXS whitelist). */
export const vaultErrorsAbi = parseAbi([
  "error ERC4626ExceededMaxDeposit(address receiver, uint256 assets, uint256 max)",
  "error ERC4626ExceededMaxMint(address receiver, uint256 shares, uint256 max)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error EnforcedPause()",
  "error NotWhitelisted(address account)",
  "error OwnableUnauthorizedAccount(address account)",
]);
