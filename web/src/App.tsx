import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppSoon } from './app/AppSoon'
import { Landing } from './landing/Landing'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app/*" element={<AppSoon />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  )
}
