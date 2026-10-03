import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Landing } from './landing/Landing'

const AppRoot = lazy(() => import('./app/AppRoot'))

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app/*" element={<Suspense fallback={null}><AppRoot /></Suspense>} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  )
}
