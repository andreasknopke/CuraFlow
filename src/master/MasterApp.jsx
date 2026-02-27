import React from 'react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import MasterAuthProvider, { useMasterAuth } from '@/master/MasterAuthProvider';
import MasterLayout from '@/master/MasterLayout';
import MasterLogin from '@/master/pages/MasterLogin';
import MasterDashboard from '@/master/pages/MasterDashboard';
import MasterTimeTracking from '@/master/pages/MasterTimeTracking';
import MasterAbsences from '@/master/pages/MasterAbsences';
import MasterStaff from '@/master/pages/MasterStaff';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useMasterAuth();

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Wird geladen…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function MasterApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <MasterAuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<MasterLogin />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <MasterLayout>
                    <Routes>
                      <Route path="/" element={<MasterDashboard />} />
                      <Route path="/time-tracking" element={<MasterTimeTracking />} />
                      <Route path="/absences" element={<MasterAbsences />} />
                      <Route path="/staff" element={<MasterStaff />} />
                    </Routes>
                  </MasterLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </MasterAuthProvider>
    </QueryClientProvider>
  );
}
