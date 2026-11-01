# AllocX contract design (Arc only)

Shared types and interfaces live in `contracts/interfaces/IAllocX.sol` (do not change signatures; add only if unavoidable). Solidity 0.8.28, OpenZeppelin 5.6.1 (`@openzeppelin/contracts/...`), Cancun EVM. Every module: `AccessControl`, custom errors, an event for every state change, NatSpec. All USDC amounts are the 6-decimal ERC-20 view; contracts never touch native value (reject `msg.value`, no `receive`).

## Trust model
- Submitting a project proves nothing. A project trades only when a CURATOR activates it AND the seller provably controls every listed item onchain at listing time and again at purchase time.
- Holding an ERC-20 never implies owning a project. Unknown contracts are unsupported: control checks use `staticcall`/try-catch and return `false` (never revert) for non-conforming targets.
- Payment is released from escrow only after Settlement verifies the resulting onchain state itself. No backend input ever moves funds.
- Admin: bootstrapper hands every DEFAULT_ADMIN_ROLE to `finalAdmin` (intended to be a multisig) and renounces its own.

## Roles
- ProjectRegistry: `CURATOR_ROLE`, `SETTLEMENT_ROLE`
- AdapterRegistry: `ADAPTER_ADMIN_ROLE`
- Verification: `ATTESTOR_ROLE`, `CONSUMER_ROLE` (Settlement)
- FeeManager: `FEE_ADMIN_ROLE`, `ESCROW_ROLE`
- AssetManager: `SETTLEMENT_ROLE`
- OwnershipManager: none (pure view logic), constructor takes AdapterRegistry
- Escrow: `SETTLEMENT_ROLE`
- Marketplace: `PAUSER_ROLE`, `MODERATOR_ROLE`, `SETTLEMENT_ROLE`
- Settlement: `PAUSER_ROLE`, `DISPUTE_ROLE` (DisputeManager)
- DisputeManager: `ARBITRATOR_ROLE`

## Modules

### AllocXProjectRegistry(admin)
- `submitProject(ProjectCategory category, address mainContract, address claimedOwner, address[] related, bytes32 metadataHash, string metadataURI) returns (uint256)`: anyone, status Pending, ids from 1. `mainContract` must be a contract (code length > 0) and not already mapped to a Pending/Active/Suspended project; related max 20, each a contract and unmapped. Emits `ProjectSubmitted(id, submitter, mainContract, category, claimedOwner, metadataHash, metadataURI)` and `ContractLinked(id, contract)`. Mappings `projectOfContract`.
- CURATOR: `activateProject`, `suspendProject`, `rejectProject` (rejected frees the contract mappings), `reinstate`.
- `projectAdmin(id)` = `verifiedOwner` if set, else `submitter`. `projectAdmin` can `updateMetadata(id, hash, uri)` and `addRelatedContract(id, c)` (same rules, max 20 total).
- `recordTransfer(...)` (SETTLEMENT_ROLE): if `controlTransferred` set `verifiedOwner = to`; always emit `OwnershipRecorded(projectId, from, to, orderId, itemsHash, controlTransferred)`. Keep a per-project history length counter.
- Views: `getProject`, `projectCount`, `isActive`, `projectOfContract`, `relatedContracts(id)`.

### AllocXAdapterRegistry(admin)
- ADAPTER_ADMIN: `approveAdapter(adapter, target, description)`, `revokeAdapter(adapter, target)`, `approveAdapterBatch`. `isApproved(adapter, target)`. Requires adapter to be a contract. Events. `adapterTargets` not needed; keep an `adapterDescription` string stored.

### AllocXVerification(admin, registry)
- EIP-712 (`EIP712("AllocXVerification","1")`, `SignatureChecker` so ERC-1271 wallets work).
- `verifyProjectControl(projectId, subject)`: anyone, project must exist. Checks `subject` is `owner()` of `mainContract` (Ownable, method Ownable) or has `DEFAULT_ADMIN_ROLE` (AccessControl, method AccessControl) via try/catch. On success store `ProjectVerification{subject, method, verifiedAt}` and emit `ProjectControlVerified`. Revert `NotController` otherwise.
- `submitAttestation(OwnershipAttestation att, bytes sig)`: anyone relays; signer must hold ATTESTOR_ROLE; `expiry > now`; per-signer nonce unused; stores `attestations[projectId][subject] = expiry` and emits event. Typed hash `OwnershipAttestation(uint256 projectId,address subject,bytes32 claimHash,uint64 expiry,uint256 nonce)`.
- `hasValidAttestation(projectId, subject)`, `verificationOf(projectId)` and `isVerified(projectId, subject)` = control verified (and still true if re-checked live via `currentControl`) or valid attestation. `currentControl(projectId, subject) view` re-runs the live check.
- `consumeSaleAuthorization(SaleAuthorization auth, bytes sig)` (CONSUMER_ROLE): `block.timestamp <= auth.deadline`, signature valid for `auth.seller` over typed hash `SaleAuthorization(uint256 orderId,address seller,address buyer,bytes32 itemsHash,uint256 nonce,uint64 deadline)`, `usedNonces[seller][nonce]` unused, then mark used. Expose `saleAuthorizationDigest(auth) view` and `DOMAIN_SEPARATOR()`.

