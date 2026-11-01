import { useCallback, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import type { Abi, Hash, TransactionReceipt } from 'viem'
import { CHAIN_ID } from '@/lib/allocx'
import { isUserRejection, parseError } from '@/lib/errors'

export type TxPhase = 'idle' | 'wallet' | 'confirming' | 'success' | 'error'

export interface TxStep {
  label: string
  hash: Hash
}

export interface TxState {
  phase: TxPhase
  label: string
  hash?: Hash
  error?: string
  steps: TxStep[]
}

export interface TxRequest {
  address: `0x${string}`
  abi: Abi | readonly unknown[]
  functionName: string
  args?: readonly unknown[]
}

const IDLE: TxState = { phase: 'idle', label: '', steps: [] }

/**
 * Runs wallet transactions one at a time. Every transaction needs a wallet confirmation,
 * and success is only reported after the receipt is mined and has status "success".
 */
export function useTx() {
  const { isConnected, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()
  const [state, setState] = useState<TxState>(IDLE)

  const reset = useCallback(() => setState(IDLE), [])

  const run = useCallback(
    async (label: string, request: TxRequest): Promise<TransactionReceipt | null> => {
      if (!isConnected || !publicClient) {
        setState((s) => ({ ...s, phase: 'error', label, error: 'Connect your wallet to continue.' }))
        return null
      }
      setState((s) => ({ ...s, phase: 'wallet', label, hash: undefined, error: undefined }))
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        const hash = await writeContractAsync({
          chainId: CHAIN_ID,
          address: request.address,
          abi: request.abi as Abi,
          functionName: request.functionName,
          args: request.args as unknown[] | undefined,
        })
        setState((s) => ({ ...s, phase: 'confirming', hash }))
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') {
          setState((s) => ({ ...s, phase: 'error', hash, error: 'The transaction was mined but reverted onchain.' }))
          return null
        }
        setState((s) => ({ ...s, phase: 'success', hash, steps: [...s.steps, { label, hash }] }))
        await queryClient.invalidateQueries()
        return receipt
      } catch (e) {
        if (isUserRejection(e)) {
          setState((s) => ({ ...s, phase: 'idle', hash: undefined, error: undefined }))
        } else {
          setState((s) => ({ ...s, phase: 'error', error: parseError(e) }))
        }
        return null
      }
    },
    [isConnected, chainId, publicClient, switchChainAsync, writeContractAsync, queryClient],
  )

  return { ...state, run, reset, busy: state.phase === 'wallet' || state.phase === 'confirming' }
}
