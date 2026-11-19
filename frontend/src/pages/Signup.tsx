import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Field, PasswordField, StrengthMeter } from "../components/Fields";
import { BrandMark, IconWarning } from "../components/Icons";
import { checkInvite, redeemInvite, register } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { InviteCheck } from "../lib/types";

const TOKEN_KEY = "glioma.invite";

/**
 * The link carries its token in the fragment (#invite=…), which browsers never
 * send to a server. It is moved out of the address bar straight away, so it
 * does not linger in history or screenshots, and kept for this tab only.
 */
function takeToken(): string | null {
  const match = /(?:^#|&)invite=([\w-]{20,128})/.exec(window.location.hash);
  if (match) {
    try {
      window.sessionStorage.setItem(TOKEN_KEY, match[1]);
    } catch {
      /* storage unavailable: the token lives in memory only */
    }
    window.history.replaceState(null, "", window.location.pathname);
    return match[1];
  }
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

const USERNAME = /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/;

export default function Signup() {
  const navigate = useNavigate();
  const { signedIn } = useAuth();
  const [token] = useState(takeToken);
  const [invite, setInvite] = useState<InviteCheck | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) return;
    checkInvite(token)
      .then(setInvite)
      .catch((reason: Error) => setProblem(reason.message));
  }, [token]);

  const reset = invite?.kind === "reset";
  const usernameError = !reset && touched && username && !USERNAME.test(username) ? "3–32 characters: lowercase letters, digits, dots, dashes or underscores." : null;
  const confirmError = touched && confirm && confirm !== password ? "The two passwords are not the same." : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (token && !invite) return;
    if ((!reset && !USERNAME.test(username)) || password.length < 10 || confirm !== password) {
      setError(password.length < 10 ? "Use at least 10 characters for the password." : "Check the highlighted fields.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { user } = await (token ? redeemInvite(reset ? { token, password } : { token, username, display_name: name, password }) : register(username, password, name));
      try {
        window.sessionStorage.removeItem(TOKEN_KEY);
      } catch {
        /* nothing stored */
      }
      signedIn(user);
      navigate(user.role === "admin" && invite?.first_admin ? "/team" : "/new", { replace: true });
    } catch (reason) {
      setPending(false);
      setError(reason instanceof Error ? reason.message : "Something went wrong. Try again.");
    }
  };

  if (problem) {
    return (
      <main className="auth-page">
        <div className="auth-shell">
          <Link to="/" className="auth-brand" aria-label="Home">
            <BrandMark size={30} />
          </Link>
          <h1>Link not valid</h1>
          <p className="auth-sub">{problem}</p>
          <div className="auth-actions">
            <Link className="btn btn-primary btn-lg" to="/signin">
              Sign in
            </Link>
            <Link className="btn btn-secondary btn-lg" to="/">
              Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (token && !invite) {
    return (
      <main className="auth-page">
        <div className="spinner" role="status" aria-label="Checking the link" />
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <Link to="/" className="auth-brand" aria-label="Home">
          <BrandMark size={30} />
        </Link>
        <h1>{reset ? "Choose a new password" : invite?.first_admin ? "Create the administrator account" : "Create your account"}</h1>
        <p className="auth-sub">
          {reset
            ? `For ${invite?.username}. Every device signed in to this account will be signed out.`
            : invite?.first_admin
              ? "This is the first account on this server. As administrator you manage the team."
              : !token ? "Choose a username and password to upload and compare your examinations." : `You were invited as ${invite?.role === "admin" ? "an administrator" : "a member"}. The link works once.`}
        </p>

        <form className="auth-card glass" onSubmit={submit} noValidate>
          {!reset && (
            <>
              <Field
                label="Your name"
                name="name"
                autoComplete="name"
                placeholder="e.g. Dr. Leyla Aliyeva"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                hint="Shown to your team. Optional."
                autoFocus
              />
              <Field
                label="Username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/\s/g, ""))}
                onBlur={() => setTouched(true)}
                maxLength={32}
                hint="For signing in. Lowercase letters, digits, dots or dashes."
                error={usernameError}
                required
              />
            </>
          )}
          {/* Lets password managers save the right username with a reset. */}
          {reset && <input type="text" name="username" autoComplete="username" value={invite?.username ?? ""} readOnly hidden />}
          <div>
            <PasswordField
              label={reset ? "New password" : "Password"}
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              maxLength={200}
              hint="At least 10 characters. A short sentence is easy to remember and hard to guess."
              autoFocus={reset}
              required
            />
            <StrengthMeter password={password} />
          </div>
          <PasswordField
            label="Repeat the password"
            name="confirm-password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={200}
            error={confirmError}
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
            {pending ? "Saving…" : reset ? "Set the password" : "Create account"}
          </button>
        </form>
        <p className="auth-foot">Already have an account? <Link to="/signin">Sign in</Link>.</p>
      </div>
    </main>
  );
}
