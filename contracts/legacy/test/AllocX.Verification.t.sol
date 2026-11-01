// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AllocX.Base.t.sol";
import "./mocks/MockWallet.sol";

/// @dev Unit tests for AllocXVerification (control proofs, attestations, sale-authorization validation).
contract AllocXVerificationTest is AllocXTestBase {
    address internal attestor;
    uint256 internal attestorPk;

    function setUp() public override {
        super.setUp();
        (attestor, attestorPk) = makeAddrAndKey("attestor");
        vm.prank(admin);
        verification.grantRole(ATTESTOR_ROLE, attestor);
    }

    // ----------------------------------------------------- helpers
    function _attDigest(OwnershipAttestation memory a) internal view returns (bytes32) {
        bytes32 th = keccak256(
            "OwnershipAttestation(uint256 projectId,address subject,bytes32 claimHash,uint64 expiry,uint256 nonce)"
        );
        bytes32 sh = keccak256(abi.encode(th, a.projectId, a.subject, a.claimHash, a.expiry, a.nonce));
        return keccak256(abi.encodePacked("\x19\x01", verification.DOMAIN_SEPARATOR(), sh));
    }

    function _attSign(uint256 pk, OwnershipAttestation memory a) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _attDigest(a));
        return abi.encodePacked(r, s, v);
    }

    function _att(uint256 nonce, uint64 expiry) internal view returns (OwnershipAttestation memory) {
        return OwnershipAttestation(projectId, stranger, bytes32("claim"), expiry, nonce);
    }

    // ------------------------------------------------ verifyProjectControl
    function test_VerifyControl_OwnableOwner() public {
        vm.expectEmit(true, true, false, true, address(verification));
        emit AllocXVerification.ProjectControlVerified(
            projectId, seller, VerificationMethod.Ownable, uint64(block.timestamp)
        );
        verification.verifyProjectControl(projectId, seller);
        AllocXVerification.ProjectVerification memory v = verification.verificationOf(projectId);
        assertEq(v.subject, seller);
        assertEq(uint8(v.method), uint8(VerificationMethod.Ownable));
        assertEq(v.verifiedAt, block.timestamp);
        assertTrue(verification.isVerified(projectId, seller));
        assertTrue(verification.currentControl(projectId, seller));
    }

    function test_VerifyControl_AccessControlDefaultAdmin() public {
        address alice = makeAddr("alice");
        MockAccessControl main_ = new MockAccessControl(alice);
        vm.prank(alice);
        uint256 id = registry.submitProject(
            ProjectCategory.AdminRole, address(main_), alice, new address[](0), 0, ""
        );
        verification.verifyProjectControl(id, alice);
        assertEq(uint8(verification.verificationOf(id).method), uint8(VerificationMethod.AccessControl));
    }

    function test_VerifyControl_RevertsForNonController() public {
        vm.expectRevert(AllocXVerification.NotController.selector);
        verification.verifyProjectControl(projectId, stranger);
        vm.expectRevert(AllocXVerification.NotController.selector);
        verification.verifyProjectControl(projectId, address(0));
    }

    function test_VerifyControl_RevertsForUnknownProject() public {
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.ProjectNotFound.selector, 999));
        verification.verifyProjectControl(999, seller);
    }

    function test_VerifyControl_AnyoneCanRelay() public {
        vm.prank(stranger);
        verification.verifyProjectControl(projectId, seller);
        assertEq(verification.verificationOf(projectId).subject, seller);
    }

    function test_IsVerified_BecomesFalseAfterControlLost() public {
        verification.verifyProjectControl(projectId, seller);
        vm.prank(seller);
        ownable.transferOwnership(buyer);
        assertFalse(verification.currentControl(projectId, seller));
        assertFalse(verification.isVerified(projectId, seller), "stored proof must be re-checked live");
        assertTrue(verification.currentControl(projectId, buyer));
        // buyer was never recorded, so not "verified" until verifyProjectControl is called
        assertFalse(verification.isVerified(projectId, buyer));
    }

    function test_CurrentControl_FalseForUnknownProjectAndNonControllers() public view {
        assertFalse(verification.currentControl(999, seller));
        assertFalse(verification.currentControl(projectId, stranger));
        assertFalse(verification.isVerified(projectId, stranger));
    }

    // -------------------------------------------------------- attestations
    function test_Attestation_HappyPath() public {
        OwnershipAttestation memory a = _att(1, uint64(block.timestamp + 1 days));
        bytes memory sig = _attSign(attestorPk, a);
        vm.expectEmit(true, true, true, true, address(verification));
        emit AllocXVerification.AttestationSubmitted(projectId, stranger, attestor, a.claimHash, a.expiry, 1);
        vm.prank(relayer);
        verification.submitAttestation(a, sig);
        assertTrue(verification.hasValidAttestation(projectId, stranger));
        assertTrue(verification.isVerified(projectId, stranger));
        assertEq(verification.attestations(projectId, stranger), a.expiry);
        assertTrue(verification.usedAttestationNonces(attestor, 1));
    }

    function test_Attestation_ExpiresOverTime() public {
        OwnershipAttestation memory a = _att(1, uint64(block.timestamp + 1 days));
        verification.submitAttestation(a, _attSign(attestorPk, a));
        vm.warp(a.expiry - 1);
        assertTrue(verification.hasValidAttestation(projectId, stranger));
        vm.warp(a.expiry);
        assertFalse(verification.hasValidAttestation(projectId, stranger));
        assertFalse(verification.isVerified(projectId, stranger));
    }

    function test_Attestation_RevertsWhenAlreadyExpired() public {
        OwnershipAttestation memory a = _att(1, uint64(block.timestamp));
        bytes memory sig = _attSign(attestorPk, a);
        vm.expectRevert(AllocXVerification.AttestationExpired.selector);
        verification.submitAttestation(a, sig);
    }

    function test_Attestation_ReplayedNonceReverts() public {
        OwnershipAttestation memory a = _att(5, uint64(block.timestamp + 1 days));
        bytes memory sig = _attSign(attestorPk, a);
        verification.submitAttestation(a, sig);
        vm.expectRevert(abi.encodeWithSelector(AllocXVerification.NonceAlreadyUsed.selector, attestor, 5));
        verification.submitAttestation(a, sig);
    }

    function test_Attestation_RevertsForNonAttestorSigner() public {
        (, uint256 otherPk) = makeAddrAndKey("rogue");
        OwnershipAttestation memory a = _att(1, uint64(block.timestamp + 1 days));
        bytes memory sig = _attSign(otherPk, a);
        vm.expectRevert(AllocXVerification.InvalidSignature.selector);
        verification.submitAttestation(a, sig);
    }

    function test_Attestation_RevokedAttestorCannotSign() public {
        vm.prank(admin);
        verification.revokeRole(ATTESTOR_ROLE, attestor);
        OwnershipAttestation memory a = _att(1, uint64(block.timestamp + 1 days));
        bytes memory sig = _attSign(attestorPk, a);
        vm.expectRevert(AllocXVerification.InvalidSignature.selector);
        verification.submitAttestation(a, sig);
    }

    function test_Attestation_TamperedFieldInvalidatesSignature() public {
        OwnershipAttestation memory a = _att(1, uint64(block.timestamp + 1 days));
        bytes memory sig = _attSign(attestorPk, a);
        a.subject = buyer; // sign for stranger, submit for buyer
        vm.expectRevert(AllocXVerification.InvalidSignature.selector);
        verification.submitAttestation(a, sig);
    }

    function test_Attestation_RevertsForZeroSubjectAndUnknownProject() public {
        OwnershipAttestation memory a = _att(1, uint64(block.timestamp + 1 days));
        a.subject = address(0);
        bytes memory zsig = _attSign(attestorPk, a);
        vm.expectRevert(AllocXVerification.ZeroAddress.selector);
        verification.submitAttestation(a, zsig);

        a = _att(1, uint64(block.timestamp + 1 days));
        a.projectId = 999;
        bytes memory sig = _attSign(attestorPk, a);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.ProjectNotFound.selector, 999));
        verification.submitAttestation(a, sig);
    }

    function test_Attestation_Erc1271AttestorWallet() public {
        (address walletOwner, uint256 walletPk) = makeAddrAndKey("walletOwner");
        MockWallet wallet = new MockWallet(walletOwner);
        vm.prank(admin);
        verification.grantRole(ATTESTOR_ROLE, address(wallet));
        OwnershipAttestation memory a = _att(9, uint64(block.timestamp + 1 days));
        verification.submitAttestation(a, _attSign(walletPk, a));
        assertTrue(verification.usedAttestationNonces(address(wallet), 9));
        assertTrue(verification.hasValidAttestation(projectId, stranger));
    }

    // ------------------------------------------------- sale authorization
    function _freeAuth(uint64 deadline) internal view returns (SaleAuthorization memory) {
        return SaleAuthorization(1, seller, buyer, bytes32("items"), PRICE, address(settlement), 1, deadline);
    }

    function test_SaleAuth_ValidSignaturePasses() public view {
        SaleAuthorization memory a = _freeAuth(uint64(block.timestamp + 1 hours));
        verification.verifySaleAuthorization(a, _sign(sellerPk, a));
    }

    function test_SaleAuth_DigestAndDomainMatchIndependentComputation() public view {
        SaleAuthorization memory a = _freeAuth(uint64(block.timestamp + 1 hours));
        assertEq(verification.saleAuthorizationDigest(a), _digest(a));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AllocXVerification"),
                keccak256("1"),
                block.chainid,
                address(verification)
            )
        );
        assertEq(verification.DOMAIN_SEPARATOR(), domain);
    }

    function test_SaleAuth_ExpiredReverts() public {
        SaleAuthorization memory a = _freeAuth(uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(sellerPk, a);
        vm.warp(a.deadline); // deadline itself is still valid
        verification.verifySaleAuthorization(a, sig);
        vm.warp(a.deadline + 1);
        vm.expectRevert(AllocXVerification.AuthorizationExpired.selector);
        verification.verifySaleAuthorization(a, sig);
    }

    function test_SaleAuth_WrongSignerOrTamperedFieldsRevert() public {
        SaleAuthorization memory a = _freeAuth(uint64(block.timestamp + 1 hours));
        (, uint256 otherPk) = makeAddrAndKey("other");
        bytes memory bad = _sign(otherPk, a);
        vm.expectRevert(AllocXVerification.InvalidSignature.selector);
        verification.verifySaleAuthorization(a, bad);

        bytes memory good = _sign(sellerPk, a);
        a.price += 1;
        vm.expectRevert(AllocXVerification.InvalidSignature.selector);
        verification.verifySaleAuthorization(a, good);
    }

    function test_SaleAuth_ZeroSellerReverts() public {
        SaleAuthorization memory a = _freeAuth(uint64(block.timestamp + 1 hours));
        a.seller = address(0);
        vm.expectRevert(AllocXVerification.InvalidSignature.selector);
        verification.verifySaleAuthorization(a, hex"");
    }

    function test_SaleAuth_Erc1271WalletSeller() public {
        (address walletOwner, uint256 walletPk) = makeAddrAndKey("walletOwner");
        MockWallet wallet = new MockWallet(walletOwner);
        SaleAuthorization memory a = _freeAuth(uint64(block.timestamp + 1 hours));
        a.seller = address(wallet);
        verification.verifySaleAuthorization(a, _sign(walletPk, a));
        vm.expectRevert(AllocXVerification.InvalidSignature.selector);
        verification.verifySaleAuthorization(a, _sign(sellerPk, a));
    }

    function test_Verification_HasNoStateChangingSaleAuthPath() public view {
        // Revision 2: consumeSaleAuthorization and CONSUMER_ROLE were removed; verification only validates.
        assertEq(verification.getRoleMemberCount(DEFAULT_ADMIN), 1);
    }
}
