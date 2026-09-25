import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import AssetFormPage from "./pages/AssetFormPage";
import InventoryPage from "./pages/InventoryPage";
import LoginPage from "./pages/LoginPage";
import SettingsPage from "./pages/SettingsPage";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ??
  `${window.location.protocol}//${window.location.hostname}:8000`;

export type AppRole =
  | "admin"
  | "user"
  | "viewer";

type SessionResponse = {
  authenticated: boolean;
  email: string | null;
  role: AppRole | null;
};

type ProtectedPageProps = {
  email: string | null;
  role: AppRole | null;
  allowedRoles?: AppRole[];
  children: ReactNode;
};

function ProtectedPage({
  email,
  role,
  allowedRoles,
  children,
}: ProtectedPageProps) {
  if (!email || !role) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  if (
    allowedRoles &&
    !allowedRoles.includes(role)
  ) {
    return (
      <Navigate
        to="/inventory"
        replace
      />
    );
  }

  return children;
}

function SimplePage({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="content-page">
      <div className="content-page-card">
        <h1>{title}</h1>

        <p>{text}</p>

        <Link
          className="page-back-link"
          to="/inventory"
        >
          ← Zurück zum Inventar
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  const [
    checkingSession,
    setCheckingSession,
  ] = useState(true);

  const [
    email,
    setEmail,
  ] = useState<string | null>(null);

  const [
    role,
    setRole,
  ] = useState<AppRole | null>(null);

  const clearSession = useCallback(
    (): void => {
      setEmail(null);
      setRole(null);
    },
    [],
  );

  const checkSession = useCallback(
    async (): Promise<void> => {
      try {
        const response = await fetch(
          `${API_BASE}/api/auth/session`,
          {
            credentials: "include",
          },
        );

        if (!response.ok) {
          clearSession();
          return;
        }

        const data =
          (await response.json()) as SessionResponse;

        if (
          !data.authenticated ||
          !data.email ||
          !data.role ||
          ![
            "admin",
            "user",
            "viewer",
          ].includes(data.role)
        ) {
          clearSession();
          return;
        }

        setEmail(data.email);
        setRole(data.role);
      } catch {
        clearSession();
      } finally {
        setCheckingSession(false);
      }
    },
    [clearSession],
  );

  useEffect(
    () => {
      void checkSession();
    },
    [checkSession],
  );

  function handleLogin(
    loggedInEmail: string,
  ): void {
    // Nach dem Setzen der HttpOnly-Cookies lädt /api/auth/session die serverseitige Rolle.
    setEmail(loggedInEmail);
    setRole(null);
    setCheckingSession(true);

    void checkSession();
  }

  if (checkingSession) {
    return (
      <div className="loading-screen">
        ITAssetFlow wird geladen ...
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Navigate
            to={
              email && role
                ? "/inventory"
                : "/login"
            }
            replace
          />
        }
      />

      <Route
        path="/login"
        element={
          email && role ? (
            <Navigate
              to="/inventory"
              replace
            />
          ) : (
            <LoginPage
              onLogin={handleLogin}
            />
          )
        }
      />

      <Route
        path="/inventory"
        element={
          <ProtectedPage
            email={email}
            role={role}
          >
            <InventoryPage
              email={email ?? ""}
              role={role ?? "viewer"}
              onLogout={clearSession}
            />
          </ProtectedPage>
        }
      />

      <Route
        path="/inventory/new"
        element={
          <ProtectedPage
            email={email}
            role={role}
            allowedRoles={[
              "admin",
              "user",
            ]}
          >
            <AssetFormPage
              onSessionExpired={
                clearSession
              }
            />
          </ProtectedPage>
        }
      />

      <Route
        path="/inventory/:entryKey/edit"
        element={
          <ProtectedPage
            email={email}
            role={role}
            allowedRoles={[
              "admin",
              "user",
            ]}
          >
            <AssetFormPage
              onSessionExpired={
                clearSession
              }
            />
          </ProtectedPage>
        }
      />

      <Route
        path="/product-models"
        element={
          <ProtectedPage email={email} role={role} allowedRoles={["admin"]}>
            <Navigate to="/settings?tab=product-models" replace />
          </ProtectedPage>
        }
      />

      <Route
        path="/settings"
        element={
          <ProtectedPage
            email={email}
            role={role}
            allowedRoles={[
              "admin",
            ]}
          >
            <SettingsPage
              email={email ?? ""}
              onSessionExpired={
                clearSession
              }
            />
          </ProtectedPage>
        }
      />

      <Route
        path="/about"
        element={
          <ProtectedPage
            email={email}
            role={role}
          >
            <SimplePage
              title="Über ITAssetFlow"
              text="ITAssetFlow – IT-Material- und Inventarverwaltung."
            />
          </ProtectedPage>
        }
      />

      <Route
        path="*"
        element={
          <Navigate
            to={
              email && role
                ? "/inventory"
                : "/login"
            }
            replace
          />
        }
      />
    </Routes>
  );
}
