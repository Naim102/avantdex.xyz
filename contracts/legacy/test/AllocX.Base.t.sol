// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/IAllocX.sol";
import {AllocXProjectRegistry} from "../AllocXProjectRegistry.sol";
import {AllocXAdapterRegistry} from "../AllocXAdapterRegistry.sol";
import {AllocXVerification} from "../AllocXVerification.sol";
import {AllocXOwnershipManager} from "../AllocXOwnershipManager.sol";
import {AllocXFeeManager} from "../AllocXFeeManager.sol";
import {AllocXAssetManager} from "../AllocXAssetManager.sol";
import {AllocXEscrow} from "../AllocXEscrow.sol";
import {AllocXMarketplace} from "../AllocXMarketplace.sol";
import {AllocXSettlement, AllocXDeliveryErrors} from "../AllocXSettlement.sol";
import {AllocXDisputeManager} from "../AllocXDisputeManager.sol";
import {AllocXCoreDeployer} from "../AllocXCoreDeployer.sol";
import {AllocXMarketDeployer} from "../AllocXMarketDeployer.sol";
import "./mocks/MockTokens.sol";
import "./mocks/MockControl.sol";

/// @dev Shared fixture: real bootstrappers deploy the system; one active project with every asset type linked.
abstract contract AllocXTestBase is Test {
    bytes32 internal constant DEFAULT_ADMIN = 0x00;
    bytes32 internal constant CURATOR_ROLE = keccak256("CURATOR_ROLE");
    bytes32 internal constant ADAPTER_ADMIN_ROLE = keccak256("ADAPTER_ADMIN_ROLE");
    bytes32 internal constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");
    bytes32 internal constant FEE_ADMIN_ROLE = keccak256("FEE_ADMIN_ROLE");
    bytes32 internal constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
    bytes32 internal constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 internal constant MODERATOR_ROLE = keccak256("MODERATOR_ROLE");
    bytes32 internal constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");
    bytes32 internal constant DISPUTE_ROLE = keccak256("DISPUTE_ROLE");
    uint256 internal constant START = 1_700_000_000;
    uint256 internal constant PRICE = 100e6;
    uint32 internal constant WINDOW = 1 days;

    BlocklistUSDC public usdc;
    AllocXCoreDeployer public core;
    AllocXMarketDeployer public mkt;

    AllocXProjectRegistry public registry;
    AllocXAdapterRegistry public adapterRegistry;
    AllocXVerification public verification;
    AllocXOwnershipManager public ownership;
    AllocXFeeManager public feeManager;
    AllocXAssetManager public assetManager;
    AllocXEscrow public escrow;
    AllocXMarketplace public marketplace;
    AllocXSettlement public settlement;
    AllocXDisputeManager public disputes;

    MockERC20 public token20;
    MockERC721 public nft;
    MockERC1155 public multi;
    MockOwnable public ownable; // project main contract
    MockOwnable2Step public ownable2;
    MockAccessControl public acl;
    MockAdapter public adapter;
    MockOwnable public adapterTarget;

    address public admin = makeAddr("admin");
    address public treasury = makeAddr("treasury");
    address public buyer = makeAddr("buyer");
    address public stranger = makeAddr("stranger");
    address public relayer = makeAddr("relayer");
    address public seller;
    uint256 public sellerPk;

    uint256 public projectId;

    function setUp() public virtual {
        vm.warp(START);
        (seller, sellerPk) = makeAddrAndKey("seller");

        usdc = new BlocklistUSDC();
        core = new AllocXCoreDeployer(admin);
        registry = core.registry();
        adapterRegistry = core.adapterRegistry();
        verification = core.verification();
        ownership = core.ownershipManager();
        mkt = new AllocXMarketDeployer(
            admin, address(usdc), treasury, 200, address(registry), address(verification), address(ownership)
        );
        feeManager = mkt.feeManager();
        assetManager = mkt.assetManager();
        escrow = mkt.escrow();
        marketplace = mkt.marketplace();
        settlement = mkt.settlement();
        disputes = mkt.disputeManager();

        token20 = new MockERC20();
        nft = new MockERC721();
        multi = new MockERC1155();
        ownable = new MockOwnable(seller);
        ownable2 = new MockOwnable2Step(seller);
        acl = new MockAccessControl(seller);
        adapter = new MockAdapter();
        adapterTarget = new MockOwnable(seller);

        token20.mint(seller, 1_000_000e18);
        for (uint256 i = 1; i <= 10; ++i) {
            nft.mint(seller, i);
        }
        multi.mint(seller, 1, 1_000);
        multi.mint(seller, 2, 1_000);

        usdc.mint(buyer, 10_000_000e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);

        address[] memory related = new address[](5);
        related[0] = address(token20);
        related[1] = address(nft);
        related[2] = address(multi);
        related[3] = address(ownable2);
        related[4] = address(acl);
        vm.prank(seller);
        projectId = registry.submitProject(
            ProjectCategory.Bundle, address(ownable), seller, related, bytes32("meta"), "ipfs://project"
        );
        vm.prank(admin);
        registry.activateProject(projectId);
        vm.prank(seller);
        registry.addRelatedContract(projectId, address(adapterTarget));

        vm.prank(admin);
        adapterRegistry.approveAdapter(address(adapter), address(adapterTarget), "mock adapter");
        adapter.setController(address(adapterTarget), 7, bytes32("x"), seller);
    }

    function _unauth(address who, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role);
    }

    // ------------------------------------------------------------------ items
    function _i20(uint256 amt) internal view returns (Item memory) {
        return Item(AssetKind.ERC20, address(token20), 0, amt, address(0), bytes32(0));
    }

    function _i721(uint256 id) internal view returns (Item memory) {
        return Item(AssetKind.ERC721, address(nft), id, 1, address(0), bytes32(0));
    }

    function _i1155(uint256 id, uint256 amt) internal view returns (Item memory) {
        return Item(AssetKind.ERC1155, address(multi), id, amt, address(0), bytes32(0));
    }

    function _iOwn() internal view returns (Item memory) {
        return Item(AssetKind.OWNABLE, address(ownable), 0, 0, address(0), bytes32(0));
    }

    function _iOwn2() internal view returns (Item memory) {
        return Item(AssetKind.OWNABLE_2STEP, address(ownable2), 0, 0, address(0), bytes32(0));
    }

    function _iRole() internal view returns (Item memory) {
        return Item(AssetKind.ACCESS_ROLE, address(acl), uint256(acl.OPERATOR_ROLE()), 0, address(0), bytes32(0));
    }

    function _iAdapter() internal view returns (Item memory) {
        return Item(AssetKind.ADAPTER, address(adapterTarget), 7, 0, address(adapter), bytes32("x"));
    }

    function _arr1(Item memory a) internal pure returns (Item[] memory r) {
        r = new Item[](1);
        r[0] = a;
    }

    function _arr2(Item memory a, Item memory b) internal pure returns (Item[] memory r) {
        r = new Item[](2);
        r[0] = a;
        r[1] = b;
    }

    function _arr3(Item memory a, Item memory b, Item memory c) internal pure returns (Item[] memory r) {
        r = new Item[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    // ---------------------------------------------------------------- actions
    function _approveTokens() internal {
        vm.startPrank(seller);
        token20.approve(address(assetManager), type(uint256).max);
        nft.setApprovalForAll(address(assetManager), true);
        multi.setApprovalForAll(address(assetManager), true);
        vm.stopPrank();
    }

    function _list(Item[] memory items, uint256 price, bool auto_) internal returns (uint256 id) {
        vm.prank(seller);
        id = marketplace.createListing(
            projectId, items, price, uint64(block.timestamp + 7 days), WINDOW, auto_, bytes32("lm")
        );
    }

    function _listAsync(Item[] memory items) internal returns (uint256) {
        return _list(items, PRICE, false);
    }

    function _buy(uint256 listingId) internal returns (uint256 orderId) {
        vm.prank(buyer);
        orderId = marketplace.buy(listingId, type(uint256).max);
    }

    /// @dev list (async) + buy => Funded order.
    function _fundedOrder(Item[] memory items) internal returns (uint256 listingId, uint256 orderId) {
        listingId = _listAsync(items);
        orderId = _buy(listingId);
    }

    function _status(uint256 orderId) internal view returns (OrderStatus) {
        return settlement.getOrder(orderId).status;
    }

    function _lstatus(uint256 listingId) internal view returns (ListingStatus) {
        return marketplace.getListing(listingId).status;
    }

    function _fee(uint256 gross, uint256 bps) internal pure returns (uint256) {
        return (gross * bps) / 10_000;
    }

    // -------------------------------------------------------------- signature
    function _auth(uint256 orderId, uint256 nonce, uint64 deadline) internal view returns (SaleAuthorization memory) {
        Order memory o = settlement.getOrder(orderId);
        return SaleAuthorization({
            orderId: orderId,
            seller: o.seller,
            buyer: o.buyer,
            itemsHash: o.itemsHash,
            price: o.price,
            settlement: address(settlement),
            nonce: nonce,
            deadline: deadline
        });
    }

    /// @dev Independent EIP-712 digest (does not call the contract's digest helper).
    function _digest(SaleAuthorization memory a) internal view returns (bytes32) {
        bytes32 typehash = keccak256(
            "SaleAuthorization(uint256 orderId,address seller,address buyer,bytes32 itemsHash,uint256 price,address settlement,uint256 nonce,uint64 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash, a.orderId, a.seller, a.buyer, a.itemsHash, a.price, a.settlement, a.nonce, a.deadline
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AllocXVerification"),
                keccak256("1"),
                block.chainid,
                address(verification)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(uint256 pk, SaleAuthorization memory a) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(a));
        return abi.encodePacked(r, s, v);
    }
}
