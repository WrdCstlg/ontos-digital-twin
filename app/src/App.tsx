import { BrowserRouter, Routes, Route } from 'react-router'
import Layout from './components/Layout'
import AppShell from './components/AppShell'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import Library from './pages/Library'
import Studio from './pages/Studio'
import Mapping from './pages/Mapping'
import Explorer from './pages/Explorer'
import Insights from './pages/Insights'
import Twins from './pages/Twins'
import Decisions from './pages/Decisions'
import Admin from './pages/Admin'
import Login from './pages/Login'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Marketing (children pattern — Layout owns the fixed-nav offset) */}
        <Route
          path="/"
          element={
            <Layout>
              <Home />
            </Layout>
          }
        />
        <Route path="/login" element={<Login />} />

        {/* App (nested-route pattern — AppShell renders <Outlet/>) */}
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="library" element={<Library />} />
          <Route path="studio" element={<Studio />} />
          <Route path="mapping" element={<Mapping />} />
          <Route path="explorer" element={<Explorer />} />
          <Route path="insights" element={<Insights />} />
          <Route path="twins" element={<Twins />} />
          <Route path="decisions" element={<Decisions />} />
          <Route path="admin" element={<Admin />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
