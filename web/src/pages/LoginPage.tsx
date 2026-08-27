import {
  useState,
} from "react";

import type {
  FormEvent,
} from "react";

import {
  useNavigate,
} from "react-router-dom";


const API_BASE =
  import.meta.env.VITE_API_BASE_URL
  ?? `${window.location.protocol}//${window.location.hostname}:8000`;


type LoginResponse = {
  authenticated: boolean;
  email: string;
};


type LoginPageProps = {
  onLogin: (
    email: string,
  ) => void;
};


export default function LoginPage({
  onLogin,
}: LoginPageProps) {
  const navigate =
    useNavigate();

  const [
    email,
    setEmail,
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    showPassword,
    setShowPassword,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    busy,
    setBusy,
  ] = useState(false);


  async function submit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const normalizedEmail =
      email.trim();

    if (
      !normalizedEmail
      || !password
    ) {
      setMessage(
        "Bitte E-Mail-Adresse und Passwort eingeben.",
      );

      return;
    }

    setBusy(
      true,
    );

    setMessage(
      "Anmeldung wird geprüft ...",
    );

    try {
      const response =
        await fetch(
          `${API_BASE}/api/auth/login`,
          {
            method: "POST",

            credentials: "include",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              email: normalizedEmail,
              password,
            }),
          },
        );

      const rawData: unknown =
        await response.json();

      if (!response.ok) {
        let detail =
          "Anmeldung fehlgeschlagen.";

        if (
          typeof rawData === "object"
          && rawData !== null
          && "detail" in rawData
        ) {
          const value =
            (
              rawData as {
                detail?: unknown;
              }
            ).detail;

          if (
            typeof value === "string"
            && value.trim()
          ) {
            detail =
              value;
          }
        }

        throw new Error(
          detail,
        );
      }

      const data =
        rawData as LoginResponse;

      if (
        !data.authenticated
        || !data.email
      ) {
        throw new Error(
          "Die Anmeldung konnte nicht bestätigt werden.",
        );
      }

      setMessage(
        "",
      );

      onLogin(
        data.email,
      );

      navigate(
        "/inventory",
        {
          replace: true,
        },
      );

    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Anmeldung fehlgeschlagen.",
      );

    } finally {
      setBusy(
        false,
      );
    }
  }


  function clearLogin(): void {
    if (busy) {
      return;
    }

    setEmail("");
    setPassword("");
    setMessage("");
  }


  return (
    <div className="login-page">

      <div className="login-window">

        <div className="login-logo">
          <img
            src="/logo.png"
            alt="ITAssetFlow"
          />
        </div>


        <form
          onSubmit={submit}
        >

          <fieldset className="login-group">

            <legend>
              Anmeldung
            </legend>


            <div className="form-row">

              <label
                htmlFor="login-email"
              >
                E-Mail-Adresse:
              </label>


              <input
                id="login-email"
                type="email"
                value={email}
                placeholder="name@firma.ch"
                autoFocus
                autoComplete="username"
                disabled={busy}
                onChange={(event) =>
                  setEmail(
                    event.target.value,
                  )
                }
              />

            </div>


            <div className="form-row">

              <label
                htmlFor="login-password"
              >
                Passwort:
              </label>


              <input
                id="login-password"
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                value={password}
                placeholder="Passwort"
                autoComplete="current-password"
                disabled={busy}
                onChange={(event) =>
                  setPassword(
                    event.target.value,
                  )
                }
              />

            </div>


            <div className="password-row">

              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() =>
                  setShowPassword(
                    (current) =>
                      !current,
                  )
                }
              >
                {
                  showPassword
                    ? "Passwort ausblenden"
                    : "Passwort anzeigen"
                }
              </button>

            </div>

          </fieldset>


          <div className="login-status">
            {message}
          </div>


          <div className="login-actions">

            <button
              type="button"
              disabled={busy}
              onClick={clearLogin}
            >
              Abbrechen
            </button>


            <button
              type="submit"
              className="primary-button"
              disabled={busy}
            >
              {
                busy
                  ? "Anmelden ..."
                  : "Anmelden"
              }
            </button>

          </div>

        </form>

      </div>

    </div>
  );
}