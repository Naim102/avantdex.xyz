// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAllocXAdapterRegistry} from "./interfaces/IAllocX.sol";

/// @title AllocXAdapterRegistry
/// @notice Administrator-approved read-only adapters, scoped to a particular target.
contract AllocXAdapterRegistry is AccessControl, IAllocXAdapterRegistry {
    bytes32 public constant ADAPTER_ADMIN_ROLE = keccak256("ADAPTER_ADMIN_ROLE");

    mapping(address => mapping(address => bool)) private _approved;
    mapping(address => string) public adapterDescription;

    error ZeroAddress();
    error NotAContract(address adapter);
    error ArrayLengthMismatch();

    event AdapterApproved(address indexed adapter, address indexed target, string description);
    event AdapterRevoked(address indexed adapter, address indexed target);

    /// @param admin Initial default administrator; adapter administrators are granted separately.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Approve an adapter only for the supplied target and store its latest description.
    function approveAdapter(address adapter, address target, string calldata description)
        external onlyRole(ADAPTER_ADMIN_ROLE)
    {
        _approveAdapter(adapter, target, description);
    }

    /// @notice Revoke one target permission without changing permissions for other targets.
    function revokeAdapter(address adapter, address target) external onlyRole(ADAPTER_ADMIN_ROLE) {
        _approved[adapter][target] = false;
        emit AdapterRevoked(adapter, target);
    }

    /// @notice Atomically approve parallel arrays of adapters, targets and descriptions.
    function approveAdapterBatch(address[] calldata adapters, address[] calldata targets,
        string[] calldata descriptions) external onlyRole(ADAPTER_ADMIN_ROLE)
    {
        if (adapters.length != targets.length || adapters.length != descriptions.length) {
            revert ArrayLengthMismatch();
        }
        for (uint256 i; i < adapters.length; ++i) {
            _approveAdapter(adapters[i], targets[i], descriptions[i]);
        }
    }

    /// @notice Whether this exact adapter/target pair is approved; there are no wildcard targets.
    function isApproved(address adapter, address target) external view override returns (bool) {
        return _approved[adapter][target];
    }

    function _approveAdapter(address adapter, address target, string memory description) private {
        if (adapter.code.length == 0) revert NotAContract(adapter);
        if (target == address(0)) revert ZeroAddress();
        _approved[adapter][target] = true;
        adapterDescription[adapter] = description;
        emit AdapterApproved(adapter, target, description);
    }
}
