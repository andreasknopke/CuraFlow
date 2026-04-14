import type { ComponentType } from 'react';
import type React from 'react';
import Admin from './pages/Admin';
import AuthLogin from './pages/AuthLogin';
import DataImport from './pages/DataImport';
import Help from './pages/Help';
import Home from './pages/Home';
import MyDashboard from './pages/MyDashboard';
import Schedule from './pages/Schedule';
import ServiceStaffing from './pages/ServiceStaffing';
import Staff from './pages/Staff';
import Statistics from './pages/Statistics';
import Training from './pages/Training';
import Vacation from './pages/Vacation';
import WishList from './pages/WishList';
import __Layout from './Layout';

export interface LayoutProps {
  currentPageName: string;
  children?: React.ReactNode;
}

export const PAGES: Record<string, ComponentType> = {
  Admin,
  AuthLogin,
  DataImport,
  Help,
  Home,
  MyDashboard,
  Schedule,
  ServiceStaffing,
  Staff,
  Statistics,
  Training,
  Vacation,
  WishList,
};

export const pagesConfig = {
  mainPage: 'Schedule' as const,
  Pages: PAGES,
  Layout: __Layout as ComponentType<LayoutProps>,
};
