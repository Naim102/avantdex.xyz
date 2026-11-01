// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAllocXAdapter} from "../../interfaces/IAllocX.sol";

/// @dev Single-step Ownable control target.
contract MockOwnable is Ownable {
    constructor(address initialOwner) Ownable(initialOwner) {}
}

/// @dev Two-step Ownable control target (new owner must acceptOwnership()).
contract MockOwnable2Step is Ownable2Step {
    constructor(address initialOwner) Ownable(initialOwner) {}
}

/// @dev AccessControl target with a custom OPERATOR_ROLE; `admin` holds DEFAULT_ADMIN_ROLE and OPERATOR_ROLE.
contract MockAccessControl is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }
}

/// @dev Project specific read-only adapter. Controllers are freely settable by tests.
contract MockAdapter is IAllocXAdapter {
    mapping(bytes32 => address) public controllerOf;
    mapping(bytes32 => address) public pendingOf;

    function _key(address target, uint256 id, bytes32 extra) private pure returns (bytes32) {
        return keccak256(abi.encode(target, id, extra));
    }

    function setController(address target, uint256 id, bytes32 extra, address account) external {
        controllerOf[_key(target, id, extra)] = account;
    }

    function setPending(address target, uint256 id, bytes32 extra, address account) external {
        pendingOf[_key(target, id, extra)] = account;
    }

    function isController(address target, uint256 id, bytes32 extra, address account) external view returns (bool) {
        return account != address(0) && controllerOf[_key(target, id, extra)] == account;
    }

    function isPendingController(address target, uint256 id, bytes32 extra, address account)
        external
        view
        returns (bool)
    {
        return account != address(0) && pendingOf[_key(target, id, extra)] == account;
    }

    function describe() external pure returns (string memory) {
        return "MockAdapter";
    }
}

/// @dev A contract that reverts on every call (cleanly non-conforming).
contract RevertingTarget {
    fallback() external {
        revert("nope");
    }
}

/// @dev A contract that accepts every call and returns nothing (e.g. a proxy-like or permissive fallback).
contract PermissiveTarget {
    fallback() external payable {}
}

/// @dev A contract that answers every call with a single junk byte (malformed returndata).
contract GarbageTarget {
    fallback() external {
        assembly {
            mstore(0, 0x01)
            return(31, 1)
        }
    }
}
