// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AvantdexExchange} from "../AvantdexExchange.sol";
import {BlocklistUSDC, MockERC20, FeeOnTransferERC20} from "./mocks/MockTokens.sol";

contract AvantdexTest is Test {
    AvantdexExchange ex;
    BlocklistUSDC usdc;
    MockERC20 token;

    address admin = makeAddr("admin");
    address collector = address(0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6);
    address alice = makeAddr("alice"); // buyer
    address bob = makeAddr("bob"); // seller
    address carol = makeAddr("carol");
    address stranger = makeAddr("stranger");

    uint128 constant LOT = 1e18; // one whole token per lot
    uint128 constant TICK = 1e4; // 0.01 USDC
    uint128 constant ONE = 1e6; // 1 USDC

    uint256 mid; // default market id
    uint64 tStart;
    uint64 tEnd;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new BlocklistUSDC();
        token = new MockERC20();
        ex = new AvantdexExchange(address(usdc), collector, admin);
        tStart = uint64(block.timestamp);
        tEnd = uint64(block.timestamp + 30 days);

        address[4] memory users = [alice, bob, carol, stranger];
        for (uint256 i; i < users.length; ++i) {
            usdc.mint(users[i], 1_000_000 * ONE);
            vm.prank(users[i]);
            usdc.approve(address(ex), type(uint256).max);
            token.mint(users[i], 1_000_000 ether);
            vm.prank(users[i]);
            token.approve(address(ex), type(uint256).max);
        }
        mid = _newMarket(address(0));
    }

    // ------------------------------------------------------------------ helpers

    function _newMarket(address tok) internal returns (uint256 id) {
        vm.startPrank(admin);
        id = ex.createMarket(tok, LOT, TICK, 1, 10_000, tStart, tEnd, keccak256("m"));
        ex.activateMarket(id);
        vm.stopPrank();
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    function _none() internal pure returns (uint256[] memory r) {
        r = new uint256[](0);
    }

    function _sell(address who, uint128 price, uint128 lots) internal returns (uint256 id) {
        vm.prank(who);
        (id,) = ex.placeOrder(mid, AvantdexExchange.Side.Sell, price, lots, tEnd, false, 0, _none());
    }

    function _buyRest(address who, uint128 price, uint128 lots) internal returns (uint256 id) {
        vm.prank(who);
        (id,) = ex.placeOrder(mid, AvantdexExchange.Side.Buy, price, lots, tEnd, false, 0, _none());
    }

    function _buyAgainst(address who, uint128 price, uint128 lots, uint256[] memory makers)
        internal
        returns (uint256 id, uint128 filled)
    {
        vm.prank(who);
        (id, filled) = ex.placeOrder(mid, AvantdexExchange.Side.Buy, price, lots, tEnd, false, 0, makers);
    }

    function _fee(uint256 v) internal pure returns (uint256) {
        return (v * 50) / 10_000;
    }

    /// @dev alice buys `lots` from bob's sell at `price`; returns trade id 1-style (latest).
    function _trade(uint128 price, uint128 lots) internal returns (uint256 tradeId) {
        uint256 s = _sell(bob, price, lots);
        _buyAgainst(alice, price, lots, _ids(s));
        tradeId = ex.tradeCount();
    }

    function _openSettlement(uint64 window) internal {
        vm.prank(admin);
        ex.openSettlement(mid, address(token), window);
    }

    // ------------------------------------------------------------------ constructor, roles, fees

    function test_constructor_setsRolesAndFeeConstants() public view {
        assertEq(address(ex.usdc()), address(usdc));
        assertEq(ex.feeCollector(), collector);
        assertTrue(ex.hasRole(ex.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(ex.hasRole(ex.MARKET_MANAGER_ROLE(), admin));
        assertTrue(ex.hasRole(ex.PAUSER_ROLE(), admin));
        assertEq(ex.BUYER_FEE_BPS(), 50);
        assertEq(ex.SELLER_FEE_BPS(), 50);
        assertEq(ex.feeOf(1_000 * ONE), 5 * ONE); // 0.5%
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(AvantdexExchange.ZeroAddress.selector);
        new AvantdexExchange(address(0), collector, admin);
        vm.expectRevert(AvantdexExchange.ZeroAddress.selector);
        new AvantdexExchange(address(usdc), address(0), admin);
        vm.expectRevert(AvantdexExchange.ZeroAddress.selector);
        new AvantdexExchange(address(usdc), collector, address(0));
    }

    function test_setFeeCollector_onlyAdmin() public {
        vm.prank(stranger);
        vm.expectRevert();
        ex.setFeeCollector(stranger);
        vm.prank(admin);
        vm.expectRevert(AvantdexExchange.ZeroAddress.selector);
        ex.setFeeCollector(address(0));
        vm.prank(admin);
        ex.setFeeCollector(carol);
        assertEq(ex.feeCollector(), carol);
    }

    // ------------------------------------------------------------------ market management

    function test_createMarket_validationAndAccess() public {
        vm.prank(stranger);
        vm.expectRevert();
        ex.createMarket(address(0), LOT, TICK, 1, 10, tStart, tEnd, 0);

        vm.startPrank(admin);
        vm.expectRevert(AvantdexExchange.InvalidMarketParams.selector);
        ex.createMarket(address(0), 0, TICK, 1, 10, tStart, tEnd, 0);
        vm.expectRevert(AvantdexExchange.InvalidMarketParams.selector);
        ex.createMarket(address(0), LOT, 0, 1, 10, tStart, tEnd, 0);
        vm.expectRevert(AvantdexExchange.InvalidMarketParams.selector);
        ex.createMarket(address(0), LOT, TICK, 5, 4, tStart, tEnd, 0);
        vm.expectRevert(AvantdexExchange.InvalidMarketParams.selector);
        ex.createMarket(address(0), LOT, TICK, 1, 10, tStart, tStart + 30 minutes, 0);
        vm.expectRevert(AvantdexExchange.InvalidMarketParams.selector);
        ex.createMarket(address(0), LOT, TICK, 1, 10, tStart - 2 days, tStart - 1 days, 0);
        vm.expectRevert(AvantdexExchange.NotAContract.selector);
        ex.createMarket(alice, LOT, TICK, 1, 10, tStart, tEnd, 0);
        vm.stopPrank();
    }

    function test_marketStatusMachine() public {
        vm.startPrank(admin);
        uint256 id = ex.createMarket(address(0), LOT, TICK, 1, 10, tStart, tEnd, 0);
        // Setup: cannot suspend/resume/open settlement
        vm.expectRevert(AvantdexExchange.InvalidMarketStatus.selector);
        ex.suspendMarket(id);
        vm.expectRevert(AvantdexExchange.InvalidMarketStatus.selector);
        ex.openSettlement(id, address(token), 1 days);
        ex.activateMarket(id);
        vm.expectRevert(AvantdexExchange.InvalidMarketStatus.selector);
        ex.activateMarket(id);
        ex.suspendMarket(id);
        vm.expectRevert(AvantdexExchange.InvalidMarketStatus.selector);
        ex.suspendMarket(id);
        ex.resumeMarket(id);
        ex.cancelMarket(id);
        vm.expectRevert(AvantdexExchange.InvalidMarketStatus.selector);
        ex.cancelMarket(id);
        vm.expectRevert(AvantdexExchange.MarketNotFound.selector);
        ex.activateMarket(999);
        vm.stopPrank();
    }

    function test_managerFunctionsRequireRole() public {
        vm.startPrank(stranger);
        vm.expectRevert();
        ex.activateMarket(mid);
        vm.expectRevert();
        ex.suspendMarket(mid);
        vm.expectRevert();
        ex.cancelMarket(mid);
        vm.expectRevert();
        ex.openSettlement(mid, address(token), 1 days);
        vm.expectRevert();
        ex.extendSettlement(mid, 1);
        vm.expectRevert();
        ex.completeMarket(mid);
        vm.expectRevert();
        ex.pause();
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ placing orders

    function test_sellOrderLocksCollateral() public {
        uint256 before_ = usdc.balanceOf(bob);
        uint256 id = _sell(bob, 2 * ONE, 10);
        assertEq(before_ - usdc.balanceOf(bob), 20 * ONE);
        AvantdexExchange.Order memory o = ex.getOrder(id);
        assertEq(o.owner, bob);
        assertEq(o.locked, 20 * ONE);
        assertEq(uint8(o.status), uint8(AvantdexExchange.OrderStatus.Open));
        assertEq(usdc.balanceOf(address(ex)), 20 * ONE);
    }

    function test_buyOrderLocksValuePlusFee() public {
        uint256 before_ = usdc.balanceOf(alice);
        uint256 id = _buyRest(alice, 2 * ONE, 10);
        assertEq(before_ - usdc.balanceOf(alice), 20 * ONE + _fee(20 * ONE));
        assertEq(ex.getOrder(id).locked, 20 * ONE + _fee(20 * ONE));
    }

    function test_placeOrder_validation() public {
        vm.startPrank(alice);
        vm.expectRevert(AvantdexExchange.InvalidPrice.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, 0, 10, tEnd, false, 0, _none());
        vm.expectRevert(AvantdexExchange.InvalidPrice.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, TICK + 1, 10, tEnd, false, 0, _none());
        vm.expectRevert(AvantdexExchange.InvalidSize.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 0, tEnd, false, 0, _none());
        vm.expectRevert(AvantdexExchange.InvalidSize.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 10_001, tEnd, false, 0, _none());
        // value below 1 USDC
        vm.expectRevert(AvantdexExchange.InvalidSize.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, TICK, 1, tEnd, false, 0, _none());
        vm.expectRevert(AvantdexExchange.InvalidExpiry.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 1, uint64(block.timestamp), false, 0, _none());
        vm.expectRevert(AvantdexExchange.InvalidExpiry.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 1, tEnd + 1, false, 0, _none());
        vm.expectRevert(AvantdexExchange.MarketNotFound.selector);
        ex.placeOrder(99, AvantdexExchange.Side.Buy, ONE, 1, tEnd, false, 0, _none());
        uint256[] memory many = new uint256[](51);
        vm.expectRevert(AvantdexExchange.TooManyItems.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 1, tEnd, false, 0, many);
        vm.stopPrank();
    }

    function test_placeOrder_requiresLiveMarketAndWindow() public {
        vm.prank(admin);
        ex.suspendMarket(mid);
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.MarketNotTradable.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 1, tEnd, false, 0, _none());
        vm.prank(admin);
        ex.resumeMarket(mid);
        vm.warp(tEnd);
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.MarketNotTradable.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 1, tEnd, false, 0, _none());

        // Setup market and not-yet-started market
        vm.warp(tStart);
        vm.prank(admin);
        uint256 s = ex.createMarket(address(0), LOT, TICK, 1, 10, tStart + 1 days, tEnd, 0);
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.MarketNotTradable.selector);
        ex.placeOrder(s, AvantdexExchange.Side.Buy, ONE, 1, tEnd, false, 0, _none());
        vm.prank(admin);
        ex.activateMarket(s);
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.MarketNotTradable.selector);
        ex.placeOrder(s, AvantdexExchange.Side.Buy, ONE, 1, tEnd, false, 0, _none());
    }

    function test_placeOrder_requiresApprovalAndBalance() public {
        vm.prank(stranger);
        usdc.approve(address(ex), 0);
        vm.prank(stranger);
        vm.expectRevert();
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 1, tEnd, false, 0, _none());
    }

    // ------------------------------------------------------------------ matching

    function test_buyTakerExecutesAtMakerPrice_withPartialFillAndRest() public {
        uint256 s = _sell(bob, 15 * ONE / 10, 6); // 1.50 x 6
        uint256 aliceBefore = usdc.balanceOf(alice);
        (uint256 bid, uint128 filled) = _buyAgainst(alice, 2 * ONE, 10, _ids(s)); // limit 2.00 x 10

        assertEq(filled, 6);
        AvantdexExchange.Trade memory t = ex.getTrade(1);
        assertEq(t.price, 15 * ONE / 10, "maker price");
        assertEq(t.lots, 6);
        assertEq(t.value, 9 * ONE);
        assertEq(t.buyer, alice);
        assertEq(t.seller, bob);
        assertEq(t.buyerFee, _fee(9 * ONE));
        assertEq(uint8(ex.getOrder(s).status), uint8(AvantdexExchange.OrderStatus.Filled));

        // alice paid trade (value + fee) + rest lock (4 lots @2.00 + fee); no price-improvement overcharge
        uint256 expected = 9 * ONE + _fee(9 * ONE) + 8 * ONE + _fee(8 * ONE);
        assertEq(aliceBefore - usdc.balanceOf(alice), expected);
        AvantdexExchange.Order memory o = ex.getOrder(bid);
        assertEq(o.filled, 6);
        assertEq(o.locked, 8 * ONE + _fee(8 * ONE));
        assertEq(uint8(o.status), uint8(AvantdexExchange.OrderStatus.Open));
    }

    function test_sellTakerExecutesAtMakerPrice_collateralIsTradeValue() public {
        uint256 b = _buyRest(alice, 2 * ONE, 5); // resting buy @2.00
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        (, uint128 filled) = ex.placeOrder(mid, AvantdexExchange.Side.Sell, ONE, 5, tEnd, false, 0, _ids(b));
        assertEq(filled, 5);
        AvantdexExchange.Trade memory t = ex.getTrade(1);
        assertEq(t.price, 2 * ONE, "executes at maker (buyer) price");
        // seller collateral == trade value 10 USDC at the better price
        assertEq(bobBefore - usdc.balanceOf(bob), 10 * ONE);
        assertEq(ex.getOrder(b).locked, 0);
        assertEq(usdc.balanceOf(address(ex)), 10 * ONE + 10 * ONE + _fee(10 * ONE));
    }

    function test_multipleMakers_fillInSuppliedOrder() public {
        uint256 s1 = _sell(bob, ONE, 3);
        uint256 s2 = _sell(carol, 2 * ONE, 4);
        (, uint128 filled) = _buyAgainst(alice, 3 * ONE, 5, _ids(s1, s2));
        assertEq(filled, 5);
        assertEq(ex.tradeCount(), 2);
        assertEq(ex.getTrade(1).lots, 3);
        assertEq(ex.getTrade(1).price, ONE);
        assertEq(ex.getTrade(2).lots, 2);
        assertEq(ex.getTrade(2).price, 2 * ONE);
        assertEq(ex.getOrder(s2).filled, 2);
        assertEq(uint8(ex.getOrder(s2).status), uint8(AvantdexExchange.OrderStatus.Open));
    }

    function test_ineligibleMakersAreSkipped() public {
        uint256 own = _sell(alice, ONE, 5); // alice's own sell
        uint256 high = _sell(bob, 5 * ONE, 5); // does not cross a 2.00 buy
        uint256 same = _buyRest(carol, ONE, 5); // same side
        uint256 ok = _sell(carol, ONE, 2);
        uint256[] memory list = new uint256[](5);
        list[0] = own;
        list[1] = high;
        list[2] = same;
        list[3] = 999; // nonexistent
        list[4] = ok;
        (, uint128 filled) = _buyAgainst(alice, 2 * ONE, 3, list);
        assertEq(filled, 2);
        assertEq(ex.tradeCount(), 1);
    }

    function test_expiredMakerCannotBeMatched() public {
        vm.prank(bob);
        (uint256 s,) = ex.placeOrder(mid, AvantdexExchange.Side.Sell, ONE, 5, uint64(block.timestamp + 1 hours), false, 0, _none());
        vm.warp(block.timestamp + 1 hours);
        (, uint128 filled) = _buyAgainst(alice, ONE, 5, _ids(s));
        assertEq(filled, 0);
        assertEq(ex.tradeCount(), 0);
    }

    function test_makerInOtherMarketIsSkipped() public {
        uint256 other = _newMarket(address(0));
        vm.prank(bob);
        (uint256 s,) = ex.placeOrder(other, AvantdexExchange.Side.Sell, ONE, 5, tEnd, false, 0, _none());
        (, uint128 filled) = _buyAgainst(alice, ONE, 5, _ids(s));
        assertEq(filled, 0);
    }

    // ------------------------------------------------------------------ IOC / market-style protection

    function test_ioc_fillsAndDiscardsRemainder() public {
        uint256 s = _sell(bob, ONE, 3);
        uint256 before_ = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint256 oid, uint128 filled) = ex.placeOrder(mid, AvantdexExchange.Side.Buy, 2 * ONE, 10, tEnd, true, 2, _ids(s));
        assertEq(filled, 3);
        assertEq(uint8(ex.getOrder(oid).status), uint8(AvantdexExchange.OrderStatus.Cancelled));
        assertEq(ex.getOrder(oid).locked, 0);
        assertEq(before_ - usdc.balanceOf(alice), 3 * ONE + _fee(3 * ONE)); // nothing locked for the remainder
    }

    function test_ioc_revertsBelowMinFill_andMovesNoFunds() public {
        uint256 s = _sell(bob, ONE, 3);
        uint256 before_ = usdc.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.NothingFilled.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, 2 * ONE, 10, tEnd, true, 4, _ids(s));
        assertEq(usdc.balanceOf(alice), before_);
        assertEq(ex.tradeCount(), 0);
        assertEq(ex.orderCount(), 1); // only bob's sell
    }

    function test_ioc_requiresMinFillAtLeastOne() public {
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.NothingFilled.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 1, tEnd, true, 0, _none());
    }

    function test_ioc_priceCapProtectsTaker() public {
        uint256 s = _sell(bob, 5 * ONE, 3); // too expensive for a 2.00 cap
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.NothingFilled.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, 2 * ONE, 3, tEnd, true, 1, _ids(s));
    }

    // ------------------------------------------------------------------ cancel / expiry

    function test_cancelOrder_refundsExactLock_noFee() public {
        uint256 id = _buyRest(alice, 3 * ONE, 7);
        uint256 before_ = usdc.balanceOf(alice);
        vm.prank(alice);
        ex.cancelOrder(id);
        assertEq(usdc.balanceOf(alice) - before_, 21 * ONE + _fee(21 * ONE));
        assertEq(usdc.balanceOf(collector), 0);
        assertEq(usdc.balanceOf(address(ex)), 0);
        assertEq(uint8(ex.getOrder(id).status), uint8(AvantdexExchange.OrderStatus.Cancelled));
    }

    function test_cancelOrder_guards() public {
        uint256 id = _sell(bob, ONE, 3);
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.NotOrderOwner.selector);
        ex.cancelOrder(id);
        vm.prank(bob);
        ex.cancelOrder(id);
        vm.prank(bob);
        vm.expectRevert(AvantdexExchange.OrderNotOpen.selector);
        ex.cancelOrder(id);
        vm.prank(bob);
        vm.expectRevert(AvantdexExchange.OrderNotOpen.selector);
        ex.cancelOrder(12345);
    }

    function test_cancelPartiallyFilledOrder_refundsOnlyRemainder() public {
        uint256 s = _sell(bob, ONE, 10);
        _buyAgainst(alice, ONE, 4, _ids(s));
        uint256 before_ = usdc.balanceOf(bob);
        vm.prank(bob);
        ex.cancelOrder(s);
        assertEq(usdc.balanceOf(bob) - before_, 6 * ONE); // 4 lots stay as trade collateral
    }

    function test_cancelAlwaysAllowed_whenPausedSuspendedOrCancelled() public {
        uint256 a = _sell(bob, ONE, 3);
        uint256 b = _sell(bob, ONE, 3);
        uint256 c = _sell(bob, ONE, 3);
        vm.prank(admin);
        ex.pause();
        vm.prank(bob);
        ex.cancelOrder(a);
        vm.prank(admin);
        ex.unpause();
        vm.prank(admin);
        ex.suspendMarket(mid);
        vm.prank(bob);
        ex.cancelOrder(b);
        vm.prank(admin);
        ex.cancelMarket(mid);
        vm.prank(bob);
        ex.cancelOrder(c);
        assertEq(usdc.balanceOf(address(ex)), 0);
    }

    function test_expireOrders() public {
        vm.prank(bob);
        (uint256 s,) = ex.placeOrder(mid, AvantdexExchange.Side.Sell, ONE, 3, uint64(block.timestamp + 1 hours), false, 0, _none());
        uint256 before_ = usdc.balanceOf(bob);
        vm.prank(stranger);
        ex.expireOrders(_ids(s)); // too early: no-op
        assertEq(usdc.balanceOf(bob), before_);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(stranger);
        ex.expireOrders(_ids(s));
        assertEq(usdc.balanceOf(bob) - before_, 3 * ONE);
        assertEq(uint8(ex.getOrder(s).status), uint8(AvantdexExchange.OrderStatus.Expired));
        // idempotent
        vm.prank(stranger);
        ex.expireOrders(_ids(s));
        assertEq(usdc.balanceOf(bob) - before_, 3 * ONE);
        uint256[] memory many = new uint256[](51);
        vm.expectRevert(AvantdexExchange.TooManyItems.selector);
        ex.expireOrders(many);
    }

    function test_roundingDustReturnedWhenMakerFullyFilled() public {
        // tick = 1 so values are not multiples of 200 and per-fill fee floors lose dust
        vm.startPrank(admin);
        uint256 m1 = ex.createMarket(address(0), LOT, 1, 1, 10_000, tStart, tEnd, 0);
        ex.activateMarket(m1);
        vm.stopPrank();

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint256 b,) = ex.placeOrder(m1, AvantdexExchange.Side.Buy, 100_100, 22, tEnd, false, 0, _none());
        assertEq(ex.getOrder(b).locked, 2_202_200 + 11_011);

        for (uint256 i; i < 2; ++i) {
            vm.prank(bob);
            ex.placeOrder(m1, AvantdexExchange.Side.Sell, 100_000, 11, tEnd, true, 1, _ids(b));
        }
        AvantdexExchange.Order memory o = ex.getOrder(b);
        assertEq(uint8(o.status), uint8(AvantdexExchange.OrderStatus.Filled));
        assertEq(o.locked, 0);
        // two fills of 1_101_100 + fee 5_505 each; the 1-unit rounding dust went back to alice
        assertEq(aliceBefore - usdc.balanceOf(alice), 2 * (1_101_100 + 5_505));
        _assertSolvent();
    }

    // ------------------------------------------------------------------ settlement

    function test_openSettlement_validation() public {
        vm.startPrank(admin);
        vm.expectRevert(AvantdexExchange.InvalidSettlementWindow.selector);
        ex.openSettlement(mid, address(token), 59 minutes);
        vm.expectRevert(AvantdexExchange.InvalidSettlementWindow.selector);
        ex.openSettlement(mid, address(token), 15 days);
        vm.expectRevert(AvantdexExchange.NotAContract.selector);
        ex.openSettlement(mid, address(0), 1 days);
        vm.expectRevert(AvantdexExchange.NotAContract.selector);
        ex.openSettlement(mid, alice, 1 days);
        ex.openSettlement(mid, address(token), 1 days);
        vm.expectRevert(AvantdexExchange.InvalidMarketStatus.selector);
        ex.openSettlement(mid, address(token), 1 days);
        vm.stopPrank();
    }

    function test_openSettlement_tokenCannotChangeIfPreset() public {
        uint256 id = _newMarket(address(token));
        MockERC20 other = new MockERC20();
        vm.prank(admin);
        vm.expectRevert(AvantdexExchange.TokenMismatch.selector);
        ex.openSettlement(id, address(other), 1 days);
        vm.prank(admin);
        ex.openSettlement(id, address(token), 1 days);
    }

    function test_openSettlement_stopsTrading() public {
        _openSettlement(1 days);
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.MarketNotTradable.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 1, tEnd, false, 0, _none());
    }

    function test_settleTrade_atomicSwap_andFees() public {
        uint256 id = _trade(2 * ONE, 10); // value 20 USDC
        uint256 value = 20 * ONE;
        uint256 fee = _fee(value);
        _openSettlement(1 days);

        uint256 bobUsdc = usdc.balanceOf(bob);
        uint256 aliceTok = token.balanceOf(alice);
        uint256 bobTok = token.balanceOf(bob);

        vm.prank(bob);
        ex.settleTrade(id);

        assertEq(token.balanceOf(alice) - aliceTok, 10 ether, "buyer receives tokens");
        assertEq(bobTok - token.balanceOf(bob), 10 ether);
        assertEq(usdc.balanceOf(bob) - bobUsdc, 2 * value - fee, "seller: payment + collateral - 0.5%");
        assertEq(usdc.balanceOf(collector), 2 * fee, "collector gets buyer + seller fee");
        assertEq(usdc.balanceOf(address(ex)), 0);
        assertEq(uint8(ex.getTrade(id).status), uint8(AvantdexExchange.TradeStatus.Settled));
        assertEq(ex.getMarket(mid).openTrades, 0);
    }

    function test_settleTrade_guards() public {
        uint256 id = _trade(2 * ONE, 10);
        vm.prank(bob);
        vm.expectRevert(AvantdexExchange.SettlementNotOpen.selector);
        ex.settleTrade(id);
        _openSettlement(1 days);
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.NotSeller.selector);
        ex.settleTrade(id);
        vm.prank(bob);
        ex.settleTrade(id);
        vm.prank(bob);
        vm.expectRevert(AvantdexExchange.TradeNotOpen.selector);
        ex.settleTrade(id);
        vm.prank(bob);
        vm.expectRevert(AvantdexExchange.TradeNotOpen.selector);
        ex.settleTrade(777);
    }

    function test_settleTrade_requiresSellerApprovalAndBalance() public {
        uint256 id = _trade(2 * ONE, 10);
        _openSettlement(1 days);
        vm.prank(bob);
        token.approve(address(ex), 0);
        vm.prank(bob);
        vm.expectRevert();
        ex.settleTrade(id);
        assertEq(uint8(ex.getTrade(id).status), uint8(AvantdexExchange.TradeStatus.Open), "state unchanged");
        assertEq(usdc.balanceOf(collector), 0);
    }

    function test_settleTrade_feeOnTransferTokenRevertsAtomically() public {
        FeeOnTransferERC20 taxed = new FeeOnTransferERC20();
        taxed.mint(bob, 100 ether);
        vm.prank(bob);
        taxed.approve(address(ex), type(uint256).max);
        uint256 id = _trade(ONE, 10);
        vm.prank(admin);
        ex.openSettlement(mid, address(taxed), 1 days);
        vm.prank(bob);
        vm.expectRevert(AvantdexExchange.DeliveryNotVerified.selector);
        ex.settleTrade(id);
        assertEq(taxed.balanceOf(alice), 0);
        assertEq(taxed.balanceOf(bob), 100 ether);
        assertEq(uint8(ex.getTrade(id).status), uint8(AvantdexExchange.TradeStatus.Open));
    }

    function test_settleAfterDeadline_allowedUntilBuyerClaimsDefault() public {
        uint256 id = _trade(ONE, 10);
        _openSettlement(1 hours);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(bob);
        ex.settleTrade(id); // buyer had not claimed yet
        assertEq(uint8(ex.getTrade(id).status), uint8(AvantdexExchange.TradeStatus.Settled));
    }

    function test_claimDefault_paysBuyerPaymentPlusCollateral_noFee() public {
        uint256 id = _trade(2 * ONE, 10);
        uint256 value = 20 * ONE;
        _openSettlement(1 hours);

        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.DeadlineNotReached.selector);
        ex.claimDefault(id);

        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(bob);
        vm.expectRevert(AvantdexExchange.NotBuyer.selector);
        ex.claimDefault(id);

        uint256 before_ = usdc.balanceOf(alice);
        vm.prank(alice);
        ex.claimDefault(id);
        assertEq(usdc.balanceOf(alice) - before_, 2 * value + _fee(value));
        assertEq(usdc.balanceOf(collector), 0, "no platform fee on failure");
        assertEq(usdc.balanceOf(address(ex)), 0);
        assertEq(uint8(ex.getTrade(id).status), uint8(AvantdexExchange.TradeStatus.Defaulted));

        vm.prank(bob);
        vm.expectRevert(AvantdexExchange.TradeNotOpen.selector);
        ex.settleTrade(id);
    }

    function test_claimDefault_notBeforeSettlementOpens() public {
        uint256 id = _trade(ONE, 10);
        vm.warp(tEnd + 100 days);
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.SettlementNotOpen.selector);
        ex.claimDefault(id);
    }

    function test_extendSettlement_bounds() public {
        _openSettlement(1 days);
        uint64 opened = uint64(block.timestamp);
        vm.startPrank(admin);
        vm.expectRevert(AvantdexExchange.InvalidExtension.selector);
        ex.extendSettlement(mid, opened + 1 days); // not later
        vm.expectRevert(AvantdexExchange.InvalidExtension.selector);
        ex.extendSettlement(mid, opened + 30 days + 1); // beyond total cap
        ex.extendSettlement(mid, opened + 5 days);
        ex.extendSettlement(mid, opened + 30 days);
        assertEq(ex.getMarket(mid).settlementDeadline, opened + 30 days);
        vm.stopPrank();
    }

    function test_extensionDelaysDefaultClaim() public {
        uint256 id = _trade(ONE, 10);
        _openSettlement(1 hours);
        vm.prank(admin);
        ex.extendSettlement(mid, uint64(block.timestamp + 3 hours));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        vm.expectRevert(AvantdexExchange.DeadlineNotReached.selector);
        ex.claimDefault(id);
    }

    function test_completeMarket() public {
        uint256 id = _trade(ONE, 10);
        _openSettlement(1 days);
        vm.prank(admin);
        vm.expectRevert(AvantdexExchange.TradesStillOpen.selector);
        ex.completeMarket(mid);
        vm.prank(bob);
        ex.settleTrade(id);
        vm.prank(admin);
        ex.completeMarket(mid);
        assertEq(uint8(ex.getMarket(mid).status), uint8(AvantdexExchange.MarketStatus.Completed));
    }

    // ------------------------------------------------------------------ refunds

    function test_cancelledMarket_refundsBothSides_noFeeNoPenalty() public {
        uint256 id = _trade(2 * ONE, 10);
        uint256 value = 20 * ONE;
        vm.prank(stranger);
        vm.expectRevert(AvantdexExchange.NotRefundable.selector);
        ex.refundTrade(id);

        vm.prank(admin);
        ex.cancelMarket(mid);
        uint256 a = usdc.balanceOf(alice);
        uint256 b = usdc.balanceOf(bob);
        vm.prank(stranger);
        ex.refundTrade(id);
        assertEq(usdc.balanceOf(alice) - a, value + _fee(value));
        assertEq(usdc.balanceOf(bob) - b, value);
        assertEq(usdc.balanceOf(collector), 0);
        assertEq(usdc.balanceOf(address(ex)), 0);
        vm.expectRevert(AvantdexExchange.TradeNotOpen.selector);
        ex.refundTrade(id);
    }

    function test_cancelAfterSettlementOpened_refundsRemainingTrades() public {
        uint256 id = _trade(ONE, 10);
        _openSettlement(1 days);
        vm.prank(admin);
        ex.cancelMarket(mid);
        ex.refundTrade(id);
        assertEq(uint8(ex.getTrade(id).status), uint8(AvantdexExchange.TradeStatus.Refunded));
    }

    function test_abandonedMarket_refundableAfterDelay() public {
        uint256 id = _trade(ONE, 10);
        vm.warp(uint256(tEnd) + 90 days);
        vm.expectRevert(AvantdexExchange.NotRefundable.selector);
        ex.refundTrade(id);
        vm.warp(uint256(tEnd) + 90 days + 1);
        assertTrue(ex.isRefundable(mid));
        ex.refundTrade(id);
        assertEq(usdc.balanceOf(address(ex)), 0);
    }

    function test_abandonPathNotAvailableOnceSettlementOpen() public {
        uint256 id = _trade(ONE, 10);
        _openSettlement(14 days);
        vm.warp(uint256(tEnd) + 200 days);
        assertFalse(ex.isRefundable(mid));
        vm.expectRevert(AvantdexExchange.NotRefundable.selector);
        ex.refundTrade(id);
    }

    // ------------------------------------------------------------------ pause

    function test_pause_blocksNewOrdersOnly() public {
        uint256 id = _trade(ONE, 10);
        vm.prank(admin);
        ex.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        ex.placeOrder(mid, AvantdexExchange.Side.Buy, ONE, 1, tEnd, false, 0, _none());
        _openSettlement(1 days);
        vm.prank(bob);
        ex.settleTrade(id); // settlement still works
        vm.prank(admin);
        ex.unpause();
    }

    // ------------------------------------------------------------------ blocklist fallbacks

    function test_collectorBlocked_feeBecomesClaimable_settlementStillSucceeds() public {
        uint256 id = _trade(2 * ONE, 10);
        uint256 fee = _fee(20 * ONE);
        usdc.setBlocked(collector, true);
        _openSettlement(1 days);
        vm.prank(bob);
        ex.settleTrade(id);
        assertEq(ex.claimable(collector), 2 * fee);
        assertEq(usdc.balanceOf(address(ex)), 2 * fee);

        vm.prank(collector);
        vm.expectRevert();
        ex.withdrawClaimable();
        assertEq(ex.claimable(collector), 2 * fee, "claim preserved");

        usdc.setBlocked(collector, false);
        vm.prank(collector);
        ex.withdrawClaimable();
        assertEq(usdc.balanceOf(collector), 2 * fee);
        vm.prank(collector);
        vm.expectRevert(AvantdexExchange.NothingToClaim.selector);
        ex.withdrawClaimable();
    }

    function test_sellerBlocked_payoutClaimable() public {
        uint256 id = _trade(ONE, 10);
        usdc.setBlocked(bob, true);
        _openSettlement(1 days);
        vm.prank(bob);
        ex.settleTrade(id);
        assertEq(ex.claimable(bob), 2 * 10 * ONE - _fee(10 * ONE));
        assertEq(token.balanceOf(alice), 1_000_000 ether + 10 ether, "buyer still receives tokens");
    }

    function test_buyerBlocked_defaultPayoutClaimable() public {
        uint256 id = _trade(ONE, 10);
        usdc.setBlocked(alice, true);
        _openSettlement(1 hours);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        ex.claimDefault(id);
        assertEq(ex.claimable(alice), 2 * 10 * ONE + _fee(10 * ONE));
    }

    function test_blockedOrderOwnerCancelBecomesClaimable() public {
        uint256 id = _sell(bob, ONE, 5);
        usdc.setBlocked(bob, true);
        vm.prank(bob);
        ex.cancelOrder(id);
        assertEq(ex.claimable(bob), 5 * ONE);
        assertEq(uint8(ex.getOrder(id).status), uint8(AvantdexExchange.OrderStatus.Cancelled));
    }

    function test_blockedPartyCannotBlockCounterpartyRefund() public {
        uint256 id = _trade(ONE, 10);
        usdc.setBlocked(bob, true);
        vm.prank(admin);
        ex.cancelMarket(mid);
        uint256 a = usdc.balanceOf(alice);
        ex.refundTrade(id);
        assertEq(usdc.balanceOf(alice) - a, 10 * ONE + _fee(10 * ONE));
        assertEq(ex.claimable(bob), 10 * ONE);
    }

    // ------------------------------------------------------------------ native value, access

    function test_rejectsNativeValue() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(ex).call{value: 1 ether}("");
        assertFalse(ok);
        vm.prank(alice);
        (ok,) = address(ex).call{value: 1 ether}(abi.encodeCall(ex.cancelOrder, (1)));
        assertFalse(ok);
    }

    function test_adminCannotTouchEscrow_noRoleCanWithdraw() public {
        _trade(2 * ONE, 10);
        uint256 held = usdc.balanceOf(address(ex));
        assertGt(held, 0);
        // admin-only and manager-only functions leave escrow untouched
        vm.startPrank(admin);
        ex.setFeeCollector(carol);
        ex.pause();
        ex.unpause();
        ex.suspendMarket(mid);
        ex.resumeMarket(mid);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(ex)), held);
        // admin has no claimable and cannot withdraw escrow
        vm.prank(admin);
        vm.expectRevert(AvantdexExchange.NothingToClaim.selector);
        ex.withdrawClaimable();
    }

    function test_feeCollectorChange_appliesToNextSettlement() public {
        uint256 id = _trade(ONE, 10);
        vm.prank(admin);
        ex.setFeeCollector(carol);
        _openSettlement(1 days);
        uint256 before_ = usdc.balanceOf(carol);
        vm.prank(bob);
        ex.settleTrade(id);
        assertEq(usdc.balanceOf(carol) - before_, 2 * _fee(10 * ONE));
        assertEq(usdc.balanceOf(collector), 0);
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_settledTradeFeesExact(uint32 priceTicks, uint16 lots) public {
        priceTicks = uint32(bound(priceTicks, 100, 1_000_000)); // 1 .. 10_000 USDC per lot
        lots = uint16(bound(lots, 1, 1_000));
        uint128 price = uint128(priceTicks) * TICK;
        uint256 value = uint256(price) * lots;
        usdc.mint(alice, value * 2);
        usdc.mint(bob, value * 2);
        uint256 id = _trade(price, lots);
        _openSettlement(1 days);
        uint256 collectorBefore = usdc.balanceOf(collector);
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        ex.settleTrade(id);
        assertEq(usdc.balanceOf(collector) - collectorBefore, 2 * ((value * 50) / 10_000));
        assertEq(usdc.balanceOf(bob) - bobBefore, 2 * value - (value * 50) / 10_000);
        assertEq(usdc.balanceOf(address(ex)), 0);
    }

    function testFuzz_failurePathsNeverChargeFee(uint32 priceTicks, uint16 lots, bool refundPath) public {
        priceTicks = uint32(bound(priceTicks, 100, 1_000_000));
        lots = uint16(bound(lots, 1, 1_000));
        uint128 price = uint128(priceTicks) * TICK;
        uint256 value = uint256(price) * lots;
        usdc.mint(alice, value * 2);
        usdc.mint(bob, value * 2);
        uint256 id = _trade(price, lots);
        if (refundPath) {
            vm.prank(admin);
            ex.cancelMarket(mid);
            ex.refundTrade(id);
        } else {
            _openSettlement(1 hours);
            vm.warp(block.timestamp + 1 hours + 1);
            vm.prank(alice);
            ex.claimDefault(id);
        }
        assertEq(usdc.balanceOf(collector), 0);
        assertEq(usdc.balanceOf(address(ex)), 0);
    }

    function testFuzz_partialFillsKeepSolvency(uint8 a, uint8 b, uint8 c) public {
        uint128 l1 = uint128(bound(a, 1, 50));
        uint128 l2 = uint128(bound(b, 1, 50));
        uint128 l3 = uint128(bound(c, 1, 50));
        uint256 s1 = _sell(bob, 3 * ONE + TICK * 7, l1 + l2 + l3);
        _buyAgainst(alice, 4 * ONE, l1, _ids(s1));
        _buyAgainst(carol, 4 * ONE, l2, _ids(s1));
        uint256 rest = _buyRest(alice, 2 * ONE, l3);
        _assertSolvent();
        vm.prank(alice);
        ex.cancelOrder(rest);
        _assertSolvent();
    }

    function _assertSolvent() internal view {
        uint256 owed;
        for (uint256 i = 1; i <= ex.orderCount(); ++i) {
            owed += ex.getOrder(i).locked;
        }
        for (uint256 i = 1; i <= ex.tradeCount(); ++i) {
            AvantdexExchange.Trade memory t = ex.getTrade(i);
            if (t.status == AvantdexExchange.TradeStatus.Open) owed += 2 * uint256(t.value) + t.buyerFee;
        }
        owed += ex.claimable(alice) + ex.claimable(bob) + ex.claimable(carol) + ex.claimable(collector)
            + ex.claimable(stranger);
        assertGe(usdc.balanceOf(address(ex)), owed, "solvency");
    }
}