### AllocXFeeManager(admin, treasury, defaultFeeBps)
- Seller fee only (buyer fee 0). `MAX_FEE_BPS = 1000`. Default 200 (2%). `setDefaultFee`, `setProjectFee(projectId, bps)`, `clearProjectFee(projectId)`, `setTreasury` (nonzero). `feeBps(projectId)` (override else default). `quote(projectId, amount)` fee rounded down (`amount*bps/10_000`).
- `distribute(seller, gross, projectId)` (ESCROW_ROLE, nonReentrant): requires its USDC balance to have received `gross` (track `accounted` or compare balance deltas safely), pays fee to treasury and net to seller via SafeERC20, tracks `totalFeesCollected`, `totalVolume`, emits `PaymentDistributed(projectId, seller, gross, fee, net, treasury)`. Takes `usdc` in constructor too: `(admin, usdc, treasury, defaultFeeBps)`.

### AllocXAssetManager(admin)
- `controls(item, account, requireApproval)` for ERC20/721/1155 only (other kinds return false): balance/ownership sufficient and, when `requireApproval`, this contract is approved (ERC20 allowance >= amount; ERC721 getApproved or isApprovedForAll; ERC1155 isApprovedForAll). All external calls via try/catch.
- `pull(item, from, to)` (SETTLEMENT_ROLE, nonReentrant): ERC20 `safeTransferFrom` and require the recipient's balance delta >= amount (rejects fee-on-transfer shortfalls); ERC721 `safeTransferFrom`, then require `ownerOf == to`; ERC1155 `safeTransferFrom` and delta check. Reverts `UnsupportedKind` for control-right kinds. Emits `AssetPulled`.

### AllocXOwnershipManager(admin, adapterRegistry)
View-only verification for kinds OWNABLE, OWNABLE_2STEP, ACCESS_ROLE, ADAPTER:
- `controls(item, account)`: OWNABLE/2STEP `owner()==account`; ACCESS_ROLE `hasRole(bytes32(item.id), account)`; ADAPTER requires `registry.isApproved(adapter, target)` and `adapter.isController(...)`.
- `isTransferred(item, from, to)`: OWNABLE `owner()==to`; 2STEP `owner()==to && pendingOwner()!=to` (accepted); ACCESS_ROLE `hasRole(role,to) && !hasRole(role,from)`; ADAPTER `isController(to) && !isController(from)`.
- `isPending(item, to)`: 2STEP `pendingOwner()==to`; ADAPTER `isPendingController`; others false.
- Never reverts on a bad target (try/catch => false). `supportsKind(kind)` pure.

### AllocXEscrow(admin, usdc, feeManager)
- `deposit(orderId, payer, amount)` (SETTLEMENT_ROLE, nonReentrant): one deposit per orderId, `safeTransferFrom(payer, this, amount)`, require balance delta == amount.
- `release(orderId, seller, projectId)`: state Held -> Released; transfer to FeeManager, call `distribute`; returns fee,net.
- `refund(orderId)`: Held -> Refunded; `safeTransfer(payer, amount)`.
- `heldAmount(orderId)`, `depositOf(orderId)` returns payer/amount/state. `totalHeld()` accounting equals sum of Held deposits (invariant: USDC balance >= totalHeld). No other way out: no admin withdraw, no sweep.

