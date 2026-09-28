import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Copy, LogOut, RefreshCw, Trash2, Unplug, UserRound } from "lucide-react";
import { formatLocusId } from "@archelabs/locus";
import type { LocusWebSession, SessionKind } from "../session/types.js";
import { IdentityIcon } from "./IdentityIcon.js";
import { loadMatrixProfile, type MatrixProfile } from "../matrix/MatrixProfile.js";
import type { SessionLifecycle } from "../session/SessionProvider.js";
import { useEffect, useState } from "react";
import { ActionButton } from "./ActionButton.js";

export function AccountMenu({ session, lifecycle, restoreError, pendingKind = null, onConnect, onDisconnect, onSignOutMatrix, onClearSavedSession }: { session: LocusWebSession | null; lifecycle: SessionLifecycle; restoreError?: string; pendingKind?: SessionKind | null; onConnect: () => void; onDisconnect: () => void; onSignOutMatrix: () => void; onClearSavedSession: () => void }) {
  const [copied, setCopied] = useState(false);
  const [profileResult, setProfileResult] = useState<{ key: string; profile: MatrixProfile } | null>(null);
  const matrixHomeserver = session?.kind === "matrix" ? session.matrix?.homeserver : undefined;
  const matrixUserId = session?.kind === "matrix" ? session.matrix?.userId : undefined;
  const matrixProfileKey = matrixHomeserver && matrixUserId ? `${matrixHomeserver}|${matrixUserId}` : "";
  useEffect(() => {
    if (!matrixHomeserver || !matrixUserId || !matrixProfileKey) return;
    let active = true;
    void loadMatrixProfile(matrixHomeserver, matrixUserId).then((profile) => {
      if (active) setProfileResult({ key: matrixProfileKey, profile });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [matrixHomeserver, matrixProfileKey, matrixUserId]);
  if (!session) return <div className="disconnected-session">
    <ActionButton variant="secondary" icon={UserRound} className="profile-pill profile-button" onClick={onConnect} disabled={lifecycle === "restoring" || pendingKind !== null}>{lifecycle === "restoring" ? "Restoring…" : pendingKind ? `Waiting for ${pendingKind === "evm" ? "EVM wallet" : pendingKind === "solana" ? "Solana wallet" : pendingKind === "polkadot" ? "Polkadot wallet" : "Matrix"}…` : "Connect"}</ActionButton>
    {restoreError && <section className="session-restore-alert" role="alert">
      <strong>Not connected</strong>
      <p>{restoreError}</p>
      <ActionButton size="small" variant="secondary" icon={RefreshCw} onClick={onConnect}>Try another sign-in</ActionButton>
      <ActionButton size="small" variant="tertiary" icon={Trash2} onClick={onClearSavedSession}>Clear saved session</ActionButton>
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
  const matrixProfile = profileResult?.key === matrixProfileKey ? profileResult.profile : null;
  const identityLabel = session.kind === "matrix"
    ? matrixProfile?.displayName || session.matrix?.userId || session.label
    : session.label;
  return <>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" className="profile-pill profile-button"><span className="identity-icon-slot">{matrixProfile?.avatarUrl ? <img className="matrix-profile-avatar" src={matrixProfile.avatarUrl} alt="" aria-hidden="true" referrerPolicy="no-referrer" /> : <IdentityIcon kind={session.kind} size={24} />}</span><span className="profile-label">{identityLabel}</span><ChevronDown size={15} aria-hidden="true" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="account-menu dropdown-surface" sideOffset={8} align="end">
      <div className="account-heading"><strong>{identityLabel}</strong><small>{session.kind === "matrix" ? "Matrix Ownership" : "Ownership session"}</small></div>
      <div className="account-detail"><small>Owner</small><code>{locusId}</code></div>
      <div className="account-detail"><small>Controller</small><code>{formatLocusId(session.controller)}</code><span className="account-status">{session.kind === "matrix" ? `Verified Matrix device ${session.matrix?.deviceId} controls this master Ownership` : "Signs as this Ownership controller"}</span></div>
      <DropdownMenu.Item className="account-action" onSelect={() => void copy()}><Copy size={15} aria-hidden="true" /> {copied ? "Copied" : "Copy Locus ID"}</DropdownMenu.Item>
      <DropdownMenu.Item className="account-action" onSelect={onDisconnect}>
        <Unplug size={15} aria-hidden="true" />
        <span className="account-action-copy"><strong>Disconnect Locus</strong>{session.kind === "matrix" ? <small>Keep this verified Matrix device</small> : session.kind === "evm" ? <small>Keep the wallet connected; choose EVM to reconnect</small> : null}</span>
      </DropdownMenu.Item>
      {session.kind === "matrix" && <DropdownMenu.Item className="account-action danger" onSelect={onSignOutMatrix}>
        <LogOut size={15} aria-hidden="true" />
        <span className="account-action-copy"><strong>Sign out Matrix</strong><small>Removes this device; next login needs verification</small></span>
      </DropdownMenu.Item>}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
  </>;
}
