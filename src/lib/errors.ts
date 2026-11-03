import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'
import { CONTRACT_ERRORS } from '@/lib/exchange'

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
      if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name]
      if (name) return `The contract rejected this action (${name}).`
      if (reverted.reason) return reverted.reason
    }
    const short = error.shortMessage
    if (/insufficient funds/i.test(short)) return 'Not enough USDC for gas. Get test USDC from faucet.circle.com.'
    if (/exceeds (the )?balance|transfer amount exceeds/i.test(short)) return 'Insufficient USDC balance.'
    if (/allowance/i.test(short)) return 'USDC allowance is too low. Approve the amount first.'
    return short
  }
  const msg = (error as { message?: string })?.message ?? ''
  return msg ? msg.slice(0, 160) : 'Something went wrong. Please try again.'
}