### AllocXMarketplace(admin, registry, assetManager, ownershipManager)
- `setSettlement(address)`: DEFAULT_ADMIN once only (reverts if set).
- `createListing(uint256 projectId, Item[] items, uint256 price, uint64 expiry, uint32 settlementWindow, bool autoSettle, bytes32 metadataHash) returns (uint256)` (whenNotPaused, nonReentrant). Checks: project active; `1 <= items.length <= 10`; `price >= 1_000_000` (1 USDC) hmm use constant `MIN_PRICE = 1e6` ; `expiry` in (now, now+365d]; `settlementWindow` in [1 hour, 30 days]; each item well formed (kind specific amount/id/adapter rules: ERC20 amount>0; ERC721 amount==1; ERC1155 amount>0; control rights amount==0; ADAPTER needs adapter!=0 and registry approved (via ownershipManager.controls check); non-ADAPTER requires adapter==0 and extra==0), `registry.projectOfContract(item.target) == projectId`, `msg.sender` controls the item (token kinds: `requireApproval = autoSettle`; control kinds via OwnershipManager). `autoSettle` requires ALL items to be token kinds. Duplicate prevention: per item `key = keccak256(kind,target,id)` for control rights, plus seller for token kinds; if `itemListing[key]` points to a listing that is Active-and-unexpired or Reserved => revert `DuplicateListing`; otherwise overwrite. Items with duplicate keys inside one listing revert. Store items. `itemsHash = keccak256(abi.encode(items))`. Emit `ListingCreated(listingId, projectId, seller, price, expiry, itemsHash, autoSettle, settlementWindow, metadataHash)` and one `ListingItem(listingId, index, kind, target, id, amount, adapter, extra)` per item. ids from 1.
- `updateListing(listingId, newPrice, newExpiry)` seller, status Active only.
- `cancelListing(listingId)` seller (Active only; Reserved listings cannot be cancelled, the order must settle/refund). `moderatorCancel(listingId)` MODERATOR_ROLE (Active only). `cancelStale(listingId)` anyone: Active and (expired OR seller no longer controls some item OR project not active) => Cancelled.
- `buy(uint256 listingId, uint256 maxPrice) returns (uint256 orderId)` (whenNotPaused, nonReentrant): listing Active, not expired, `msg.sender != seller`, `price <= maxPrice`, project active, seller still controls all items (token kinds with requireApproval = autoSettle); set status Reserved; `orderId = settlement.openOrder(listingId, msg.sender)`; store `listing.orderId`. Emit `ListingReserved(listingId, orderId, buyer)`.
- Settlement hooks (SETTLEMENT_ROLE): `onOrderSettled` -> Sold, `onOrderReopened` -> Active if not expired, else Cancelled.
- Views: `getListing`, `getItems`, `listingCount`, `isLive(listingId)`, `hashItems(Item[])`.
- Pausable (PAUSER_ROLE pause/unpause).

