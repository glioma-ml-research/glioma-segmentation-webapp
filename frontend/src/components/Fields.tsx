import { useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

import { IconEye } from "./Icons";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">;

/** A labelled text input; the hint and the error are read out with the field. */
export function Field({ label, hint, error, trailing, ...input }: InputProps & { label: string; hint?: ReactNode; error?: string | null; trailing?: ReactNode }) {
  const id = useId();
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field-box">
        <input id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={described} {...input} />
        {trailing}
      </div>
      {hint && !error && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Password input with show/hide and a Caps Lock warning. */
export function PasswordField(props: InputProps & { label: string; hint?: ReactNode; error?: string | null }) {
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const watchCaps = (event: KeyboardEvent<HTMLInputElement>) => setCaps(event.getModifierState?.("CapsLock") ?? false);
  return (
    <Field
      {...props}
      type={visible ? "text" : "password"}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      onKeyDown={watchCaps}
      onKeyUp={watchCaps}
      hint={caps ? <span className="caps">Caps Lock is on</span> : props.hint}
      trailing={
        <button
          type="button"
          className="field-action"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          title={visible ? "Hide password" : "Show password"}
        >
          <IconEye off={!visible} />
        </button>
      }
    />
  );
}

/** Rough strength from length and variety; the server's rules are the real check. */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!password) return { score: 0, label: "" };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const unique = new Set(password.toLowerCase()).size;
  if (password.length < 10 || unique < 4) return { score: 0, label: "Too short" };
  if (password.length >= 16 || (password.length >= 12 && kinds >= 3)) return { score: 3, label: "Strong" };
  if (password.length >= 12 || kinds >= 3) return { score: 2, label: "Good" };
  return { score: 1, label: "Fair" };
}

export function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  if (!password) return null;
  return (
    <div className="strength" data-score={score} aria-live="polite">
      <span className="strength-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{label}</span>
    </div>
  );
}