/// @dev Stateful invariant: random order flow can never make the exchange insolvent or charge fees outside settlement.
contract AvantdexHandler is Test {
    AvantdexExchange public ex;
    BlocklistUSDC public usdc;
    MockERC20 public token;
    address public admin;
    uint256 public mid;
    uint64 public tEnd;
    address[] public actors;
    uint256 public settledValue;
    uint256 public totalSettledFees;

    constructor(AvantdexExchange ex_, BlocklistUSDC usdc_, MockERC20 token_, address admin_, uint256 mid_, uint64 tEnd_) {
        ex = ex_;
        usdc = usdc_;
        token = token_;
        admin = admin_;
        mid = mid_;
        tEnd = tEnd_;
        for (uint256 i; i < 4; ++i) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            usdc.mint(a, 10_000_000 * 1e6);
            token.mint(a, 10_000_000 ether);
            vm.startPrank(a);
            usdc.approve(address(ex), type(uint256).max);
            token.approve(address(ex), type(uint256).max);
            vm.stopPrank();
        }
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function place(uint256 actorSeed, bool buy, uint256 priceSeed, uint256 lotsSeed, uint256 makerSeed, bool ioc) external {
        address a = actors[actorSeed % actors.length];
        uint128 price = uint128(bound(priceSeed, 100, 500)) * 1e4; // 1.00 .. 5.00 USDC
        uint128 lots = uint128(bound(lotsSeed, 1, 20));
        uint256 n = ex.orderCount();
        uint256[] memory makers = new uint256[](n > 5 ? 5 : n);
        for (uint256 i; i < makers.length; ++i) {
            makers[i] = n - i;
        }
        makerSeed;
        vm.prank(a);
        try ex.placeOrder(mid, buy ? AvantdexExchange.Side.Buy : AvantdexExchange.Side.Sell, price, lots, tEnd, ioc, ioc ? 1 : 0, makers) {} catch {}
    }

    function cancel(uint256 id) external {
        uint256 n = ex.orderCount();
        if (n == 0) return;
        id = bound(id, 1, n);
        AvantdexExchange.Order memory o = ex.getOrder(id);
        vm.prank(o.owner);
        try ex.cancelOrder(id) {} catch {}
    }

    function settle(uint256 id) external {
        uint256 n = ex.tradeCount();
        if (n == 0) return;
        id = bound(id, 1, n);
        AvantdexExchange.Trade memory t = ex.getTrade(id);
        vm.prank(t.seller);
        try ex.settleTrade(id) {} catch {}
    }

    function claimDefault(uint256 id) external {
        uint256 n = ex.tradeCount();
        if (n == 0) return;
        id = bound(id, 1, n);
        AvantdexExchange.Trade memory t = ex.getTrade(id);
        vm.prank(t.buyer);
        try ex.claimDefault(id) {} catch {}
    }

    function refund(uint256 id) external {
        uint256 n = ex.tradeCount();
        if (n == 0) return;
        id = bound(id, 1, n);
        try ex.refundTrade(id) {} catch {}
    }

    function openSettlement() external {
        vm.prank(admin);
        try ex.openSettlement(mid, address(token), 1 hours) {} catch {}
    }

    function cancelMarket() external {
        vm.prank(admin);
        try ex.cancelMarket(mid) {} catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 2 hours));
    }
}

