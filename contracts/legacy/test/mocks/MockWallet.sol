// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Minimal ERC-1271 smart wallet: valid iff the signature is an ECDSA signature by `owner`.
///      Can execute arbitrary calls for its owner (approvals, listing creation).
contract MockWallet {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(hash, sig);
        if (err == ECDSA.RecoverError.NoError && rec == owner) return 0x1626ba7e;
        return 0xffffffff;
    }

    function execute(address target, bytes calldata data) external returns (bytes memory ret) {
        require(msg.sender == owner, "not owner");
        bool ok;
        (ok, ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }
}
