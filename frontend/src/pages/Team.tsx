import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Field } from "../components/Fields";
import { IconCheck, IconCopy, IconKey, IconTrash, IconWarning } from "../components/Icons";
import { listInvites, listTeam, makeInvite, makeResetLink, removeMember, revokeInvite, updateMember } from "../lib/api";
import { initials, useAuth } from "../lib/auth";
import { timeAgo, timeLeft } from "../lib/format";
import type { CreatedLink, InviteInfo, Role, TeamMember } from "../lib/types";

const DURATIONS = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

/** A just-made link, shown once with a copy button. */
function LinkReveal({ link, onDone }: { link: CreatedLink; onDone: () => void }) {
  const url = `${window.location.origin}${link.path}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      (document.getElementById("new-link") as HTMLInputElement | null)?.select();
    }
  };
  return (
    <div className="link-reveal" role="status">
      <p>
        <b>{link.invite.kind === "reset" ? "Password reset link" : `Sign-up link for ${link.invite.role === "admin" ? "an administrator" : "a member"}`}</b>{" "}
        · works once, until {new Date(link.invite.expires_at * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </p>
      <div className="link-row">
        <input id="new-link" className="input mono" value={url} readOnly onFocus={(event) => event.target.select()} aria-label="The link" />
        <button className="btn btn-primary" onClick={copy}>
          {copied ? <IconCheck /> : <IconCopy />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="link-note">
        <IconWarning /> Shown only now. Send it privately (not in a public chat): whoever opens it {link.invite.kind === "reset" ? "sets the password" : "gets the account"}.
      </p>
      <button className="btn-link" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function InviteForm({ onCreated }: { onCreated: (link: CreatedLink) => void }) {
  const [role, setRole] = useState<Role>("member");
  const [note, setNote] = useState("");
  const [hours, setHours] = useState(72);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      onCreated(await makeInvite(role, note, hours));
      setNote("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not make the link.");
    } finally {
      setPending(false);
    }
  };
  return (
    <form className="invite-form" onSubmit={submit}>
      <Field label="Who is it for?" placeholder="e.g. Dr. Mammadov, radiology" value={note} onChange={(event) => setNote(event.target.value)} maxLength={80} hint="Only to recognise the link later." />
      <div className="field">
        <span className="field-label" id="role-label">
          Role
        </span>
        <div className="seg full" role="group" aria-labelledby="role-label">
          <button type="button" aria-pressed={role === "member"} onClick={() => setRole("member")}>
            Member
          </button>
          <button type="button" aria-pressed={role === "admin"} onClick={() => setRole("admin")}>
            Administrator
          </button>
        </div>
        <p className="field-hint">{role === "admin" ? "Can invite and remove people, and see every result." : "Can upload examinations and see their own results."}</p>
      </div>
      <div className="field">
        <span className="field-label" id="expiry-label">
          Link expires after
        </span>
        <div className="seg full" role="group" aria-labelledby="expiry-label">
          {DURATIONS.map((option) => (
            <button type="button" key={option.hours} aria-pressed={hours === option.hours} onClick={() => setHours(option.hours)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div className="callout callout-error" role="alert">
          <IconWarning />
          {error}
        </div>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Making the link…" : "Make an invite link"}
      </button>
    </form>
  );
}

function MemberRow({ member, me, busy, act }: { member: TeamMember; me: boolean; busy: boolean; act: (run: () => Promise<unknown>, confirm?: string) => void }) {
  return (
    <li className={`member${member.disabled ? " is-disabled" : ""}`}>
      <span className="avatar" aria-hidden="true">
        {initials(member)}
      </span>
      <div className="member-main">
        <b>
          {member.display_name}
          {me && <span className="state">(you)</span>}
          {member.disabled && <span className="state error">disabled</span>}
        </b>
        <span className="muted">
          {member.username} · {member.role === "admin" ? "Administrator" : "Member"} · {member.jobs} result{member.jobs === 1 ? "" : "s"} · signed in {timeAgo(member.last_login_at)}
        </span>
      </div>
      {!me && (
        <div className="member-actions">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => updateMember(member.id, { role: member.role === "admin" ? "member" : "admin" }))}>
            {member.role === "admin" ? "Make member" : "Make administrator"}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => updateMember(member.id, { disabled: !member.disabled }), member.disabled ? undefined : `Disable ${member.username}? They are signed out at once and cannot sign in until enabled again.`)}>
            {member.disabled ? "Enable" : "Disable"}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => makeResetLink(member.id))} title="Make a link that lets them choose a new password">
            <IconKey /> Reset link
          </button>
          <button className="btn btn-ghost btn-sm btn-icon danger" disabled={busy} onClick={() => act(() => removeMember(member.id), `Remove ${member.username}? Their account is deleted; their results are kept until they expire.`)} aria-label={`Remove ${member.username}`} title="Remove">
            <IconTrash />
          </button>
        </div>
      )}
    </li>
  );
}

export default function Team() {
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [link, setLink] = useState<CreatedLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [team, open] = await Promise.all([listTeam(), listInvites()]);
      setMembers(team);
      setInvites(open);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the team.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const act = (run: () => Promise<unknown>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    run()
      .then((result) => {
        if (result && typeof result === "object" && "path" in result) setLink(result as CreatedLink);
        return load();
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setBusy(false));
  };

  return (
    <main className="container settings-page">
      <header className="page-head compact">
        <h1>Team</h1>
        <p>Accounts are by invitation only. Make a link, send it to the person privately, and they choose their own password.</p>
      </header>

      {error && (
        <div className="callout callout-error" role="alert" style={{ marginBottom: 18 }}>
          <IconWarning />
          {error}
        </div>
      )}

      <div className="team-grid">
        <section className="settings-card glass" aria-labelledby="invite-title">
          <h2 id="invite-title">Invite someone</h2>
          {link ? <LinkReveal link={link} onDone={() => setLink(null)} /> : <InviteForm onCreated={(created) => (setLink(created), void load())} />}
          {invites.length > 0 && (
            <div className="open-links">
              <h3>Open links</h3>
              <ul>
                {invites.map((invite) => (
                  <li key={invite.id}>
                    <span>
                      <b>{invite.note || (invite.kind === "reset" ? "Password reset" : "Unnamed invite")}</b>
                      <span className="muted">
                        {invite.kind === "reset" ? "reset" : invite.role === "admin" ? "administrator" : "member"} · expires {timeLeft(invite.expires_at)}
                      </span>
                    </span>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => revokeInvite(invite.id))}>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="settings-card glass" aria-labelledby="members-title">
          <h2 id="members-title">
            Members <span className="muted">{members ? members.length : ""}</span>
          </h2>
          {members === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <ul className="members">
              {members.map((member) => (
                <MemberRow key={member.id} member={member} me={member.id === user?.id} busy={busy} act={act} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