contract AvantdexInvariantTest is Test {
    AvantdexExchange ex;
    BlocklistUSDC usdc;
    MockERC20 token;
    AvantdexHandler handler;
    address admin = address(0xAD);
    address collector = address(0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6);

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new BlocklistUSDC();
        token = new MockERC20();
        ex = new AvantdexExchange(address(usdc), collector, admin);
        vm.startPrank(admin);
        uint256 mid = ex.createMarket(address(0), 1 ether, 1e4, 1, 1000, uint64(block.timestamp), uint64(block.timestamp + 30 days), 0);
        ex.activateMarket(mid);
        vm.stopPrank();
        handler = new AvantdexHandler(ex, usdc, token, admin, mid, uint64(block.timestamp + 30 days));
        targetContract(address(handler));
    }

    /// @dev USDC held by the exchange always covers every order lock, open-trade escrow and claimable credit.
    function invariant_solvency() public view {
        uint256 owed;
        for (uint256 i = 1; i <= ex.orderCount(); ++i) {
            owed += ex.getOrder(i).locked;
        }
        for (uint256 i = 1; i <= ex.tradeCount(); ++i) {
            AvantdexExchange.Trade memory t = ex.getTrade(i);
            if (t.status == AvantdexExchange.TradeStatus.Open) owed += 2 * uint256(t.value) + t.buyerFee;
        }
        for (uint256 i; i < handler.actorsLength(); ++i) {
            owed += ex.claimable(handler.actors(i));
        }
        owed += ex.claimable(collector);
        assertGe(usdc.balanceOf(address(ex)), owed);
    }

    /// @dev Fees only ever reach the collector through settled trades.
    function invariant_collectorOnlyGetsSettledFees() public view {
        uint256 expected;
        for (uint256 i = 1; i <= ex.tradeCount(); ++i) {
            AvantdexExchange.Trade memory t = ex.getTrade(i);
            if (t.status == AvantdexExchange.TradeStatus.Settled) expected += uint256(t.buyerFee) + t.sellerFee;
        }
        assertEq(usdc.balanceOf(collector) + ex.claimable(collector), expected);
    }
}
