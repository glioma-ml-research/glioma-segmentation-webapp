import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { Field, PasswordField } from "../components/Fields";
import { BrandMark, IconWarning } from "../components/Icons";
import { ApiError, signIn } from "../lib/api";
import { safeNext, useAuth } from "../lib/auth";

export default function SignIn() {
  const { user, ready, signedIn } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  if (ready && user && !pending) return <Navigate to={next} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { user: account } = await signIn(username.trim(), password);
      signedIn(account);
      navigate(next, { replace: true });
    } catch (reason) {
      setPending(false);
      setPassword("");
      setError(reason instanceof ApiError && reason.status !== 0 ? reason.message : "Cannot reach the server. Check your connection and try again.");
      form.current?.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')?.focus();
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <Link to="/" className="auth-brand" aria-label="Home">
          <BrandMark size={30} />
        </Link>
        <h1>Sign in</h1>
        <p className="auth-sub">
          {next === "/new"
            ? "Sign in to upload an examination. Your results stay private to your account."
            : next.startsWith("/viewer") || next.startsWith("/results")
              ? "Sign in to open your results."
              : "Upload examinations and keep your results private to your account."}
        </p>

        <form ref={form} className="auth-card glass" onSubmit={submit} noValidate>
          <Field
            label="Username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={64}
            autoFocus
            required
          />
          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            enterKeyHint="go"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={256}
            required
          />
          <div className="auth-error" aria-live="assertive">
            {error && (
              <div className="callout callout-error" role="alert">
                <IconWarning />
                {error}
              </div>
            )}
          </div>
          <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="auth-foot">
          New here? <Link to="/signup">Create an account</Link>, or <Link to="/#samples">explore the sample cases</Link>.
        </p>
      </div>
    </main>
  );
}
