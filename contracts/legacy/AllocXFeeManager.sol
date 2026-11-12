// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAllocXFeeManager} from "./interfaces/IAllocX.sol";

/// @title AllocXFeeManager
/// @notice Distributes pre-funded USDC payments with a capped, seller-only fee.
/// @dev USDC amounts use the token's six-decimal ERC-20 units. There is no native-value entry point.
contract AllocXFeeManager is AccessControl, ReentrancyGuard, IAllocXFeeManager {
    using SafeERC20 for IERC20;

    bytes32 public constant FEE_ADMIN_ROLE = keccak256("FEE_ADMIN_ROLE");
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
    uint16 public constant MAX_FEE_BPS = 1000;
    uint16 public constant DEFAULT_FEE_BPS = 200;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    IERC20 public immutable usdc;
    address public treasury;
    uint16 public defaultFeeBps;
    mapping(uint256 => uint16) public projectFeeBps;
    mapping(uint256 => bool) public hasProjectFee;
    uint256 public totalFeesCollected;
    uint256 public totalVolume;
    /// @notice Retained balance, including all pending payouts, unavailable for reuse as fresh funding.
    uint256 public accounted;
    /// @notice Deferred USDC payouts owed to each recipient.
    mapping(address => uint256) public pending;

    error ZeroAddress();
    error NotAContract(address target);
    error InvalidRecipient();
    error FeeTooHigh(uint16 bps);
    error ZeroGross();
    error NoPendingPayout();
    error InsufficientFunding(uint256 available, uint256 required);
    error UnexpectedBalanceChange(uint256 expected, uint256 actual);

    event DefaultFeeUpdated(uint16 previousBps, uint16 newBps);
    event ProjectFeeUpdated(uint256 indexed projectId, uint16 bps);
    event ProjectFeeCleared(uint256 indexed projectId);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event PaymentDistributed(uint256 indexed projectId, address indexed seller, uint256 gross,
        uint256 fee, uint256 net, address indexed treasury);
    event PayoutDeferred(address indexed account, uint256 amount);
    event PendingWithdrawn(address indexed account, address indexed to, uint256 amount);
    event AccountedBalanceUpdated(uint256 previousBalance, uint256 newBalance);
    event USDCConfigured(address indexed usdc);

    /// @param admin Initial default administrator; operational roles are granted separately.
    /// @param usdc_ USDC ERC-20 contract, not the native-value representation.
    /// @param treasury_ Nonzero external fee recipient.
    /// @param defaultFeeBps_ Initial seller fee, conventionally 200 (2%), at most 1000.
    constructor(address admin, address usdc_, address treasury_, uint16 defaultFeeBps_) {
        if (admin == address(0) || usdc_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (usdc_.code.length == 0) revert NotAContract(usdc_);
        if (treasury_ == address(this)) revert InvalidRecipient();
        if (defaultFeeBps_ > MAX_FEE_BPS) revert FeeTooHigh(defaultFeeBps_);
        usdc = IERC20(usdc_);
        treasury = treasury_;
        defaultFeeBps = defaultFeeBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        emit USDCConfigured(usdc_);
        emit TreasuryUpdated(address(0), treasury_);
        emit DefaultFeeUpdated(0, defaultFeeBps_);
    }

    /// @notice Set the fallback seller fee; buyers never pay an additional fee.
    function setDefaultFee(uint16 bps) external onlyRole(FEE_ADMIN_ROLE) {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh(bps);
        uint16 previous = defaultFeeBps;
        defaultFeeBps = bps;
        emit DefaultFeeUpdated(previous, bps);
    }

    /// @notice Set an explicit project fee, including a zero-fee override.
    function setProjectFee(uint256 projectId, uint16 bps) external onlyRole(FEE_ADMIN_ROLE) {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh(bps);
        projectFeeBps[projectId] = bps;
        hasProjectFee[projectId] = true;
        emit ProjectFeeUpdated(projectId, bps);
    }

    /// @notice Remove an override so the project follows the default fee again.
    function clearProjectFee(uint256 projectId) external onlyRole(FEE_ADMIN_ROLE) {
        delete projectFeeBps[projectId];
        delete hasProjectFee[projectId];
        emit ProjectFeeCleared(projectId);
    }

    /// @notice Change the external fee recipient.
    function setTreasury(address newTreasury) external onlyRole(FEE_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        if (newTreasury == address(this)) revert InvalidRecipient();
        address previous = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(previous, newTreasury);
    }

    /// @notice Effective project seller fee, in basis points.
    function feeBps(uint256 projectId) public view override returns (uint16) {
        return hasProjectFee[projectId] ? projectFeeBps[projectId] : defaultFeeBps;
    }

    /// @notice Fee rounded down and seller net. Uses full-precision multiplication.
    function quote(uint256 projectId, uint256 amount) public view override returns (uint256 fee, uint256 net) {
        fee = Math.mulDiv(amount, feeBps(projectId), BPS_DENOMINATOR);
        net = amount - fee;
    }

    /// @notice Pay out fresh pre-funding using the fee snapshotted by the authorized escrow.
    /// @dev Failed pushes become pending payouts. All retained funds are checkpointed so neither
    ///      pending liabilities nor residual balances can be reused as fresh escrow funding.
    function distribute(address seller, uint256 gross, uint256 projectId, uint16 feeBpsSnapshot)
        external override onlyRole(ESCROW_ROLE) nonReentrant returns (uint256 fee, uint256 net)
    {
        if (seller == address(0)) revert ZeroAddress();
        if (seller == address(this)) revert InvalidRecipient();
        if (gross == 0) revert ZeroGross();
        if (feeBpsSnapshot > MAX_FEE_BPS) revert FeeTooHigh(feeBpsSnapshot);
        uint256 balanceBefore = usdc.balanceOf(address(this));
        uint256 previousAccounted = accounted;
        uint256 available = balanceBefore >= previousAccounted ? balanceBefore - previousAccounted : 0;
        if (available < gross) revert InsufficientFunding(available, gross);
        fee = Math.mulDiv(gross, feeBpsSnapshot, BPS_DENOMINATOR);
        net = gross - fee;
        address feeRecipient = treasury;
        totalFeesCollected += fee;
        totalVolume += gross;
        accounted = balanceBefore - gross;
        _pushOrDefer(feeRecipient, fee);
        _pushOrDefer(seller, net);
        uint256 balanceAfter = usdc.balanceOf(address(this));
        if (balanceAfter != accounted) revert UnexpectedBalanceChange(accounted, balanceAfter);
        emit AccountedBalanceUpdated(previousAccounted, accounted);
        emit PaymentDistributed(projectId, seller, gross, fee, net, feeRecipient);
    }

    /// @notice Withdraw all of the caller's deferred USDC to a nonzero external recipient.
    /// @dev A failed withdrawal reverts, preserving the caller's pending balance.
    function withdrawPending(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (to == address(this)) revert InvalidRecipient();
        uint256 amount = pending[msg.sender];
        if (amount == 0) revert NoPendingPayout();
        uint256 balanceBefore = usdc.balanceOf(address(this));
        uint256 previousAccounted = accounted;
        pending[msg.sender] = 0;
        accounted = previousAccounted - amount;
        usdc.safeTransfer(to, amount);
        uint256 balanceAfter = usdc.balanceOf(address(this));
        uint256 expected = balanceBefore - amount;
        if (balanceAfter != expected) revert UnexpectedBalanceChange(expected, balanceAfter);
        emit AccountedBalanceUpdated(previousAccounted, accounted);
        emit PendingWithdrawn(msg.sender, to, amount);
    }

    /// @notice Returns the recipient's deferred USDC balance.
    function pendingOf(address account) external view returns (uint256) { return pending[account]; }

    function _pushOrDefer(address account, uint256 amount) private {
        if (amount != 0 && !usdc.trySafeTransfer(account, amount)) {
            pending[account] += amount;
            accounted += amount;
            emit PayoutDeferred(account, amount);
        }
    }
}
