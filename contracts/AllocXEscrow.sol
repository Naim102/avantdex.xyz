// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev WARNING: Tokens and onchain admin/ownership rights are NOT legal company ownership.
 * The marketplace cannot force a project to support transfers.
 */
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Holds USDC per order; only the immutable marketplace can settle deposits.
contract AllocXEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Deposit { address payer; uint256 amount; bool open; }
    struct Claim { address recipient; uint256 amount; }

    IERC20 public immutable usdc;
    address public immutable marketplace;
    mapping(uint256 => Deposit) public deposits;
    uint256 public totalHeld;
    mapping(uint256 => Claim) public claims;

    error Unauthorized();
    error ZeroAddress();
    error InvalidDeposit();
    error DepositExists();
    error DepositClosed();
    error IncorrectAmount();

    event Deposited(uint256 indexed orderId, address indexed payer, uint256 amount);
    event Released(uint256 indexed orderId, address indexed to, uint256 amount);
    event Refunded(uint256 indexed orderId, address indexed payer, uint256 amount);
    event ReleaseDeferred(uint256 indexed orderId, address indexed to, uint256 amount);
    event RefundDeferred(uint256 indexed orderId, address indexed to, uint256 amount);
    event Claimed(uint256 indexed orderId, address indexed to, uint256 amount);

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert Unauthorized();
        _;
    }

    /// @notice Permanently binds the payment token and sole settlement authority.
    constructor(address usdc_, address marketplace_) {
        if (usdc_ == address(0) || marketplace_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        marketplace = marketplace_;
    }

    /// @notice Pulls exactly the order price; the payer must approve this escrow, not the marketplace.
    function deposit(uint256 orderId, address payer, uint256 amount) external onlyMarketplace nonReentrant {
        if (orderId == 0 || payer == address(0) || amount == 0) revert InvalidDeposit();
        if (deposits[orderId].payer != address(0)) revert DepositExists();
        deposits[orderId] = Deposit(payer, amount, true);
        totalHeld += amount;
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(payer, address(this), amount);
        uint256 afterBalance = usdc.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert IncorrectAmount();
        emit Deposited(orderId, payer, amount);
    }

    /// @notice Closes a deposit and pays the marketplace-designated seller after verified delivery.
    /// @dev A failed payment becomes a claim without reverting settlement; its funds remain held.
    function release(uint256 orderId, address to) external onlyMarketplace nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = _close(orderId);
        if (_tryTransfer(to, amount)) {
            emit Released(orderId, to, amount);
        } else {
            _defer(orderId, to, amount);
            emit ReleaseDeferred(orderId, to, amount);
        }
    }

    /// @notice Withdraws a deferred payment or refund exclusively to its designated recipient.
    /// @dev A failed transfer reverts, preserving the claim and its held-funds accounting.
    function claim(uint256 orderId) external nonReentrant {
        Claim memory c = claims[orderId];
        if (msg.sender != c.recipient) revert Unauthorized();
        delete claims[orderId];
        totalHeld -= c.amount;
        usdc.safeTransfer(msg.sender, c.amount);
        emit Claimed(orderId, msg.sender, c.amount);
    }

    /// @notice Closes a deposit and returns payment exclusively to its original payer.
    /// @dev A failed payment (for example a blocklisted payer) becomes a claim for the payer instead of
    /// reverting, so the order still settles and the listing is reopened. Funds remain held until claimed.
    function refund(uint256 orderId) external onlyMarketplace nonReentrant {
        uint256 amount = _close(orderId);
        address payer = deposits[orderId].payer;
        if (_tryTransfer(payer, amount)) {
            emit Refunded(orderId, payer, amount);
        } else {
            _defer(orderId, payer, amount);
            emit RefundDeferred(orderId, payer, amount);
        }
    }

    function _tryTransfer(address to, uint256 amount) private returns (bool) {
        (bool ok, bytes memory result) = address(usdc).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        uint256 returned;
        if (result.length >= 32) {
            assembly ("memory-safe") { returned := mload(add(result, 0x20)) }
        }
        return ok && (result.length == 0 || (result.length >= 32 && returned == 1));
    }

    function _defer(uint256 orderId, address to, uint256 amount) private {
        claims[orderId] = Claim({recipient: to, amount: amount});
        totalHeld += amount;
    }

    function _close(uint256 orderId) private returns (uint256 amount) {
        Deposit storage d = deposits[orderId];
        if (!d.open) revert DepositClosed();
        d.open = false;
        amount = d.amount;
        totalHeld -= amount;
    }
}
