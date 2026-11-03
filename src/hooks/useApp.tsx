/** App-level data: runtime config from the API, wallet-signature session, USDC balance/allowance. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, useReadContract, useSignMessage } from 'wagmi'
import { erc20Abi } from 'viem'
import { arcTestnet } from 'viem/chains'
import { api, tokenStore, type AppConfig } from '@/lib/api'
import { parseError } from '@/lib/errors'

export const CHAIN_ID = arcTestnet.id

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api.get<AppConfig>('/config'), staleTime: 60_000, retry: 1 })
}

// ---------------------------------------------------------------- auth (wallet signature, never moves funds)

interface AuthState {
  address?: string
  roles: string[]
  signedIn: boolean
  signing: boolean
  error?: string
  signIn: () => Promise<boolean>
  signOut: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [session, setSession] = useState<{ address: string; roles: string[] } | null>(null)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string>()

  // a session belongs to one wallet: when the user switches accounts it is dropped together with its token
  // (state adjusted during render, so a later switch back never revives a session whose token is gone)
  if (session && address && session.address !== address.toLowerCase()) {
    tokenStore.clear()
    setSession(null)
  }
  const active = session && address && session.address === address.toLowerCase() ? session : null

  useEffect(() => {
    if (!address) return
    if (!session && tokenStore.get()) {
      api
        .get<{ address: string; roles: string[] }>('/auth/me')
        .then((me) => {
          if (me.address === address.toLowerCase()) setSession(me)
          else tokenStore.clear()
        })
        .catch(() => tokenStore.clear())
    }
  }, [address, session])

  const signIn = useCallback(async () => {
    if (!address) return false
    setSigning(true)
    setError(undefined)
    try {
      const n = await api.post<{ nonce: string; message: string }>('/auth/nonce', { address })
      const signature = await signMessageAsync({ message: n.message })
      const r = await api.post<{ token: string; address: string; roles: string[] }>('/auth/verify', { address, nonce: n.nonce, signature })
      tokenStore.set(r.token)
      setSession({ address: r.address, roles: r.roles })
      return true
    } catch (e) {
      setError(e instanceof Error && 'code' in e ? e.message : parseError(e))
      return false
    } finally {
      setSigning(false)
    }
  }, [address, signMessageAsync])

  useEffect(() => {
    const drop = () => setSession(null)
    window.addEventListener('avantdex:unauthorized', drop)
    return () => window.removeEventListener('avantdex:unauthorized', drop)
  }, [])

  const signOut = useCallback(() => {
    tokenStore.clear()
    setSession(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ address: active?.address, roles: active?.roles ?? [], signedIn: !!active, signing, error, signIn, signOut }),
    [active, signing, error, signIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

// ---------------------------------------------------------------- USDC

export function useUsdc() {
  const { address } = useAccount()
  const { data: cfg } = useConfig()
  const balance = useReadContract({
    address: cfg?.usdc_address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!cfg, refetchInterval: 6000 },
  })
  const allowance = useReadContract({
    address: cfg?.usdc_address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && cfg ? [address, cfg.exchange_address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!cfg, refetchInterval: 6000 },
  })
  return { balance: balance.data, allowance: allowance.data, loading: balance.isLoading || allowance.isLoading }
}
