import { Navigate, useLocation } from "react-router-dom";

// Preserve old bookmarks and callbacks; all editable controls live in Settings.
export function SetupPage() {
  const { hash, search } = useLocation();
  const section = hash === "#llm-provider" ? "#settings-model" : hash === "#archive" ? "#settings-archive" : "#settings-connections";
  return <Navigate to={`/settings${search}${section}`} replace />;
}
