import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

const REVERTS: Record<string, string> = {
  Unsupported: 'This asset is not supported or is not ready to transfer.',
  InvalidName: 'Name must be 1 to 80 characters.',
  InvalidDescription: 'Description must be 500 characters or fewer.',
  InvalidImageUri: 'Image URL must be 256 characters or fewer.',
  InvalidPrice: 'Enter a price above zero.',
  InvalidListing: 'This listing does not exist.',
  InvalidListingStatus: 'This listing is no longer available.',
  InvalidOrder: 'This order does not exist.',
  InvalidOrderStatus: 'This order has already been settled.',
  SelfPurchase: 'You cannot buy your own listing.',
  NotDelivered: 'The rights have not been handed over to the buyer yet.',
  AlreadyDelivered: 'Rights were already delivered. Release the payment instead.',
  DeliveryInFlight: 'A handover to the buyer is pending. The buyer must accept it first.',
  RefundUnavailable: 'A refund is not available yet. The delivery window is still open.',
  Unauthorized: 'Your wallet is not allowed to do this.',
  EnforcedPause: 'The marketplace is paused.',
  ExpectedPause: 'The marketplace is not paused.',
  OwnableUnauthorizedAccount: 'Only the marketplace owner can do this.',
  InvalidDeliveryWindow: 'Delivery window must be between 1 hour and 30 days.',
  RenounceDisabled: 'Renouncing ownership is disabled.',
}

export function isUserRejection(error: unknown): boolean {
  if (error instanceof BaseError) {
    return error.walk((e) => e instanceof UserRejectedRequestError) !== null
  }
  const msg = (error as { message?: string })?.message?.toLowerCase() ?? ''
  return msg.includes('user rejected') || msg.includes('user denied')
}

export function parseError(error: unknown): string {
  if (isUserRejection(error)) return 'Transaction cancelled in your wallet.'
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && REVERTS[name]) return REVERTS[name]
      if (name) return `The contract rejected this action (${name}).`
      if (reverted.reason) return reverted.reason
    }
    const short = error.shortMessage
    if (/insufficient funds/i.test(short)) return 'Not enough USDC for gas. Get test USDC from faucet.circle.com.'
    if (/exceeds (the )?balance/i.test(short)) return 'Insufficient USDC balance.'
    return short
  }
  const msg = (error as { message?: string })?.message ?? ''
  return msg ? msg.slice(0, 160) : 'Something went wrong. Please try again.'
}
