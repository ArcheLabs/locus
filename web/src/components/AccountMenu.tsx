import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeftRight, CheckCircle2, ChevronDown, CircleAlert, LoaderCircle, Unplug, UserRound, X } from "lucide-react";
import { formatLocusId } from "@archelabs/locus";
import { useEffect, useRef, useState } from "react";
import type { LocusWebSession, SessionKind } from "../session/types.js";
import type { MatrixProfile } from "../matrix/MatrixProfile.js";
import { loadMatrixProfile } from "../matrix/MatrixProfile.js";
import type { SessionLifecycle } from "../session/SessionProvider.js";
import type { AccountAuthorizationState, SessionIdentityState } from "../session/types.js";
import { IdentityIcon } from "./IdentityIcon.js";
import { ActionButton } from "./ActionButton.js";
import { CopyableValue, compactValue } from "./CopyableValue.js";
import { useI18n } from "../i18n/I18nProvider.js";

type Props = {
  session: LocusWebSession | null;
  lifecycle: SessionLifecycle;
  restoreError?: string;
  pendingKind?: SessionKind | null;
  onConnect: () => void;
  onSwitchAccount: () => void;
  switchingAccount?: boolean;
  onDisconnect: () => void;
  onRemoveMatrixDevice: () => void;
  authorizationState?: AccountAuthorizationState;
  identityState?: SessionIdentityState;
  authorizationError?: string;
  onRetryAuthorization?: () => void;
};

function matrixDisplayName(profile: MatrixProfile | null, userId: string): string {
  return profile?.displayName || userId.slice(1).split(":", 1)[0] || userId;
}

