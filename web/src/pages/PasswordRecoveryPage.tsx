import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { cancelRecovery, INVALID_RECOVERY_LINK, loadRecoverySession, RecoveryError, requestRecoveryEmail, saveRecoveryPassword } from "../api/passwordRecovery";
import "./PasswordRecoveryPage.css";

function RecoveryLayout({ children }: { children: ReactNode }) {
  return <div className="login-page"><div className="login-window">
    <div className="login-logo"><img src="/logo.png" alt="ITAssetFlow" /></div>
    <div className="recovery-content">{children}</div>
  </div></div>;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || sent) return;
    setBusy(true);
    setError("");
    try { await requestRecoveryEmail(email); setSent(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Die Anfrage ist fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  return <RecoveryLayout>
    <form onSubmit={event => void submit(event)}>
      <fieldset className="login-group" disabled={busy || sent}>
        <legend>Passwort zurücksetzen</legend>
        <p>Du erhältst per E-Mail einen Link, mit dem du ein neues Passwort festlegen kannst.</p>
        <div className="form-row">
          <label htmlFor="recovery-email">E-Mail-Adresse:</label>
          <input id="recovery-email" type="email" autoComplete="username" required maxLength={320} autoFocus value={email} onChange={event => setEmail(event.target.value)} />
        </div>
      </fieldset>
      {error && <p className="recovery-message error" role="alert">{error}</p>}
      {sent && <p className="recovery-message success" role="status">Falls für diese E-Mail-Adresse ein Konto besteht, erhältst du einen Link zum Zurücksetzen. Bitte öffne die neueste E-Mail.</p>}
      <div className="login-actions recovery-actions">
        <Link to="/login">Zur Anmeldung</Link>
        {!sent && <button type="submit" className="primary-button" disabled={busy}>
          {busy && <span className="recovery-spinner" aria-hidden="true" />}{busy ? "Wird angefordert …" : "Link anfordern"}
        </button>}
      </div>
    </form>
  </RecoveryLayout>;
}

export function ResetPasswordPage({ onCompleted }: { onCompleted: () => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const expired = params.get("error") === "expired";
  const [loading, setLoading] = useState(!expired);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState(expired ? INVALID_RECOVERY_LINK : "");
  const [retryable, setRetryable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (expired) {
      void cancelRecovery().catch(() => undefined);
      return;
    }
    let active = true;
    void loadRecoverySession(attempt > 0).then(session => {
      if (!active) return;
      setReady(session.ready);
      setEmail(session.email ?? "");
      setError(session.ready ? "" : INVALID_RECOVERY_LINK);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : INVALID_RECOVERY_LINK);
      setRetryable(cause instanceof RecoveryError && (cause.status === 0 || cause.status >= 500));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [expired, attempt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy || complete) return;
    if (password !== confirmation) { setError("Die Passwörter stimmen nicht überein."); return; }
    setBusy(true);
    setError("");
    try {
      await saveRecoveryPassword(password);
      setPassword(""); setConfirmation(""); setComplete(true); onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Das Passwort konnte nicht gespeichert werden.");
      if (cause instanceof RecoveryError && cause.status === 401) { setReady(false); setPassword(""); setConfirmation(""); }
    } finally { setBusy(false); }
  }

  async function leave() {
    if (busy) return;
    await cancelRecovery().catch(() => undefined);
    navigate("/login", { replace: true });
  }

  return <RecoveryLayout>
    <form onSubmit={event => void submit(event)}>
      {loading || ready || complete ? <fieldset className="login-group" disabled={loading || busy || !ready || complete}>
        <legend>Neues Passwort</legend>
        {loading ? <p className="recovery-progress" role="status"><span className="recovery-spinner" aria-hidden="true" />Der Link wird geprüft …</p>
          : complete ? <p className="recovery-message success" role="status">Dein Passwort wurde geändert. Melde dich mit dem neuen Passwort an.</p>
          : ready ? <>
            <p>Neues Passwort für <strong>{email}</strong></p>
            <div className="form-row">
              <label htmlFor="new-password">Neues Passwort:</label>
              <input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required autoFocus value={password} onChange={event => setPassword(event.target.value)} />
            </div>
            <div className="form-row">
              <label htmlFor="confirm-password">Wiederholen:</label>
              <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} onChange={event => setConfirmation(event.target.value)} />
            </div>
            <p className="recovery-password-note">Mindestens 8 Zeichen.</p>
          </> : null}
      </fieldset> : <h1 className="recovery-title">Passwort zurücksetzen</h1>}
      {error && <p className="recovery-message error" role="alert">{error}</p>}
      <div className="login-actions recovery-actions">
        <button type="button" disabled={busy} onClick={() => void leave()}>{complete ? "Zur Anmeldung" : "Abbrechen"}</button>
        {!loading && !ready && !complete && <Link to="/forgot-password">Neuen Link anfordern</Link>}
        {retryable && !loading && <button type="button" onClick={() => { setLoading(true); setRetryable(false); setError(""); setAttempt(value => value + 1); }}>Erneut prüfen</button>}
        {ready && !complete && <button type="submit" className="primary-button" disabled={busy}>
          {busy && <span className="recovery-spinner" aria-hidden="true" />}{busy ? "Wird gespeichert …" : "Passwort speichern"}
        </button>}
      </div>
    </form>
  </RecoveryLayout>;
}
