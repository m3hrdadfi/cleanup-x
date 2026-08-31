import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import "./i18n";
import "./index.css";
import { AppShell } from "./components/app-shell";
import { LoadingState } from "./components/feedback";
import { initializePreferences } from "./lib/preferences";

const SearchPage = lazy(() => import("./pages/search").then((module) => ({ default: module.SearchPage })));
const SetupPage = lazy(() => import("./pages/setup").then((module) => ({ default: module.SetupPage })));
const OverviewPage = lazy(() => import("./pages/overview").then((module) => ({ default: module.OverviewPage })));
const InventoryPage = lazy(() => import("./pages/inventory").then((module) => ({ default: module.InventoryPage })));
const NewScanPage = lazy(() => import("./pages/new-scan").then((module) => ({ default: module.NewScanPage })));
const ScanDetailPage = lazy(() => import("./pages/scan-detail").then((module) => ({ default: module.ScanDetailPage })));
const DeletionsPage = lazy(() => import("./pages/deletions").then((module) => ({ default: module.DeletionsPage })));
const DeletionDetailPage = lazy(() => import("./pages/deletion-detail").then((module) => ({ default: module.DeletionDetailPage })));
const SettingsPage = lazy(() => import("./pages/settings").then((module) => ({ default: module.SettingsPage })));
const AuditPage = lazy(() => import("./pages/audit").then((module) => ({ default: module.AuditPage })));
const NotFoundPage = lazy(() => import("./pages/not-found").then((module) => ({ default: module.NotFoundPage })));

initializePreferences();

const router = createBrowserRouter([{ path: "/", element: <AppShell />, children: [
  { index: true, element: <Navigate to="/overview" replace /> }, { path: "overview", element: <OverviewPage /> },
  { path: "setup", element: <SetupPage /> }, { path: "search", element: <SearchPage /> },
  { path: "inventory", element: <InventoryPage /> }, { path: "inventory/:scanId", element: <InventoryPage /> }, { path: "scans/new", element: <NewScanPage /> },
  { path: "scans/:id", element: <ScanDetailPage /> }, { path: "deletions", element: <DeletionsPage /> },
  { path: "deletions/:id", element: <DeletionDetailPage /> },
  { path: "settings", element: <SettingsPage /> }, { path: "audit", element: <AuditPage /> }, { path: "*", element: <NotFoundPage /> },
]}]);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 3000 } } });
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={queryClient}><Suspense fallback={<LoadingState />}><RouterProvider router={router} /></Suspense></QueryClientProvider></React.StrictMode>);
