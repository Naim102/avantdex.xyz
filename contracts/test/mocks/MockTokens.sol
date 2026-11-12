// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @dev 6-decimal USDC stand-in with an open mint.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev USDC variant whose transfers revert when the sender or recipient is blocklisted (like real USDC).
contract BlocklistUSDC is MockUSDC {
    mapping(address => bool) public isBlocked;

    error Blocked(address account);

    function setBlocked(address account, bool blocked) external {
        isBlocked[account] = blocked;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (isBlocked[from]) revert Blocked(from);
        if (isBlocked[to]) revert Blocked(to);
        super._update(from, to, value);
    }
}

/// @dev Generic 18-decimal ERC-20 with an open mint.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev ERC-20 that burns 1% of every wallet-to-wallet transfer (delivers less than requested).
contract FeeOnTransferERC20 is ERC20 {
    constructor() ERC20("Taxed Token", "TAX") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 tax = value / 100;
            super._update(from, address(0), tax);
            super._update(from, to, value - tax);
        } else {
            super._update(from, to, value);
        }
    }
}

contract MockERC721 is ERC721 {
    constructor() ERC721("Mock NFT", "MNFT") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract MockERC1155 is ERC1155 {
    constructor() ERC1155("ipfs://mock/{id}") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }
}
