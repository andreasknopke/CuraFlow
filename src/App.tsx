/**
 * CuraFlow — App Root Component
 *
 * Sets up the QueryClientProvider, Router, AuthProvider, and route definitions.
 * Pages are configured via `pages.config.js`.
 *
 * @module App
 */

import './App.css';
import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { pagesConfig } from './pages.config';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/components/AuthProvider';
import PlanUpdateListener from '@/components/PlanUpdateListener';
import ErrorBoundary from '@/components/ErrorBoundary';
import CertificateUploadPage from '@/pages/CertificateUpload';
import React from 'react';

// ── Extract page config ──────────────────────────────────────────────────────

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey: string = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({
  children,
  currentPageName,
}: {
  children: React.ReactNode;
  currentPageName: string;
}) =>
  Layout ? (
    <Layout currentPageName={currentPageName}>{children}</Layout>
  ) : (
    <>{children}</>
  );

// ── Authenticated App ────────────────────────────────────────────────────────

const AuthenticatedApp: React.FC = () => {
  const { isLoading, isAuthenticated } = useAuth();

  // Loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Main router
  return (
    <Routes>
      <Route
        path="/"
        element={
          <LayoutWrapper currentPageName={mainPageKey}>
            <MainPage />
          </LayoutWrapper>
        }
      />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      {/* Certificate upload does not use the layout wrapper */}
      <Route path="/upload/:token" element={<CertificateUploadPage />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

// ── Root Component ───────────────────────────────────────────────────────────

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <AuthProvider>
          <PlanUpdateListener />
          <ErrorBoundary>
            <AuthenticatedApp />
          </ErrorBoundary>
          <Toaster />
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  );
};

export default App;
