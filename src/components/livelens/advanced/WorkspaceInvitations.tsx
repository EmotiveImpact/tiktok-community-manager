import { useState, type FormEvent } from "react";
import { api } from "../../../lib/livelens/api";
import { Notice, Section, Status, stamp, useAction, useResource } from "./shared";

type Account = { username: string; role: string; status: string };
type Invitation = {
  id: string; username: string; purpose: string; role: string; state: string;
  expiresAtMs: number;
};
type Receipt = { invitation: Invitation; url: string };

export default function WorkspaceInvitations({ onSaved, revision = 0 }: { onSaved: () => void; revision?: number }) {
  const accounts = useResource<{ accounts: Account[] }>("/v1/workspace/accounts", revision);
  const invitations = useResource<{ invitations: Invitation[] }>("/v1/workspace/invitations", revision);
  const action = useAction();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("analyst");
  const [expiry, setExpiry] = useState(24);
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<{ kind: "reset" | "account" | "invitation"; id: string; label: string } | null>(null);
  const [changeReason, setChangeReason] = useState("");
  function refresh() { accounts.reload(); invitations.reload(); onSaved(); }
  function showLink(value: Receipt) { setReceipt({ ...value, url: new URL(value.url, location.origin).href }); setCopied(false); }
  async function invite(event: FormEvent) {
    event.preventDefault();
    setReceipt(null);
    if (await action.run(async () => {
      showLink(await api<Receipt>("/v1/workspace/invitations", {
        username: username.trim(), role, expiresInHours: expiry, reason: reason.trim(),
      }));
    }, "Invitation created. Share the link with this operator.")) {
      setUsername(""); setReason(""); refresh();
    }
  }
  async function change(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const operation = selected;
    setReceipt(null);
    if (await action.run(async () => {
      const path = operation.kind === "invitation"
        ? `/v1/workspace/invitations/${encodeURIComponent(operation.id)}/revoke`
        : `/v1/workspace/accounts/${encodeURIComponent(operation.id)}/${operation.kind === "reset" ? "reset" : "revoke"}`;
      const result = await api<Receipt>(path, { reason: changeReason.trim(), ...(operation.kind === "reset" ? { expiresInHours: 24 } : {}) });
      if (operation.kind === "reset") showLink(result);
    }, operation.kind === "reset" ? "Reset link created. Share it with the operator." : "Access revoked.")) {
      setSelected(null); setChangeReason(""); refresh();
    }
  }
  function choose(kind: "reset" | "account" | "invitation", id: string, label: string) {
    setSelected({ kind, id, label }); setChangeReason("");
  }
  return <>
    <Section title="Invite an operator" description="Create a private, single-use link. Your teammate chooses their own password.">
      <Notice error={action.error} receipt={action.receipt} />
      <form className="aw-form" onSubmit={invite}>
        <div className="aw-form-grid">
          <label>New operator name<input required maxLength={100} autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label>Invitation role<select aria-label="Invitation role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">Viewer — read evidence</option>
            <option value="analyst">Analyst — investigate</option>
            <option value="admin">Administrator — manage workspace</option>
          </select></label>
          <label>Link lifetime (hours)<input type="number" required min={1} max={168} value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} /></label>
          <label>Invitation reason<input required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </div>
        <div className="aw-form-footer"><span className="aw-help">Share the link privately. No email is sent.</span><button className="aw-primary" disabled={action.busy || !reason.trim() || !username.trim()}>Create invitation</button></div>
      </form>
      {receipt && <div className="aw-form" role="status">
        <p><strong>{receipt.invitation.purpose === "password-reset" ? "Password reset" : "Invitation"} for {receipt.invitation.username}</strong> · expires {stamp(receipt.invitation.expiresAtMs)}</p>
        <label>Invitation link<input readOnly value={receipt.url} onFocus={(e) => e.target.select()} /></label>
        <p className="aw-help">This link is shown once and grants access to the named operator. Copy it before dismissing.</p>
        <div className="aw-form-footer"><span>{copied ? "Link copied." : ""}</span><div className="aw-actions">
          <button type="button" className="aw-secondary" onClick={async () => { try { await navigator.clipboard.writeText(receipt.url); setCopied(true); } catch { setCopied(false); } }}>Copy invitation link</button>
          <button type="button" className="aw-secondary" onClick={() => setReceipt(null)}>Dismiss link</button>
        </div></div>
      </div>}
    </Section>
    <Section title="Operator accounts" description="Passwords stay private. Reset credentials or revoke access when the team changes.">
      <Notice error={accounts.error} />
      <div className="aw-table-scroll"><table className="aw-table"><thead><tr><th>Operator</th><th>Role</th><th>Access</th><th>Actions</th></tr></thead><tbody>
        {(accounts.data?.accounts ?? []).map((account) => <tr key={account.username}>
          <td><strong>{account.username}</strong></td><td>{account.role}</td><td><Status>{account.status}</Status></td>
          <td><div className="aw-actions"><button type="button" className="aw-secondary" disabled={action.busy || account.status === "revoked"} aria-label={`Reset password for ${account.username}`} onClick={() => choose("reset", account.username, account.username)}>Reset password</button><button type="button" className="aw-secondary" disabled={action.busy || account.status === "revoked"} aria-label={`Revoke access for ${account.username}`} onClick={() => choose("account", account.username, account.username)}>Revoke access</button></div></td>
        </tr>)}
      </tbody></table></div>
    </Section>
    <Section title="Invitation history" description="Used, expired and revoked links cannot be redeemed.">
      <Notice error={invitations.error} />
      <div className="aw-table-scroll"><table className="aw-table"><thead><tr><th>Operator</th><th>Purpose</th><th>State</th><th>Expires</th><th>Actions</th></tr></thead><tbody>
        {(invitations.data?.invitations ?? []).map((invitation) => <tr key={invitation.id}>
          <td>{invitation.username}</td><td>{invitation.purpose === "password-reset" ? "Password reset" : invitation.role}</td><td><Status>{invitation.state}</Status></td><td>{stamp(invitation.expiresAtMs)}</td>
          <td>{invitation.state === "pending" && <button type="button" className="aw-secondary" disabled={action.busy} aria-label={`Revoke invitation for ${invitation.username}`} onClick={() => choose("invitation", invitation.id, invitation.username)}>Revoke link</button>}</td>
        </tr>)}
      </tbody></table></div>
      {!invitations.loading && !invitations.data?.invitations.length && <p className="aw-help">No invitation links created yet.</p>}
    </Section>
    {selected && <Section title={`${selected.kind === "reset" ? "Reset password" : "Revoke access"}: ${selected.label}`}>
      <form className="aw-form" onSubmit={change}>
        <p>{selected.kind === "reset" ? "The old password and existing sessions stop working immediately. The operator must use the new link to choose a password." : selected.kind === "account" ? "This operator will lose workspace access immediately." : "This unused link will stop working immediately."}</p>
        <label>Access change reason<input required maxLength={1000} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} /></label>
        <div className="aw-form-footer"><button type="button" className="aw-secondary" disabled={action.busy} onClick={() => setSelected(null)}>Cancel change</button><button className="aw-primary" disabled={action.busy || !changeReason.trim()}>{selected.kind === "reset" ? "Create reset link" : "Confirm revocation"}</button></div>
      </form>
    </Section>}
  </>;
}
