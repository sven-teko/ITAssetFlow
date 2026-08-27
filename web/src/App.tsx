import {
  useEffect,
  useState,
} from "react";

import type {
  ReactNode,
} from "react";

import {
  Link,
  Navigate,
  Route,
  Routes,
  useParams,
} from "react-router-dom";

import AssetFormPage from "./pages/AssetFormPage";
import InventoryPage from "./pages/InventoryPage";
import LoginPage from "./pages/LoginPage";


const API_BASE =
  import.meta.env.VITE_API_BASE_URL
  ?? `${window.location.protocol}//${window.location.hostname}:8000`;


type SessionResponse = {
  authenticated: boolean;
  email: string | null;
};


type ProtectedPageProps = {
  email: string | null;
  children: ReactNode;
};


function ProtectedPage({
  email,
  children,
}: ProtectedPageProps) {
  if (!email) {
    return (
      <Navigate
        to="/login"
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

        <h1>
          {title}
        </h1>

        <p>
          {text}
        </p>

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


function EditPage() {
  const {
    entryKey,
  } = useParams();

  return (
    <SimplePage
      title="Inventareintrag bearbeiten"
      text={
        `Die Bearbeitungsseite für ${entryKey ?? "den Eintrag"} `
        + "wird im nächsten Schritt mit demselben Formular verbunden."
      }
    />
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
  ] = useState<string | null>(
    null,
  );


  useEffect(
    () => {
      async function checkSession(): Promise<void> {
        try {
          const response =
            await fetch(
              `${API_BASE}/api/auth/session`,
              {
                credentials: "include",
              },
            );

          if (!response.ok) {
            setEmail(
              null,
            );

            return;
          }

          const data = (
            await response.json()
          ) as SessionResponse;

          if (
            !data.authenticated
            || !data.email
          ) {
            setEmail(
              null,
            );

            return;
          }

          setEmail(
            data.email,
          );

        } catch {
          setEmail(
            null,
          );

        } finally {
          setCheckingSession(
            false,
          );
        }
      }

      void checkSession();
    },
    [],
  );


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
              email
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
          email
            ? (
              <Navigate
                to="/inventory"
                replace
              />
            )
            : (
              <LoginPage
                onLogin={
                  setEmail
                }
              />
            )
        }
      />


      <Route
        path="/inventory"
        element={
          <ProtectedPage
            email={email}
          >
            <InventoryPage
              email={email ?? ""}
              onLogout={() =>
                setEmail(null)
              }
            />
          </ProtectedPage>
        }
      />


      <Route
        path="/inventory/new"
        element={
          <ProtectedPage
            email={email}
          >
            <AssetFormPage
              onSessionExpired={() =>
                setEmail(null)
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
          >
            <EditPage />
          </ProtectedPage>
        }
      />


      <Route
        path="/settings"
        element={
          <ProtectedPage
            email={email}
          >
            <SimplePage
              title="Einstellungen"
              text={
                "Die Einstellungen werden hier als eigene Webseite "
                + "anstelle eines Windows-Dialogs dargestellt."
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
              email
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