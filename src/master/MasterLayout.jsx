import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMasterAuth } from '@/master/MasterAuthProvider';
import {
  LayoutDashboard, LogOut,
  Menu, ChevronLeft, Building2, Shield,
  Users, CalendarX2, Clock, CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CoWorkWidget from '@/components/CoWorkWidget';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/mitarbeiter', label: 'Mitarbeiter', icon: Users },
  { path: '/fehlzeiten', label: 'Fehlzeiten', icon: CalendarX2 },
  { path: '/feiertage', label: 'Feiertage & Ferien', icon: CalendarDays },
  { path: '/zeiterfassung', label: 'Zeiterfassung', icon: Clock },
];

export default function MasterLayout({ children }) {
  const { user, logout } = useMasterAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col bg-indigo-950 text-white transition-all duration-200 ease-in-out',
          sidebarOpen ? 'w-64' : 'w-16'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-indigo-800">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-indigo-300" />
              <div>
                <h1 className="text-sm font-bold leading-tight">CuraFlow</h1>
                <span className="text-[10px] text-indigo-300 uppercase tracking-widest">Master</span>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-md hover:bg-indigo-800 text-indigo-300 hover:text-white transition-colors"
          >
            {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 space-y-1 px-2">
          {NAV_ITEMS.map((item) => {
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm',
                  isActive
                    ? 'bg-indigo-800 text-white font-semibold'
                    : 'text-indigo-200 hover:bg-indigo-900 hover:text-white'
                )}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User / Logout */}
        <div className="p-3 border-t border-indigo-800">
          {sidebarOpen && (
            <div className="text-xs text-indigo-300 mb-2 px-2 truncate">
              {user?.email}
            </div>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-indigo-300 hover:bg-indigo-900 hover:text-white transition-colors text-sm w-full"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {sidebarOpen && <span>Abmelden</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      <CoWorkWidget />
    </div>
  );
}
