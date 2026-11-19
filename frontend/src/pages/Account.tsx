import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { Field, PasswordField, StrengthMeter } from "../components/Fields";
import { IconCheck, IconSignOut, IconUsers, IconWarning } from "../components/Icons";
import { changePassword, updateProfile } from "../lib/api";
import { initials, useAuth } from "../lib/auth";
import { timeAgo } from "../lib/format";

function Saved({ text }: { text: string }) {
  return (
    <p className="form-done" role="status">
      <IconCheck size={14} /> {text}
    </p>
  );
}

function ProfileForm() {
  const { user, signedIn } = useAuth();
  const [name, setName] = useState(user?.display_name ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState("saving");
    setError(null);
    try {
      const { user: updated } = await updateProfile(name);
      signedIn(updated);
      setName(updated.display_name);
      setState("saved");
    } catch (reason) {
      setState("idle");
      setError(reason instanceof Error ? reason.message : "Could not save.");
    }
  };
  return (
    <form className="settings-form" onSubmit={submit}>
      <Field label="Name" autoComplete="name" value={name} onChange={(event) => (setName(event.target.value), setState("idle"))} maxLength={60} hint="Shown to your team." error={error} />
      <Field label="Username" value={user.username} readOnly hint="Used to sign in. An administrator can change it by making a new account." />
      <div className="settings-actions">
        <button className="btn btn-secondary" type="submit" disabled={state === "saving" || name.trim() === user.display_name}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && <Saved text="Saved" />}
      </div>
    </form>
  );
}

function PasswordForm() {
  const { signedIn } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== next;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next !== confirm) return setError("The two new passwords are not the same.");
    setState("saving");
    setError(null);
    try {
      const { user } = await changePassword(current, next);
      signedIn(user);
      setCurrent("");
      setNext("");
      setConfirm("");
      setState("saved");
    } catch (reason) {
      setState("idle");
      setError(reason instanceof Error ? reason.message : "Could not change the password.");
    }
  };
  return (
    <form className="settings-form" onSubmit={submit}>
      <PasswordField label="Current password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} maxLength={256} required />
      <div>
        <PasswordField label="New password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} maxLength={200} hint="At least 10 characters." required />
        <StrengthMeter password={next} />
      </div>
      <PasswordField
        label="Repeat the new password"
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        maxLength={200}
        error={mismatch ? "The two new passwords are not the same." : null}
        required
      />
      {error && (
        <div className="callout callout-error" role="alert">
          <IconWarning />
          {error}
        </div>
      )}
      <div className="settings-actions">
        <button className="btn btn-secondary" type="submit" disabled={state === "saving" || !current || next.length < 10 || mismatch}>
          {state === "saving" ? "Changing…" : "Change password"}
        </button>
        {state === "saved" && <Saved text="Password changed. Other devices were signed out." />}
      </div>
    </form>
  );
}

export default function Account() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <main className="container settings-page">
      <header className="settings-head">
        <span className="avatar avatar-lg" aria-hidden="true">
          {initials(user)}
        </span>
        <div>
          <h1>{user.display_name}</h1>
          <p className="muted">
            {user.username} · {user.role === "admin" ? "Administrator" : "Member"} · last sign-in {timeAgo(user.last_login_at)}
          </p>
        </div>
      </header>

      <div className="settings-grid">
        <section className="settings-card glass" aria-labelledby="profile-title">
          <h2 id="profile-title">Profile</h2>
          <ProfileForm />
        </section>

        <section className="settings-card glass" aria-labelledby="password-title">
          <h2 id="password-title">Password</h2>
          <PasswordForm />
        </section>

        <section className="settings-card glass" aria-labelledby="session-title">
          <h2 id="session-title">This device</h2>
          <p className="settings-text">You stay signed in for up to 7 days, or until 2 days without use. Signing out removes the session from the server.</p>
          <div className="settings-actions">
            <button className="btn btn-secondary" onClick={() => void signOut()}>
              <IconSignOut /> Sign out
            </button>
            {user.role === "admin" && (
              <Link className="btn btn-ghost" to="/team">
                <IconUsers /> Manage the team
              </Link>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
