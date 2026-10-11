import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Radio, ShieldCheck } from "lucide-react";
import { api, type Identity } from "../../lib/livelens/api";

type Invitation = {
  purpose: "invite" | "password-reset";
  workspace: string;
  username: string;
  role: string;
  expiresAtMs: number;
};

export default function InvitationAcceptance({
  token,
  onSignedIn,
  onCancel,
}: {
  token: string;
  onSignedIn: (identity: Identity) => void;
  onCancel: () => void;
}) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setInvitation(null);
    setError("");
    setPassword("");
    setConfirmation("");
    api<{ invitation: Invitation }>("/console/invitations/inspect", { token })
      .then((value) => active && setInvitation(value.invitation))
      .catch(() => {
        if (active)
          setError("This link is unavailable or has expired. Ask your workspace administrator for a new link.");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);
  const reset = invitation?.purpose === "password-reset";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !invitation) return;
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const identity = await api<Identity>("/console/invitations/redeem", { token, password });
      setPassword("");
      setConfirmation("");
      onSignedIn(identity);
    } catch (failure) {
      setPassword("");
      setConfirmation("");
      setError(failure instanceof Error && ["invalid_password", "password_too_short"].includes(failure.message)
        ? "Choose a password with at least 12 characters."
        : "This link could not be used. Ask your workspace administrator for a new link.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ll-app ll-login">
      <section className="ll-login-story" aria-label="About your workspace">
        <div className="ll-brand"><span className="ll-mark"><Radio size={22} /></span>LiveLens</div>
        <div className="ll-login-intro">
          <p className="ll-eyebrow">SHARED EVIDENCE. CLEARER CONTEXT.</p>
          <h1>Good work starts<br /><span>with the source.</span></h1>
          <p>Review the original conversation, investigate together and keep the evidence behind every conclusion.</p>
        </div>
      </section>
      <div className="ll-login-card">
        <div className="ll-login-icon"><ShieldCheck size={26} /></div>
        <p className="ll-eyebrow">YOUR WORKSPACE</p>
        <h2>{reset ? "Set a new password." : "Join your team."}</h2>
        {loading ? <p role="status">Checking your link…</p> : invitation ? (
          <>
            <p>{reset ? "Sign back in" : "Join"} as <strong>{invitation.username}</strong> in <strong>{invitation.workspace}</strong>.</p>
            <p className="ll-muted">Workspace role: {invitation.role}. This link expires {new Date(invitation.expiresAtMs).toLocaleString()}.</p>
            <form onSubmit={submit}>
              <label>New password<input name="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <label>Confirm password<input name="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
              <p className="ll-muted">Use at least 12 characters.</p>
              {error && <p role="alert" className="ll-error">{error}</p>}
              <button className="ll-primary" disabled={busy}>{busy ? "Opening workspace…" : reset ? "Save password and sign in" : "Join workspace"}<ArrowRight size={16} /></button>
            </form>
          </>
        ) : <p role="alert" className="ll-error">{error}</p>}
        <button type="button" className="ll-button" disabled={busy} onClick={onCancel}>Return to sign in</button>
      </div>
    </div>
  );
}
