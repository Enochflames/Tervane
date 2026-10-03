// Everything behind /app: wallet + query providers, layout and pages. Lazy-loaded so the landing page stays light.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { AppProvider } from './AppContext'
import { AppLayout } from './AppLayout'
import { wagmiConfig } from './lib/wagmi'
import { Borrow } from './pages/Borrow'
import { Credit } from './pages/Credit'
import { Escape } from './pages/Escape'
import { Lend } from './pages/Lend'
import { Market } from './pages/Market'
import { Positions } from './pages/Positions'
import { Wallet } from './pages/Wallet'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 2_000, refetchOnWindowFocus: false } } })

export default function AppRoot() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Market />} />
              <Route path="lend" element={<Lend />} />
              <Route path="borrow" element={<Borrow />} />
              <Route path="wallet" element={<Wallet />} />
              <Route path="positions" element={<Positions />} />
              <Route path="credit" element={<Credit />} />
              <Route path="escape" element={<Escape />} />
            </Route>
          </Routes>
        </AppProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
