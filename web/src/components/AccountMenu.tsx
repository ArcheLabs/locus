import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Copy, LogOut, UserRound } from "lucide-react";
import { formatLocusId } from "@archelabs/locus";
import type { LocusWebSession } from "../session/types.js";
import { IdentityIcon } from "./IdentityIcon.js";
import type { SessionLifecycle } from "../session/SessionProvider.js";
import { useState } from "react";

export function AccountMenu({ session, lifecycle, restoreError, onConnect, onDisconnect, onClearSavedSession }: { session: LocusWebSession | null; lifecycle: SessionLifecycle; restoreError?: string; onConnect: () => void; onDisconnect: () => void; onClearSavedSession: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!session) return <div className="disconnected-session">
    <button type="button" className="profile-pill profile-button" onClick={onConnect} disabled={lifecycle === "restoring"}><span className="identity-icon-slot"><UserRound className="identity-icon account-placeholder-icon" size={24} aria-hidden="true" /></span><span>{lifecycle === "restoring" ? "Restoring…" : "Connect"}</span></button>
    {restoreError && <section className="session-restore-alert" role="alert">
      <strong>Not connected</strong>
      <p>{restoreError}</p>
      <button type="button" className="secondary" onClick={onConnect}>Try another sign-in</button>
      <button type="button" className="text-button" onClick={onClearSavedSession}>Sign out and clear saved session</button>
    </section>}
  </div>;
  const locusId = formatLocusId(session.owner);
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable");
      await navigator.clipboard.writeText(locusId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
    catch { setCopied(false); }
  }
  const activeSession = session;
  function disconnect() { activeSession.cleanup?.(); onDisconnect(); }
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" className="profile-pill profile-button"><span className="identity-icon-slot"><IdentityIcon kind={session.kind} size={24} /></span><span>{session.label}</span><ChevronDown size={15} aria-hidden="true" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="account-menu" sideOffset={8} align="end">
      <div className="account-heading"><strong>{session.label}</strong><small>{session.kind === "matrix" ? "Matrix Ownership" : "Ownership session"}</small></div>
      <div className="account-detail"><small>Owner</small><code>{locusId}</code></div>
      <div className="account-detail"><small>Controller</small><code>{formatLocusId(session.controller)}</code><span className="account-status">{session.kind === "matrix" ? `Verified Matrix device ${session.matrix?.deviceId} controls this master Ownership` : "Signs as this Ownership controller"}</span></div>
      <DropdownMenu.Item className="account-action" onSelect={() => void copy()}><Copy size={15} aria-hidden="true" /> {copied ? "Copied" : "Copy Locus ID"}</DropdownMenu.Item>
      <DropdownMenu.Item className="account-action danger" onSelect={disconnect}><LogOut size={15} aria-hidden="true" /> Disconnect</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
