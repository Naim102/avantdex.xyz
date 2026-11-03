import { useCallback, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { parseGwei, type Abi, type Hash, type TransactionReceipt } from 'viem'
import { arcTestnet } from 'viem/chains'
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
const MIN_MAX_FEE = parseGwei('20') // Arc guidance: set maxFeePerGas to at least 20 gwei

/**
 * Runs wallet transactions one at a time.
 * - the call is simulated first, so contract errors are explained before the wallet opens
 * - maxFeePerGas is never below 20 gwei (Arc guidance)
 * - success is only reported after the receipt is mined with status "success"
 */
export function useTx() {
  const { isConnected, chainId, address } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const queryClient = useQueryClient()
  const [state, setState] = useState<TxState>(IDLE)

  const reset = useCallback(() => setState(IDLE), [])

  const run = useCallback(
    async (label: string, request: TxRequest): Promise<TransactionReceipt | null> => {
      if (!isConnected || !publicClient || !address) {
        setState((s) => ({ ...s, phase: 'error', label, error: 'Connect your wallet to continue.' }))
        return null
      }
      setState((s) => ({ ...s, phase: 'wallet', label, hash: undefined, error: undefined }))
      try {
        if (chainId !== arcTestnet.id) await switchChainAsync({ chainId: arcTestnet.id })
        const call = {
          account: address,
          address: request.address,
          abi: request.abi as Abi,
          functionName: request.functionName,
          args: request.args as unknown[] | undefined,
        }
        await publicClient.simulateContract(call) // throws a readable contract error before the wallet prompt
        let maxFeePerGas = MIN_MAX_FEE
        let maxPriorityFeePerGas: bigint | undefined
        try {
          const fees = await publicClient.estimateFeesPerGas()
          if (fees.maxFeePerGas && fees.maxFeePerGas > maxFeePerGas) maxFeePerGas = fees.maxFeePerGas
          maxPriorityFeePerGas = fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas <= maxFeePerGas ? fees.maxPriorityFeePerGas : undefined
        } catch {
          /* use the floor */
        }
        const hash = await writeContractAsync({
          chainId: arcTestnet.id,
          address: request.address,
          abi: request.abi as Abi,
          functionName: request.functionName,
          args: request.args as unknown[] | undefined,
          maxFeePerGas,
          ...(maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas } : {}),
        })
        setState((s) => ({ ...s, phase: 'confirming', hash }))
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') {
          setState((s) => ({ ...s, phase: 'error', hash, error: 'The transaction was mined but reverted on-chain.' }))
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
    [isConnected, chainId, address, publicClient, switchChainAsync, writeContractAsync, queryClient],
  )

  return { ...state, run, reset, busy: state.phase === 'wallet' || state.phase === 'confirming' }
}
