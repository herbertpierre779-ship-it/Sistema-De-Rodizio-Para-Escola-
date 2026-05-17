import { createBrowserRouter } from "react-router-dom";
import { GuestOnly, RequireAuth } from "./components/RequireAuth";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import Login from "./pages/Login";

function LoginRoute() {
  return (
    <GuestOnly>
      <Login />
    </GuestOnly>
  );
}

function DashboardRoute() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Home,
  },
  {
    path: "/login",
    Component: LoginRoute,
  },
  {
    path: "/dashboard",
    Component: DashboardRoute,
  },
]);
