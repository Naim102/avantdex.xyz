// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IAllocXVerification, IAllocXProjectRegistry, Project, ProjectStatus, VerificationMethod,
    OwnershipAttestation, SaleAuthorization} from "./interfaces/IAllocX.sol";

/// @dev Minimal read-only Ownable surface; nonconforming contracts fail closed.
interface IAllocXOwnerProbe {
    function owner() external view returns (address);
}

/// @title AllocXVerification
/// @notice Live control proofs, role-authorized attestations and stateless seller-authorization validation.
/// @dev Enumerable AccessControl identifies ERC-1271 attestors because the shared attestation
///      contains no signer field. Signatures are tested against current ATTESTOR_ROLE members.
contract AllocXVerification is AccessControlEnumerable, EIP712, IAllocXVerification {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");
    bytes32 public constant OWNERSHIP_ATTESTATION_TYPEHASH = keccak256(
        "OwnershipAttestation(uint256 projectId,address subject,bytes32 claimHash,uint64 expiry,uint256 nonce)"
    );
    bytes32 public constant SALE_AUTHORIZATION_TYPEHASH = keccak256(
        "SaleAuthorization(uint256 orderId,address seller,address buyer,bytes32 itemsHash,uint256 price,address settlement,uint256 nonce,uint64 deadline)"
    );

    struct ProjectVerification {
        address subject;
        VerificationMethod method;
        uint64 verifiedAt;
    }

    IAllocXProjectRegistry public immutable registry;
    mapping(uint256 => ProjectVerification) private _verifications;
    mapping(uint256 => mapping(address => uint64)) public attestations;
    mapping(address => mapping(uint256 => bool)) public usedAttestationNonces;

    error ZeroAddress();
    error NotAContract(address target);
    error ProjectNotFound(uint256 projectId);
    error NotController();
    error AttestationExpired();
    error AuthorizationExpired();
    error InvalidSignature();
    error NonceAlreadyUsed(address signer, uint256 nonce);

    event ProjectControlVerified(uint256 indexed projectId, address indexed subject,
        VerificationMethod method, uint64 verifiedAt);
    event AttestationSubmitted(uint256 indexed projectId, address indexed subject, address indexed signer,
        bytes32 claimHash, uint64 expiry, uint256 nonce);

    /// @param admin Initial default administrator; operational roles are granted separately.
    /// @param registry_ The shared project registry used to locate main contracts.
    constructor(address admin, address registry_) EIP712("AllocXVerification", "1") {
        if (admin == address(0) || registry_ == address(0)) revert ZeroAddress();
        if (registry_.code.length == 0) revert NotAContract(registry_);
        registry = IAllocXProjectRegistry(registry_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Anyone may record a subject's live main-contract ownership or default-admin control.
    function verifyProjectControl(uint256 projectId, address subject) external {
        Project memory p = _getProject(projectId);
        VerificationMethod method = _controlMethod(p.mainContract, subject);
        if (method == VerificationMethod.None) revert NotController();
        uint64 verifiedAt = uint64(block.timestamp);
        _verifications[projectId] = ProjectVerification(subject, method, verifiedAt);
        emit ProjectControlVerified(projectId, subject, method, verifiedAt);
    }

    /// @notice Relay an EIP-712 attestation by a current EOA or ERC-1271 attestor.
    /// @dev Attestation nonces are local; Settlement tracks seller-authorization nonces separately.
    ///      Keep the attestor set small enough for enumeration within a transaction's gas limit.
    function submitAttestation(OwnershipAttestation calldata att, bytes calldata sig) external {
        _getProject(att.projectId);
        if (att.subject == address(0)) revert ZeroAddress();
        if (att.expiry <= block.timestamp) revert AttestationExpired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(OWNERSHIP_ATTESTATION_TYPEHASH,
            att.projectId, att.subject, att.claimHash, att.expiry, att.nonce)));
        address signer;
        uint256 count = getRoleMemberCount(ATTESTOR_ROLE);
        for (uint256 i; i < count; ++i) {
            address candidate = getRoleMember(ATTESTOR_ROLE, i);
            if (SignatureChecker.isValidSignatureNow(candidate, digest, sig)) {
                signer = candidate;
                break;
            }
        }
        if (signer == address(0)) revert InvalidSignature();
        if (usedAttestationNonces[signer][att.nonce]) revert NonceAlreadyUsed(signer, att.nonce);
        usedAttestationNonces[signer][att.nonce] = true;
        attestations[att.projectId][att.subject] = att.expiry;
        emit AttestationSubmitted(att.projectId, att.subject, signer, att.claimHash, att.expiry, att.nonce);
    }

    /// @notice Whether an accepted attestation remains unexpired.
    function hasValidAttestation(uint256 projectId, address subject) public view returns (bool) {
        return attestations[projectId][subject] > block.timestamp;
    }

    /// @notice Return the latest recorded onchain control proof, if any.
    function verificationOf(uint256 projectId) external view returns (ProjectVerification memory) {
        return _verifications[projectId];
    }

    /// @notice A stored control proof must still pass a live check; attestations expire independently.
    function isVerified(uint256 projectId, address subject) external view returns (bool) {
        ProjectVerification memory v = _verifications[projectId];
        return hasValidAttestation(projectId, subject)
            || (v.subject == subject && v.method != VerificationMethod.None && currentControl(projectId, subject));
    }

    /// @notice Check live control. Unknown projects and nonconforming targets return false.
    function currentControl(uint256 projectId, address subject) public view returns (bool) {
        try registry.getProject(projectId) returns (Project memory p) {
            return p.status != ProjectStatus.None
                && _controlMethod(p.mainContract, subject) != VerificationMethod.None;
        } catch {
            return false;
        }
    }

    /// @notice Validate a seller signature and deadline without changing state.
    /// @dev Settlement binds the authorization to an order and enforces nonce replay protection.
    function verifySaleAuthorization(SaleAuthorization calldata auth, bytes calldata sig)
        external view override
    {
        if (block.timestamp > auth.deadline) revert AuthorizationExpired();
        if (auth.seller == address(0)
            || !SignatureChecker.isValidSignatureNow(auth.seller, saleAuthorizationDigest(auth), sig)) {
            revert InvalidSignature();
        }
    }

    /// @notice EIP-712 digest accepted by verifySaleAuthorization.
    function saleAuthorizationDigest(SaleAuthorization calldata auth) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(SALE_AUTHORIZATION_TYPEHASH, auth.orderId,
            auth.seller, auth.buyer, auth.itemsHash, auth.price, auth.settlement, auth.nonce, auth.deadline)));
    }

    /// @notice Chain- and contract-bound EIP-712 domain separator.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _getProject(uint256 projectId) private view returns (Project memory p) {
        p = registry.getProject(projectId);
        if (p.status == ProjectStatus.None) revert ProjectNotFound(projectId);
    }

    function _controlMethod(address target, address subject) private view returns (VerificationMethod) {
        if (subject == address(0) || target.code.length == 0) return VerificationMethod.None;
        try IAllocXOwnerProbe(target).owner() returns (address owner) {
            if (owner == subject) return VerificationMethod.Ownable;
        } catch {}
        try IAccessControl(target).hasRole(bytes32(0), subject) returns (bool holdsRole) {
            if (holdsRole) return VerificationMethod.AccessControl;
        } catch {}
        return VerificationMethod.None;
    }
}