### AllocXSettlement(admin, marketplace, escrow, assetManager, ownershipManager, verification, registry)
- `openOrder(listingId, buyer)` (only the Marketplace address): reads listing (must be Reserved, orderId 0 or stale), creates `Order` (Funded, deadline = now + window), `escrow.deposit(orderId, buyer, price)`, emits `OrderOpened(orderId, listingId, projectId, buyer, seller, price, deadline, itemsHash)`; if `autoSettle`, immediately `_complete(orderId, true)` so the purchase is atomic (whole tx reverts if the seller's approvals are missing). Ids from 1.
- Settlement paths (nonReentrant, whenNotPaused):
  - `settleBySeller(orderId)`: `msg.sender == seller`; `_complete(orderId, allowPull=true)`.
  - `settleWithAuthorization(orderId, SaleAuthorization auth, bytes sig)`: anyone relays; checks `auth.orderId==orderId`, `auth.seller==order.seller`, `auth.buyer==order.buyer`, `auth.itemsHash==order.itemsHash`; `verification.consumeSaleAuthorization(auth, sig)`; `_complete(orderId, true)`.
  - `confirm(orderId)`: permissionless; `_complete(orderId, false)`: only succeeds if the bundle has NO token items and every control item `isTransferred(item, seller, buyer)` is already true.
- `_complete(orderId, allowPull)`: order must be Funded and `now <= deadline + 1 days`(grace) hmm only require Funded; for each item: token kind -> require allowPull else revert `SellerAuthorizationRequired`, then `assetManager.pull(item, seller, buyer)`; control kind -> require `ownershipManager.isTransferred(item, seller, buyer)` else revert `OwnershipNotTransferred(index)`. Then status Settled, `escrow.release(orderId, seller, projectId)`, `marketplace.onOrderSettled(listingId)`, `registry.recordTransfer(projectId, seller, buyer, orderId, itemsHash, hasControlItem)`, emit `OrderSettled(orderId, listingId, buyer, seller, fee, net, controlTransferred)`. Follow checks-effects-interactions (set status before external calls).
- `refund(orderId)`: Funded only. Seller may refund any time. Buyer or anyone may refund once `now > deadline`; if the bundle has no token items and all control items are already transferred, revert `AlreadyDelivered` (use `confirm`). Sets Refunded, `escrow.refund`, `marketplace.onOrderReopened`, emit `OrderRefunded(orderId, listingId, buyer, amount, reason)`. NOT paused-gated (refunds must always work).
- Disputes: `markDisputed(orderId)` (DISPUTE_ROLE) Funded -> Disputed (blocks settle/refund until resolved). `resolveDispute(orderId, releaseToSeller)` (DISPUTE_ROLE) Disputed -> Settled (escrow.release, marketplace.onOrderSettled, registry.recordTransfer with controlTransferred = bundle-has-control-items AND all verified transferred) or Refunded (escrow.refund, marketplace.onOrderReopened). Emit `DisputeResolved`.
- `getOrder`, `orderCount`, `orderItemsFor(orderId)` convenience (reads marketplace items).
- Pausable (PAUSER_ROLE) for openOrder/settle/confirm only.

### AllocXDisputeManager(admin, settlement)
- `openDispute(orderId, bytes32 reasonHash, string reasonURI)`: caller must be order buyer or seller, order Funded; once per order; calls `settlement.markDisputed`. `submitEvidence(orderId, string uri)` by buyer/seller while open. `resolve(orderId, bool releaseToSeller, bytes32 rulingHash)` ARBITRATOR_ROLE -> `settlement.resolveDispute`. `RESOLUTION_TIMEOUT = 14 days`: if unresolved after timeout anyone calls `expireDispute(orderId)` -> refund to buyer (defined default policy). Records `Dispute{orderId, opener, openedAt, status(Open,ResolvedSeller,ResolvedBuyer,Expired), rulingHash}`. Events for each.

### AllocXDeployer (bootstrapper, constructor only)
`constructor(address finalAdmin, address usdc, address treasury, uint16 defaultFeeBps)`. Order: Registry, AdapterRegistry, Verification, FeeManager, AssetManager, OwnershipManager, Escrow, Marketplace, Settlement, DisputeManager, each constructed with `admin = address(this)`. Wire: Escrow.SETTLEMENT_ROLE->Settlement; FeeManager.ESCROW_ROLE->Escrow; AssetManager.SETTLEMENT_ROLE->Settlement; Marketplace.SETTLEMENT_ROLE->Settlement + `setSettlement`; Registry.SETTLEMENT_ROLE->Settlement; Verification.CONSUMER_ROLE->Settlement; Settlement.DISPUTE_ROLE->DisputeManager. Then for finalAdmin (nonzero, not the deployer itself): grant DEFAULT_ADMIN_ROLE on every AccessControl module plus operational roles (CURATOR, ADAPTER_ADMIN, ATTESTOR, FEE_ADMIN, PAUSER on Marketplace and Settlement, MODERATOR, ARBITRATOR), then `renounceRole(DEFAULT_ADMIN_ROLE, address(this))` on every module. Store all ten module addresses as public immutables-or-vars, emit `AllocXDeployed(...)` with all addresses. Deployer holds no roles at the end. If total initcode exceeds 49152 bytes, report it rather than silently splitting.

## Events
Every module emits events for all state changes (the Postgres indexer reads them). Use indexed ids where useful.

## Revision 2 (initcode limit): two bootstrappers, no cross-group roles
A single bootstrapper exceeds the 49,152 byte initcode limit, so deployment is split into two constructor-only bootstrappers and the design drops every role that group 2 needed on group 1:
- `AllocXCoreDeployer(finalAdmin)` deploys ProjectRegistry, AdapterRegistry, Verification, OwnershipManager (admin = itself), grants finalAdmin DEFAULT_ADMIN + CURATOR, ADAPTER_ADMIN, ATTESTOR, renounces its own admin roles. Public getters for the four addresses; event `CoreDeployed`.
- `AllocXMarketDeployer(finalAdmin, usdc, treasury, defaultFeeBps, registry, verification, ownershipManager)` deploys FeeManager, AssetManager, Escrow, Marketplace, Settlement, DisputeManager, wires the roles (Escrow.SETTLEMENT->Settlement, FeeManager.ESCROW->Escrow, AssetManager.SETTLEMENT->Settlement, Marketplace.SETTLEMENT->Settlement + setSettlement, Settlement.DISPUTE->DisputeManager), grants finalAdmin DEFAULT_ADMIN + FEE_ADMIN, PAUSER (Marketplace, Settlement), MODERATOR, ARBITRATOR, renounces its own. Public getters; event `MarketDeployed`. Replace `AllocXDeployer.sol` (delete it).
- Registry: remove `SETTLEMENT_ROLE` and `recordTransfer`. `getProject().verifiedOwner` is computed LIVE (try `Ownable(mainContract).owner()`, 0 if not Ownable/reverts). `projectAdmin(id)` = that live owner if nonzero else `submitter`. Ownership history is the Settlement `OrderSettled` event.
- Verification: remove `CONSUMER_ROLE` and `consumeSaleAuthorization`; add `verifySaleAuthorization(SaleAuthorization, bytes) external view` (deadline + signature via SignatureChecker, no state). Keep `saleAuthorizationDigest`.
- Settlement: store `mapping(address seller => mapping(uint256 nonce => bool)) usedNonces`; in `settleWithAuthorization` call `verification.verifySaleAuthorization`, require nonce unused, mark used BEFORE completing. Remove the registry dependency and the `recordTransfer` call (constructor becomes `(admin, marketplace, escrow, assetManager, ownershipManager, verification)`); `OrderSettled` already carries seller, buyer, projectId, itemsHash, controlTransferred so the indexer can build ownership history.

## Revision 3 (audit fixes) - apply exactly these
1. **Delivery claims (refund-after-delivery exploit).** Settlement gets `mapping(uint256 => bool) public deliveryClaimed` and `claimDelivery(orderId)`: seller only, order Funded, bundle has >= 1 control item and EVERY control item currently `isTransferred(item, seller, buyer)`, else revert `DeliveryNotVerified`; sets the flag, emits `DeliveryClaimed(orderId)`. `refund(orderId)`: the seller may always refund; anyone else reverts `DeliveryClaimed` if the flag is set (in addition to the existing deadline and AlreadyDelivered rules). Add `deliveryVerified(orderId) view` = flag set && no token items && all control items currently transferred.
2. **Dispute timeout.** `AllocXDisputeManager.expireDispute`: call `settlement.deliveryVerified(orderId)`; if true resolve `releaseToSeller = true`, else refund the buyer. Status `Expired` either way.
3. **Pull fallback payouts.** FeeManager `distribute` still tries to push to seller and treasury using OpenZeppelin `SafeERC20.trySafeTransfer`; if a push fails (e.g. blocklisted recipient) it credits `pending[account]` and emits `PayoutDeferred(account, amount)`. Add `withdrawPending(address to)` (nonReentrant, caller's pending balance, `to` nonzero) and `pendingOf(account)`. Accounting must keep USDC balance >= sum of pending. Settlement/Escrow never revert because a recipient is blocked.
4. **Canonical duplicate keys.** In Marketplace `_itemKey` treat OWNABLE and OWNABLE_2STEP as the same kind (use OWNABLE for hashing) so one ownership right cannot sit in two live listings.
5. **Authorisation binding.** `SaleAuthorization` now has `price` and `settlement` (see IAllocX.sol). Verification typehash becomes `SaleAuthorization(uint256 orderId,address seller,address buyer,bytes32 itemsHash,uint256 price,address settlement,uint256 nonce,uint64 deadline)`. Settlement.settleWithAuthorization additionally requires `auth.price == order.price` and `auth.settlement == address(this)`.
6. **Fee snapshot.** Escrow `deposit(orderId, payer, amount, projectId)` stores projectId and `feeBps = feeManager.feeBps(projectId)` at deposit time; `release(orderId, seller)` uses the stored values and calls `distribute(seller, gross, projectId, feeBpsSnapshot)`. FeeManager.distribute enforces `feeBpsSnapshot <= MAX_FEE_BPS` and uses it (no live lookup). Settlement passes projectId to `deposit` and no longer to `release`.
7. **Constructor validation.** Settlement (all six dependencies), Marketplace (registry, assetManager, ownershipManager) and MarketDeployer (registry, verification, ownershipManager) revert on addresses with no code. Keep bytecode small: MarketDeployer initcode must stay under 49,152 bytes (currently ~47,790), so avoid adding bulk there; report the final sizes.
