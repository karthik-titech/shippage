import { Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import Layout from "./components/Layout.js";

// Lazy-load pages for faster initial load
const Dashboard = lazy(() => import("./pages/Dashboard.js"));
const Setup = lazy(() => import("./pages/Setup.js"));
const SelectTickets = lazy(() => import("./pages/SelectTickets.js"));
const Editor = lazy(() => import("./pages/Editor.js"));
const Export = lazy(() => import("./pages/Export.js"));
const History = lazy(() => import("./pages/History.js"));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Setup wizard — no layout chrome */}
        <Route path="/setup" element={<Setup />} />

        {/* Main app with sidebar layout */}
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<SelectTickets />} />
          <Route path="/edit/:id" element={<Editor />} />
          <Route path="/export/:id" element={<Export />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:id" element={<History />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
