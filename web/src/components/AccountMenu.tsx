import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Unplug, UserRound, X } from "lucide-react";
import { formatLocusId } from "@archelabs/locus";
import { useEffect, useState } from "react";
import type { LocusWebSession, SessionKind } from "../session/types.js";
import type { MatrixProfile } from "../matrix/MatrixProfile.js";
import { loadMatrixProfile } from "../matrix/MatrixProfile.js";
import type { SessionLifecycle } from "../session/SessionProvider.js";
import { IdentityIcon } from "./IdentityIcon.js";
import { ActionButton } from "./ActionButton.js";
import { CopyableValue, compactValue } from "./CopyableValue.js";

type Props = {
  session: LocusWebSession | null;
  lifecycle: SessionLifecycle;
  restoreError?: string;
  pendingKind?: SessionKind | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRemoveMatrixDevice: () => void;
};

function matrixDisplayName(profile: MatrixProfile | null, userId: string): string {
  return profile?.displayName || userId.slice(1).split(":", 1)[0] || userId;
}

export function AccountMenu({ session, lifecycle, restoreError, pendingKind = null, onConnect, onDisconnect, onRemoveMatrixDevice }: Props) {
  const [open, setOpen] = useState(false);
  const [removeConfirmation, setRemoveConfirmation] = useState(false);
  const [profileResult, setProfileResult] = useState<{ key: string; profile: MatrixProfile } | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const matrixHomeserver = session?.kind === "matrix" ? session.matrix?.homeserver : undefined;
  const matrixUserId = session?.kind === "matrix" ? session.matrix?.userId : undefined;
  const matrixProfileKey = matrixHomeserver && matrixUserId ? `${matrixHomeserver}|${matrixUserId}` : "";

  useEffect(() => {
    if (!matrixHomeserver || !matrixUserId || !matrixProfileKey) return;
    let active = true;
    let loaded: MatrixProfile | null = null;
    void loadMatrixProfile(matrixHomeserver, matrixUserId).then((profile) => {
      if (!active) { profile.dispose(); return; }
      loaded = profile;
      setProfileResult({ key: matrixProfileKey, profile });
      setAvatarFailed(false);
    }).catch(() => undefined);
    return () => {
      active = false;
      loaded?.dispose();
    };
  }, [matrixHomeserver, matrixProfileKey, matrixUserId]);

  if (!session) return <div className="disconnected-session">
    <ActionButton variant="secondary" icon={UserRound} className="profile-pill profile-button" onClick={onConnect} disabled={lifecycle === "restoring" || pendingKind !== null} aria-label="Connect an Ownership">
      {lifecycle === "restoring" ? "Restoring…" : pendingKind ? `Connecting…` : "Connect"}
    </ActionButton>
    {restoreError && <section className="session-restore-alert" role="alert">
      <strong>Not connected</strong>
      <p>{restoreError}</p>
      <ActionButton size="small" variant="secondary" icon={Unplug} onClick={onConnect}>Choose a sign-in method</ActionButton>
    </section>}
  </div>;

  const locusId = formatLocusId(session.owner);
  const matrixProfile = profileResult?.key === matrixProfileKey ? profileResult.profile : null;
  const displayLabel = session.kind === "matrix"
    ? matrixDisplayName(matrixProfile, session.matrix?.userId ?? session.label)
    : compactValue(session.address || session.label);
  const matrixAvatar = session.kind === "matrix" && !avatarFailed ? matrixProfile?.avatarUrl : null;
  const signerLabel = session.kind === "matrix" ? session.matrix?.deviceId ?? session.address : session.address;

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>
      <button type="button" className="profile-pill profile-button identity-trigger" aria-label={`Account center, ${session.kind}`}>
        <span className="identity-icon-slot">{matrixAvatar
          ? <img className="matrix-profile-avatar" src={matrixAvatar} alt="" aria-hidden="true" onError={() => setAvatarFailed(true)} />
          : <IdentityIcon kind={session.kind} size={26} />}</span>
        <span className="profile-label">{displayLabel}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="account-center-backdrop" />
      <Dialog.Content className="account-center-panel" aria-describedby={undefined}>
        <header className="account-center-header">
          <Dialog.Title>Account</Dialog.Title>
          <Dialog.Close asChild><button type="button" className="icon-button" aria-label="Close account center"><X size={20} /></button></Dialog.Close>
        </header>
        <div className="account-center-body">
          <section className="account-identity-card">
            <span className="account-avatar">{matrixAvatar
              ? <img src={matrixAvatar} alt="" aria-hidden="true" onError={() => setAvatarFailed(true)} />
              : <IdentityIcon kind={session.kind} size={26} />}</span>
            <span><strong>{displayLabel}</strong><small>Connected</small></span>
          </section>

          <section className="account-center-section">
            <h3>Ownership</h3>
            <CopyableValue label="Locus ID" value={locusId} />
            <CopyableValue label="Controller" value={formatLocusId(session.controller)} />
          </section>

          <section className="account-center-section">
            <h3>Connection</h3>
            {session.kind === "matrix" ? <>
              <CopyableValue label="Matrix account" value={session.matrix?.userId ?? session.address} />
              <CopyableValue label="Device" value={session.matrix?.deviceId ?? "Unknown device"} />
              <div className="account-center-detail"><small>Homeserver</small><span>{session.matrix?.homeserver ?? "Matrix"}</span></div>
              <div className="account-center-detail"><small>Verification</small><span className="account-verified-text">Verified</span></div>
            </> : <CopyableValue label={`${session.kind[0].toUpperCase()}${session.kind.slice(1)} signer`} value={signerLabel} />}
          </section>

          {session.kind === "matrix" && <section className="account-center-section account-security-section">
            <h3>Security</h3>
            {!removeConfirmation ? <>
              <p>Disconnecting keeps this verified device for your next Locus session.</p>
            <ActionButton variant="danger" onClick={() => setRemoveConfirmation(true)}>Remove Matrix device</ActionButton>
            </> : <div className="remove-device-confirm" role="alertdialog" aria-labelledby="remove-device-title">
              <strong id="remove-device-title">Remove this Matrix device?</strong>
              <p>This removes the saved Locus Matrix device from this browser and signs it out of Matrix. The next sign-in creates a new device and requires verification in Element.</p>
              <div className="remove-device-actions">
                <ActionButton variant="tertiary" onClick={() => setRemoveConfirmation(false)}>Cancel</ActionButton>
                <ActionButton variant="danger" onClick={() => { setOpen(false); onRemoveMatrixDevice(); }}>Remove device</ActionButton>
              </div>
            </div>}
          </section>}

          <footer className="account-center-footer">
            <ActionButton variant="secondary" icon={Unplug} onClick={() => { setOpen(false); onDisconnect(); }}>Disconnect from Locus</ActionButton>
            <small>{session.kind === "matrix" ? "Your Matrix device and crypto store will be kept." : "Only the Locus session is disconnected."}</small>
          </footer>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