export function AccountMenu({ session, lifecycle, restoreError, pendingKind = null, onConnect, onSwitchAccount, switchingAccount = false, onDisconnect, onRemoveMatrixDevice, authorizationState = "READY", identityState = "CONNECTED", authorizationError = "", onRetryAuthorization }: Props) {
  const { t, text } = useI18n();
  const [open, setOpen] = useState(false);
  const [removeConfirmation, setRemoveConfirmation] = useState(false);
  const [profileResult, setProfileResult] = useState<{ key: string; profile: MatrixProfile } | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const accountKey = session ? `${session.kind}:${session.connectionId ?? session.address}:${session.address}` : "";
  const previousAccountKey = useRef(accountKey);
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

  useEffect(() => {
    if (previousAccountKey.current === accountKey) return;
    previousAccountKey.current = accountKey;
    setOpen(false);
    setRemoveConfirmation(false);
  }, [accountKey]);

  if (!session) return <div className="disconnected-session">
    <ActionButton variant="secondary" icon={UserRound} className="profile-pill profile-button" onClick={onConnect} disabled={lifecycle === "restoring" || pendingKind !== null} aria-label={t("accounts.connect")}>
      {lifecycle === "restoring" ? t("accounts.restoring") : pendingKind ? t("common.connecting") : t("common.connect")}
    </ActionButton>
    {restoreError && <section className="session-restore-alert" role="alert">
      <strong>{t("accounts.notConnected")}</strong>
      <p>{text(restoreError)}</p>
      <ActionButton size="small" variant="secondary" icon={Unplug} onClick={onConnect}>{t("accounts.chooseSignIn")}</ActionButton>
    </section>}
  </div>;

  const locusId = formatLocusId(session.owner);
  const matrixProfile = profileResult?.key === matrixProfileKey ? profileResult.profile : null;
  const displayLabel = session.kind === "matrix"
    ? matrixDisplayName(matrixProfile, session.matrix?.userId ?? session.label)
    : compactValue(session.address || session.label);
  const matrixAvatar = session.kind === "matrix" && !avatarFailed ? matrixProfile?.avatarUrl : null;
  const signerLabel = session.kind === "matrix" ? session.matrix?.deviceId ?? session.address : session.address;
  const matrixAuthorizationLabel = identityState !== "CONNECTED" ? t("auth.checkingDevice")
    : authorizationState === "READY" ? t("accounts.accountReady")
    : authorizationState === "RETRY_REQUIRED" || authorizationState === "STATUS_UNKNOWN" || authorizationState === "REVOKED" || authorizationState === "REJECTED" ? t("accounts.attention")
      : t("accounts.accountPreparing");
  const matrixAttention = session.kind === "matrix" && (authorizationError !== ""
    || authorizationState === "RETRY_REQUIRED" || authorizationState === "STATUS_UNKNOWN" || authorizationState === "REVOKED" || authorizationState === "REJECTED");
  const matrixReady = session.kind === "matrix" && identityState === "CONNECTED" && authorizationState === "READY";
  const AccountStatusIcon = matrixAttention ? CircleAlert : session.kind === "matrix" && !matrixReady ? LoaderCircle : CheckCircle2;
  const accountStatusLabel = matrixAttention ? t("accounts.attention")
    : session.kind === "matrix" ? matrixReady ? t("accounts.accountReady") : t("accounts.accountPreparing")
      : t("common.connected");
  const accountStatusClass = matrixAttention ? "account-connection-indicator account-connection-indicator--attention"
    : session.kind === "matrix" && !matrixReady ? "account-connection-indicator account-connection-indicator--pending"
      : "account-connection-indicator account-connection-indicator--ready";

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>
      <button type="button" className="profile-pill profile-button identity-trigger" aria-label={`${t("accounts.center")}, ${text(session.kind)}`}>
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
          <Dialog.Title>{t("accounts.center")}</Dialog.Title>
          <Dialog.Close asChild><button type="button" className="icon-button" aria-label={t("accounts.closeCenter")}><X size={20} /></button></Dialog.Close>
        </header>
        <div className="account-center-body">
          <section className="account-identity-card">
            <span className="account-avatar">{matrixAvatar
              ? <img src={matrixAvatar} alt="" aria-hidden="true" onError={() => setAvatarFailed(true)} />
              : <IdentityIcon kind={session.kind} size={26} />}</span>
            <span><strong>{displayLabel}</strong><small className={accountStatusClass} aria-label={accountStatusLabel} title={accountStatusLabel}><AccountStatusIcon size={16} aria-hidden="true" /></small></span>
          </section>

          {session.kind === "matrix" && (authorizationState !== "READY" || identityState !== "CONNECTED") && <section className="account-center-section">
            <h3>{t("accounts.access")}</h3>
            <p className="account-access-status">{authorizationError ? t("auth.authorizationNeedsAction") : identityState !== "CONNECTED" ? t("auth.deviceUnknown") : matrixAuthorizationLabel}</p>
            {(identityState === "STATUS_UNKNOWN" || authorizationState === "STATUS_UNKNOWN" || authorizationState === "RETRY_REQUIRED" || authorizationState === "REJECTED") && onRetryAuthorization
              && <ActionButton size="small" variant="secondary" onClick={onRetryAuthorization}>{t("auth.checkStatus")}</ActionButton>}
          </section>}

          <section className="account-center-section">
            <h3>{t("accounts.ownership")}</h3>
            <CopyableValue label="Locus ID" value={locusId} layout="inline" copyPlacement="left" />
            <CopyableValue label="Controller" value={formatLocusId(session.controller)} layout="inline" copyPlacement="left" />
          </section>

          <section className="account-center-section">
            <h3>{t("accounts.connection")}</h3>
            {session.kind === "matrix" ? <>
              <CopyableValue label={t("accounts.matrixAccount")} value={session.matrix?.userId ?? session.address} layout="inline" copyPlacement="left" />
              <CopyableValue label={t("accounts.device")} value={session.matrix?.deviceId ?? t("accounts.unknownDevice")} layout="inline" copyPlacement="left" />
              <div className="account-center-detail"><small>{t("accounts.homeserver")}</small><span>{session.matrix?.homeserver ?? "Matrix"}</span></div>
              <div className="account-center-detail"><small>{t("accounts.verification")}</small><span className="account-verified-text"><CheckCircle2 size={15} aria-hidden="true" />{t("accounts.verified")}</span></div>
            </> : <CopyableValue label={t("accounts.signer", { kind: text(session.kind) })} value={signerLabel} layout="inline" copyPlacement="left" />}
          </section>

          {session.kind === "matrix" && <section className="account-center-section account-security-section">
            <h3>{t("accounts.security")}</h3>
            {!removeConfirmation ? <>
              <div className="account-security-action"><strong>{t("accounts.removeDevice")}</strong><ActionButton variant="danger" size="small" onClick={() => setRemoveConfirmation(true)}>{t("common.remove")}</ActionButton></div>
            </> : <div className="remove-device-confirm" role="alertdialog" aria-labelledby="remove-device-title">
              <strong id="remove-device-title">{t("accounts.removeDeviceConfirm")}</strong>
              <p>{t("accounts.removeDetails")}</p>
              <div className="remove-device-actions">
                <ActionButton variant="tertiary" onClick={() => setRemoveConfirmation(false)}>{t("common.cancel")}</ActionButton>
                <ActionButton variant="danger" onClick={() => { setOpen(false); onRemoveMatrixDevice(); }}>{t("accounts.removeDevice")}</ActionButton>
              </div>
            </div>}
          </section>}

          <footer className="account-center-footer">
            {(session.kind === "evm" || session.kind === "polkadot") && <ActionButton variant="secondary" icon={ArrowLeftRight} disabled={switchingAccount} onClick={() => {
              setOpen(false);
              window.setTimeout(onSwitchAccount, 0);
            }}>{switchingAccount ? t("accounts.switching") : t("accounts.switchAccount")}</ActionButton>}
            <ActionButton variant="danger" icon={Unplug} onClick={() => { setOpen(false); onDisconnect(); }}>{t("accounts.disconnected")}</ActionButton>
            <small>{session.kind === "matrix" ? t("accounts.keepMatrix") : session.kind === "evm" || session.kind === "polkadot" ? t("accounts.keepWallet") : t("accounts.keepSession")}</small>
          </footer>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
