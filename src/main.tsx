import './tracing'
import './console-capture'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { Toaster } from 'sonner'
import { config } from './config'
import App from './App'
import { AuthProvider } from './hooks/useApp'
import { ThemeProvider, useTheme } from './hooks/useTheme'
import './index.css'

const queryClient = new QueryClient()

/** Wallet modal and toasts follow the app theme and the brand colors. */
function ThemedShell() {
  const { dark } = useTheme()
  return (
    <ConnectKitProvider
      mode={dark ? 'dark' : 'light'}
      theme="retro"
      customTheme={{
        '--ck-accent-color': '#262627',
        '--ck-accent-text-color': '#28DF99',
        '--ck-font-family': "'Archivo', system-ui, sans-serif",
      }}
    >
      <AuthProvider>
        <App />
      </AuthProvider>
      <Toaster
        position="top-center"
        theme={dark ? 'dark' : 'light'}
        toastOptions={{ style: { border: '2px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surface)', color: 'var(--ink)', boxShadow: 'var(--shadow-sm)', fontWeight: 600 } }}
      />
    </ConnectKitProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ThemedShell />
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)

