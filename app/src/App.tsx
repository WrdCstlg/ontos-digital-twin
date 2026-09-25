import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import Layout from './components/Layout'
import AppShell from './components/AppShell'
import AuthGuard from './components/AuthGuard'
import ErrorBoundary from './components/ErrorBoundary'
import Home from './pages/Home'
import Login from './pages/Login'
import NotFound from './pages/NotFound'

// Lazy-load complex pages for code splitting & faster initial page paint
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Library = lazy(() => import('./pages/Library'))
const Studio = lazy(() => import('./pages/Studio'))
const Mapping = lazy(() => import('./pages/Mapping'))
const Explorer = lazy(() => import('./pages/Explorer'))
const Insights = lazy(() => import('./pages/Insights'))
const Twins = lazy(() => import('./pages/Twins'))
const Decisions = lazy(() => import('./pages/Decisions'))
const Admin = lazy(() => import('./pages/Admin'))
const Guide = lazy(() => import('./pages/Guide'))
const Operations = lazy(() => import('./pages/Operations'))
const Actions = lazy(() => import('./pages/Actions'))
const Landscape = lazy(() => import('./pages/Landscape'))

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-iris/20 border-t-iris" />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
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

          {/* App (protected by AuthGuard — nested route pattern) */}
          <Route
            path="/app"
            element={
              <AuthGuard>
                <AppShell />
              </AuthGuard>
            }
          >
            <Route
              index
              element={
                <Suspense fallback={<PageFallback />}>
                  <Dashboard />
                </Suspense>
              }
            />
            <Route
              path="library"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Library />
                </Suspense>
              }
            />
            <Route
              path="studio"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Studio />
                </Suspense>
              }
            />
            <Route
              path="mapping"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Mapping />
                </Suspense>
              }
            />
            <Route
              path="explorer"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Explorer />
                </Suspense>
              }
            />
            <Route
              path="insights"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Insights />
                </Suspense>
              }
            />
            <Route
              path="twins"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Twins />
                </Suspense>
              }
            />
            <Route
              path="decisions"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Decisions />
                </Suspense>
              }
            />
            <Route
              path="operations"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Operations />
                </Suspense>
              }
            />
            <Route
              path="actions"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Actions />
                </Suspense>
              }
            />
            <Route
              path="admin"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Admin />
                </Suspense>
              }
            />
            <Route
              path="guide"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Guide />
                </Suspense>
              }
            />
            <Route
              path="landscape"
              element={
                <Suspense fallback={<PageFallback />}>
                  <Landscape />
                </Suspense>
              }
            />
          </Route>

          {/* Catch-all 404 route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

