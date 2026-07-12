import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import MasterAuthProvider, { useMasterAuth } from '@/master/MasterAuthProvider';
import MasterLayout from '@/master/MasterLayout';
import MasterLogin from '@/master/pages/MasterLogin';
import MasterDashboard from '@/master/pages/MasterDashboard';
import MasterEmployeeList from '@/master/pages/MasterEmployeeList';
import MasterEmployeeDetail from '@/master/pages/MasterEmployeeDetail';
import MasterAbsences from '@/master/pages/MasterAbsences';
import MasterTimeTracking from '@/master/pages/MasterTimeTracking';
import MasterHolidays from '@/master/pages/MasterHolidays';
import MasterWorkTimeModels from '@/master/pages/MasterWorkTimeModels';
import MasterPayScaleTariffs from '@/master/pages/MasterPayScaleTariffs';
import MasterEmployeeCreate from '@/master/pages/MasterEmployeeCreate';
import MasterCentralEmployeeDetail from '@/master/pages/MasterCentralEmployeeDetail';
import MasterPPUGV from '@/master/pages/MasterPPUGV';
import MasterStammdatImport from '@/master/pages/MasterStammdatImport';
import MasterCostCenters from '@/master/pages/MasterCostCenters';
import MasterTisoware from '@/master/pages/MasterTisoware';
import MasterAdminPermissions from '@/master/pages/MasterAdminPermissions';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useMasterAuth();

  console.debug('[MasterApp] ProtectedRoute render — isLoading:', isLoading, 'isAuthenticated:', isAuthenticated, 'pathname:', window.location.pathname);

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
    console.debug('[MasterApp] Not authenticated, redirecting to /login');
    return <Navigate to="/login" replace />;
  }

  console.debug('[MasterApp] Authenticated, rendering children');
  return children;
}

export default function MasterApp() {
  const basename = window.location.pathname === '/master' || window.location.pathname.startsWith('/master/')
    ? '/master'
    : undefined;

  console.debug('[MasterApp] Mounted — window.location.origin:', window.location.origin);
  console.debug('[MasterApp] window.location.pathname:', window.location.pathname);
  console.debug('[MasterApp] Computed basename:', basename);

  return (
    <QueryClientProvider client={queryClient}>
      <MasterAuthProvider>
        <BrowserRouter basename={basename}>
          <Routes>
            <Route path="/login" element={<MasterLogin />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <MasterLayout>
                    <Routes>
                      <Route path="/" element={<MasterDashboard />} />
                      <Route path="/mitarbeiter" element={<MasterEmployeeList />} />
                      <Route path="/mitarbeiter/neu" element={<MasterEmployeeCreate />} />
                      <Route path="/mitarbeiter/central/:employeeId" element={<MasterCentralEmployeeDetail />} />
                      <Route path="/mitarbeiter/:tenantId/:employeeId" element={<MasterEmployeeDetail />} />
                      <Route path="/arbeitszeitmodelle" element={<MasterWorkTimeModels />} />
                      <Route path="/tarifvertraege" element={<MasterPayScaleTariffs />} />
                      <Route path="/fehlzeiten" element={<MasterAbsences />} />
                      <Route path="/feiertage" element={<MasterHolidays />} />
                      <Route path="/zeiterfassung" element={<MasterTimeTracking />} />
                      <Route path="/ppugv" element={<MasterPPUGV />} />
                      <Route path="/stammdat-import" element={<MasterStammdatImport />} />
                      <Route path="/kostenstellen" element={<MasterCostCenters />} />
                      <Route path="/tisoware" element={<MasterTisoware />} />
                      <Route path="/admin-rechte" element={<MasterAdminPermissions />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
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
