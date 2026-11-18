// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Test stand-in for a smart-contract wallet such as a Circle Wallet: an ERC-1271 account owned by one key.
contract MockSmartAccount {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        return err == ECDSA.RecoverError.NoError && signer == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

/// @dev Deploys MockSmartAccount at a deterministic address, so a signature can be produced before the account exists
/// (the ERC-6492 case: a new Circle Wallet is only deployed with its first transaction).
contract MockAccountFactory {
    function createAccount(address owner, bytes32 salt) external returns (address account) {
        account = accountFor(owner, salt);
        if (account.code.length == 0) {
            account = address(new MockSmartAccount{salt: salt}(owner));
        }
    }

    function accountFor(address owner, bytes32 salt) public view returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(
                bytes1(0xff), address(this), salt, keccak256(abi.encodePacked(type(MockSmartAccount).creationCode, abi.encode(owner)))
            )
        );
        return address(uint160(uint256(h)));
    }
}
