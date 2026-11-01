// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAllocXProjectRegistry, Project, ProjectCategory, ProjectStatus} from "./interfaces/IAllocX.sol";

/// @title AllocXProjectRegistry
/// @notice Curated project records. Submission and claimed ownership are not proofs of control.
contract AllocXProjectRegistry is AccessControl, IAllocXProjectRegistry {
    bytes32 public constant CURATOR_ROLE = keccak256("CURATOR_ROLE");
    uint256 public constant MAX_RELATED_CONTRACTS = 20;

    uint256 public override projectCount;
    mapping(uint256 => Project) private _projects;
    mapping(address => uint256) public override projectOfContract;
    mapping(uint256 => address[]) private _related;
    mapping(uint256 => string) public metadataURI;

    error ZeroAddress();
    error ProjectNotFound(uint256 projectId);
    error NotAContract(address target);
    error ContractAlreadyLinked(address target, uint256 projectId);
    error TooManyRelatedContracts();
    error InvalidStatus(uint256 projectId, ProjectStatus status);
    error NotProjectAdmin(uint256 projectId);

    event ProjectSubmitted(uint256 indexed id, address indexed submitter, address indexed mainContract,
        ProjectCategory category, address claimedOwner, bytes32 metadataHash, string metadataURI);
    event ContractLinked(uint256 indexed id, address indexed target);
    event ContractUnlinked(uint256 indexed id, address indexed target);
    event ProjectActivated(uint256 indexed projectId);
    event ProjectSuspended(uint256 indexed projectId);
    event ProjectRejected(uint256 indexed projectId);
    event ProjectReinstated(uint256 indexed projectId);
    event MetadataUpdated(uint256 indexed projectId, bytes32 metadataHash, string metadataURI);

    /// @param admin Initial default administrator; operational roles are granted separately.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Submit an unverified project for curator review. IDs start at one.
    function submitProject(ProjectCategory category, address mainContract, address claimedOwner,
        address[] calldata related, bytes32 metadataHash, string calldata uri) external returns (uint256 id)
    {
        if (related.length > MAX_RELATED_CONTRACTS) revert TooManyRelatedContracts();
        id = ++projectCount;
        _projects[id] = Project({submitter: msg.sender, mainContract: mainContract,
            claimedOwner: claimedOwner, verifiedOwner: address(0), category: category,
            status: ProjectStatus.Pending, metadataHash: metadataHash, createdAt: uint64(block.timestamp)});
        metadataURI[id] = uri;
        emit ProjectSubmitted(id, msg.sender, mainContract, category, claimedOwner, metadataHash, uri);
        _link(id, mainContract);
        for (uint256 i; i < related.length; ++i) {
            _link(id, related[i]);
            _related[id].push(related[i]);
        }
    }

    /// @notice Activate a pending project after curator review.
    function activateProject(uint256 id) external onlyRole(CURATOR_ROLE) {
        Project storage p = _project(id);
        if (p.status != ProjectStatus.Pending) revert InvalidStatus(id, p.status);
        p.status = ProjectStatus.Active;
        emit ProjectActivated(id);
    }

    /// @notice Suspend an active project without freeing its contract links.
    function suspendProject(uint256 id) external onlyRole(CURATOR_ROLE) {
        Project storage p = _project(id);
        if (p.status != ProjectStatus.Active) revert InvalidStatus(id, p.status);
        p.status = ProjectStatus.Suspended;
        emit ProjectSuspended(id);
    }

    /// @notice Permanently reject a record and free its main and related contract links.
    function rejectProject(uint256 id) external onlyRole(CURATOR_ROLE) {
        Project storage p = _project(id);
        if (p.status == ProjectStatus.Rejected) revert InvalidStatus(id, p.status);
        p.status = ProjectStatus.Rejected;
        delete projectOfContract[p.mainContract];
        emit ContractUnlinked(id, p.mainContract);
        address[] storage related = _related[id];
        for (uint256 i; i < related.length; ++i) {
            delete projectOfContract[related[i]];
            emit ContractUnlinked(id, related[i]);
        }
        emit ProjectRejected(id);
    }

    /// @notice Restore a suspended project to active status.
    function reinstate(uint256 id) external onlyRole(CURATOR_ROLE) {
        Project storage p = _project(id);
        if (p.status != ProjectStatus.Suspended) revert InvalidStatus(id, p.status);
        p.status = ProjectStatus.Active;
        emit ProjectReinstated(id);
    }

    /// @notice Return the live main-contract owner, or the submitter if no nonzero owner is available.
    function projectAdmin(uint256 id) public view override returns (address) {
        Project storage p = _project(id);
        address owner = _liveOwner(p.mainContract);
        return owner == address(0) ? p.submitter : owner;
    }

    /// @notice Update project metadata; ownership claims are not changed.
    function updateMetadata(uint256 id, bytes32 hash, string calldata uri) external {
        if (msg.sender != projectAdmin(id)) revert NotProjectAdmin(id);
        _projects[id].metadataHash = hash;
        metadataURI[id] = uri;
        emit MetadataUpdated(id, hash, uri);
    }

    /// @notice Link another contract, subject to the global uniqueness and project size limits.
    function addRelatedContract(uint256 id, address target) external {
        if (msg.sender != projectAdmin(id)) revert NotProjectAdmin(id);
        if (_projects[id].status == ProjectStatus.Rejected) revert InvalidStatus(id, ProjectStatus.Rejected);
        if (_related[id].length >= MAX_RELATED_CONTRACTS) revert TooManyRelatedContracts();
        _link(id, target);
        _related[id].push(target);
    }

    /// @notice Return an existing project's record with verifiedOwner computed from live ownership.
    /// @dev Non-Ownable or reverting main contracts report a zero verifiedOwner. Settlement events track history.
    function getProject(uint256 id) external view override returns (Project memory p) {
        p = _project(id);
        p.verifiedOwner = _liveOwner(p.mainContract);
    }

    /// @notice Whether a project is currently approved for trading.
    function isActive(uint256 id) external view override returns (bool) {
        return _projects[id].status == ProjectStatus.Active;
    }

    /// @notice Historical related-contract list, retained even after rejection.
    function relatedContracts(uint256 id) external view returns (address[] memory) {
        _project(id);
        return _related[id];
    }

    function _liveOwner(address target) private view returns (address) {
        try Ownable(target).owner() returns (address owner) {
            return owner;
        } catch { return address(0); }
    }

    function _project(uint256 id) private view returns (Project storage p) {
        p = _projects[id];
        if (p.status == ProjectStatus.None) revert ProjectNotFound(id);
    }

    function _link(uint256 id, address target) private {
        if (target.code.length == 0) revert NotAContract(target);
        uint256 previous = projectOfContract[target];
        if (previous != 0) revert ContractAlreadyLinked(target, previous);
        projectOfContract[target] = id;
        emit ContractLinked(id, target);
    }
}
