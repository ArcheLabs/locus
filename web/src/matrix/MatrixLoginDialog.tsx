import { useEffect, useRef, useState } from "react";
import { Modal } from "../components/Modal.js";
import { IdentityIcon } from "../components/IdentityIcon.js";
import type { LocusWebSession } from "../session/types.js";
import { connectMatrixPasswordSession, readStoredMatrixSession, restoreMatrixSession, signOutMatrixSession, type MatrixConnected, type MatrixConnectionState } from "./MatrixConnector.js";
import { beginMatrixOAuth, beginMatrixSso, discoverMatrixAuthCapabilities, type MatrixAuthCapabilities } from "./MatrixOAuth.js";
import { DEFAULT_MATRIX_PROVIDER, resolveMatrixServer } from "./MatrixProvider.js";
import type { LocusClient } from "@archelabs/locus";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, LogIn, RefreshCw, X } from "lucide-react";
import { ActionButton } from "../components/ActionButton.js";
import { useI18n } from "../i18n/I18nProvider.js";

type MatrixLoginStage = "saved-account" | "provider" | "custom-server" | "discovering" | "legacy-options" | "password" | "verification";

function verificationTitle(state: MatrixConnectionState, verification: MatrixConnected["verification"]): string {
  switch (state) {
    case "AUTHENTICATED":
    case "DEVICE_KEYS_READY":
    case "TRUST_CHECKING": return "Signing in…";
    case "TRUST_UNKNOWN": return "Signing in…";
    case "VERIFICATION_REQUESTED":
      return verification?.phase === "requested" ? "Confirm sign-in" : "Verify device";
    case "VERIFICATION_REQUIRED":
    case "VERIFICATION_SAS_READY": return "Verify device";
    case "VERIFICATION_CONFIRMING": return "Confirming device status…";
    case "RELOGIN_REQUIRED": return "Sign-in is unavailable. Please sign in again.";
    case "CONNECTED": return "Connected";
  }
}

function waitingForElement(state: MatrixConnectionState): boolean {
  return state === "VERIFICATION_REQUIRED" || state === "VERIFICATION_REQUESTED"
    || state === "VERIFICATION_SAS_READY" || state === "VERIFICATION_CONFIRMING";
}

function verificationReason(verification: MatrixConnected["verification"]): string {
  if (!verification) return "";
  if (verification.reason === "timed-out") return "The verification request timed out. Start verification again.";
  if (verification.reason === "unsupported-method") return "This verification request uses a method that is not supported. Start verification again.";
  if (verification.reason === "sas-mismatch") return "The devices showed different information. Verification was cancelled.";
  if (verification.reason === "failed") return "Verification could not be completed. Try again.";
  if (verification.reason === "cancelled" || verification.phase === "cancelled") return "The verification request was cancelled. Start verification again.";
  return "";
}

function verificationActionError(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "";
  if (code === "UNSUPPORTED_MATRIX_CRYPTO_REQUEST") return "This device does not support the current verification method. Restart verification from a Matrix device.";
  if (code === "MATRIX_SESSION_INVALID") return "The Matrix session has expired. Sign in again.";
  return "Verification could not be completed. Try again.";
}

export function MatrixLoginDialog({ open, onClose, onCancel, onConnected, locus, initialConnection = null }: {
  open: boolean;
  onClose: () => void;
  onCancel: (connection: MatrixConnected | null) => void;
  onConnected: (session: LocusWebSession) => void;
  locus: LocusClient | null;
  initialConnection?: MatrixConnected | null;
}) {
  const { t, text } = useI18n();
  const [stage, setStage] = useState<MatrixLoginStage>(initialConnection ? "verification" : readStoredMatrixSession() ? "saved-account" : "provider");
  const [returnStage, setReturnStage] = useState<"provider" | "custom-server">("provider");
  const [selectedServer, setSelectedServer] = useState("");
  const [customServer, setCustomServer] = useState("");
  const [passwordUser, setPasswordUser] = useState("");
  const [password, setPassword] = useState("");
  const [authCapabilities, setAuthCapabilities] = useState<MatrixAuthCapabilities | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [pendingConnection, setPendingConnection] = useState<MatrixConnected | null>(initialConnection);
  const [connectionState, setConnectionState] = useState<MatrixConnectionState>(initialConnection?.state ?? "AUTHENTICATED");
  const [manualTrustMessage, setManualTrustMessage] = useState("");
  const [, refreshConnection] = useState(0);
  const authAttempt = useRef(0);
  const dialogGeneration = useRef(0);
  const activeConnection = useRef<MatrixConnected | null>(initialConnection);
  const passwordAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    dialogGeneration.current += 1;
    if (!open) {
      activeConnection.current = null;
      return;
    }
    if (initialConnection) {
      setManualTrustMessage("");
      activeConnection.current = initialConnection;
      setPendingConnection(initialConnection);
      setConnectionState(initialConnection.state);
      setSelectedServer(initialConnection.stored.homeserver);
      setStage("verification");
      setError(initialConnection.error || "");
      return;
    }
    activeConnection.current = null;
    setPendingConnection(null);
    setConnectionState("AUTHENTICATED");
    setStage(readStoredMatrixSession() ? "saved-account" : "provider");
    setError("");
    setManualTrustMessage("");
  }, [initialConnection, open]);

  useEffect(() => {
    if (!pendingConnection) return;
    const refresh = () => {
      if (activeConnection.current !== pendingConnection) return;
      setConnectionState(pendingConnection.state);
      setError(pendingConnection.error || "");
      if (pendingConnection.state !== "VERIFICATION_REQUIRED") setManualTrustMessage("");
      refreshConnection((value) => value + 1);
      if (pendingConnection.state === "CONNECTED") {
        const connected = pendingConnection;
        activeConnection.current = null;
        setPendingConnection(null);
        onConnected(connected.session);
        onClose();
      }
    };
    const unsubscribe = pendingConnection.subscribe(refresh);
    refresh();
    return unsubscribe;
  }, [onClose, onConnected, pendingConnection]);

  async function startMatrixAuthentication(serverInput: string, origin: "provider" | "custom-server") {
    const attempt = ++authAttempt.current;
    setWorking(true);
    setError("");
    setStage("discovering");
    try {
      const discovered = await resolveMatrixServer(serverInput);
      if (attempt !== authAttempt.current) return;
      setSelectedServer(discovered);
      setReturnStage(origin);
      const capabilities = await discoverMatrixAuthCapabilities(discovered);
      if (attempt !== authAttempt.current) return;
      setAuthCapabilities(capabilities);
      if (capabilities.mode === "oauth") {
        await beginMatrixOAuth(discovered, capabilities);
      } else if (capabilities.sso) {
        setStage("legacy-options");
      } else if (capabilities.password) {
        setStage("password");
      } else {
        setStage("legacy-options");
      }
    } catch (cause) {
      if (attempt === authAttempt.current) {
        setStage(origin);
        setError(t("ui.matrixSignInStartFailed"));
      }
    } finally { if (attempt === authAttempt.current) setWorking(false); }
  }

  async function startSso() {
    const attempt = ++authAttempt.current;
    setWorking(true);
    setError("");
    try {
      if (!selectedServer || !authCapabilities) throw new Error("Choose a Matrix server and discover its supported login methods first.");
      await beginMatrixSso(selectedServer, authCapabilities);
    } catch { if (attempt === authAttempt.current) setError(t("ui.matrixSsoStartFailed")); }
    finally { if (attempt === authAttempt.current) setWorking(false); }
  }

  async function passwordLogin() {
    if (authCapabilities?.mode !== "legacy" || !authCapabilities.password) {
      setError("This homeserver has not advertised password login.");
      return;
    }
    const attempt = ++authAttempt.current;
    const abortController = new AbortController();
    passwordAbort.current = abortController;
    setWorking(true);
    setError("");
    try {
      const connected = await connectMatrixPasswordSession(
        selectedServer,
        passwordUser.trim(),
        password,
        { locus, onState: (state) => { if (attempt === authAttempt.current) setConnectionState(state); }, signal: abortController.signal },
      );
      if (attempt !== authAttempt.current) {
        connected.session.cleanup?.();
        return;
      }
      if (connected.state === "CONNECTED") {
        onConnected(connected.session);
        onClose();
        return;
      }
      activeConnection.current = connected;
      setPendingConnection(connected);
      setStage("verification");
      setConnectionState(connected.state);
      setError(connected.error || "");
      setPassword("");
    } catch (cause) {
      if (attempt === authAttempt.current) setError(t("ui.matrixSignInFailed"));
    } finally {
      if (passwordAbort.current === abortController) passwordAbort.current = null;
      if (attempt === authAttempt.current) { setPassword(""); setWorking(false); }
    }
  }

  async function reconnectSavedMatrixDevice() {
    const stored = readStoredMatrixSession();
    if (!stored) {
      setStage("provider");
        setError(t("ui.savedDeviceUnavailable"));
      return;
    }
    const attempt = ++authAttempt.current;
    setWorking(true);
    setError("");
    try {
      const connected = await restoreMatrixSession(stored, { locus, onState: (state) => { if (attempt === authAttempt.current) setConnectionState(state); } });
      if (attempt !== authAttempt.current) {
        connected.session.cleanup?.();
        return;
      }
      if (connected.state === "CONNECTED") {
        onConnected(connected.session);
        onClose();
        return;
      }
      activeConnection.current = connected;
      setPendingConnection(connected);
      setConnectionState(connected.state);
      setSelectedServer(stored.homeserver);
      setStage("verification");
      setError(connected.error || "");
    } catch (cause) {
      if (attempt === authAttempt.current) {
        setStage(readStoredMatrixSession() ? "saved-account" : "provider");
        setError(t("ui.restoreDeviceFailed"));
      }
    } finally {
      if (attempt === authAttempt.current) setWorking(false);
    }
  }

  async function useDifferentMatrixAccount() {
    const attempt = ++authAttempt.current;
    const stored = readStoredMatrixSession();
    if (!stored) {
      setStage("provider");
      return;
    }
    setWorking(true);
    setError("");
    try {
      await signOutMatrixSession(stored);
      if (attempt !== authAttempt.current) return;
      activeConnection.current = null;
      setPendingConnection(null);
      setStage("provider");
    } catch (cause) {
      if (attempt !== authAttempt.current) return;
      const localSessionStillExists = readStoredMatrixSession() !== null;
      if (!localSessionStillExists) {
        pendingConnection?.session.cleanup?.();
        activeConnection.current = null;
        setPendingConnection(null);
      }
      setStage(localSessionStillExists ? "saved-account" : "provider");
      setError(t("ui.signOutDeviceFailed"));
    } finally {
      if (attempt === authAttempt.current) setWorking(false);
    }
  }

  async function performVerification(action: () => Promise<void>, connection = pendingConnection) {
    if (!connection) return;
    const generation = dialogGeneration.current;
    setWorking(true);
    setError("");
    try { await action(); }
    catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "";
      if (generation === dialogGeneration.current && activeConnection.current === connection && code !== "UNSUPPORTED_MATRIX_CRYPTO_REQUEST") {
        setError(verificationActionError(cause));
      }
    }
    finally { if (generation === dialogGeneration.current && activeConnection.current === connection) setWorking(false); }
  }

  async function refreshDeviceTrust() {
    const connection = pendingConnection;
    if (!connection) return;
    const generation = dialogGeneration.current;
    setWorking(true);
    setError("");
    setManualTrustMessage("");
    try {
      const result = await connection.refreshDeviceTrust();
      if (generation !== dialogGeneration.current || activeConnection.current !== connection) return;
      if (result.state === "UNVERIFIED") setManualTrustMessage(t("ui.verificationNotDetected"));
      else if (result.state === "UNKNOWN") setManualTrustMessage(t("ui.verificationStatusUnknown"));
    } catch {
      if (generation === dialogGeneration.current && activeConnection.current === connection) setManualTrustMessage(t("ui.verificationStatusUnknown"));
    } finally { if (generation === dialogGeneration.current && activeConnection.current === connection) setWorking(false); }
  }

  function cancel() {
    authAttempt.current += 1;
    dialogGeneration.current += 1;
    passwordAbort.current?.abort();
    passwordAbort.current = null;
    onCancel(pendingConnection);
    activeConnection.current = null;
    setPendingConnection(null);
    setPassword("");
    setWorking(false);
    setError("");
    setManualTrustMessage("");
    setStage("provider");
    setReturnStage("provider");
    setSelectedServer("");
    setCustomServer("");
    setPasswordUser("");
    setAuthCapabilities(null);
    onClose();
  }

  const verification = pendingConnection?.verification ?? null;
  const showingVerification = Boolean(pendingConnection);
  const needsElementConfirmation = waitingForElement(connectionState);
  const initializing = connectionState === "AUTHENTICATED" || connectionState === "DEVICE_KEYS_READY" || connectionState === "TRUST_CHECKING" || connectionState === "TRUST_UNKNOWN";
  const showingLoginProgress = initializing
    || connectionState === "VERIFICATION_CONFIRMING" || verification?.phase === "done";
  const canCompare = connectionState === "VERIFICATION_SAS_READY" && verification?.phase === "sas-ready";
  const needsRelogin = connectionState === "RELOGIN_REQUIRED";
  const incomingRequest = verification?.phase === "requested" && !verification.startedByLocus;
  const waitingForMatrixConfirmation = verification?.phase === "requested" && verification.startedByLocus;
  const verificationStatusReason = verificationReason(verification);
  const legacyCapabilities = authCapabilities?.mode === "legacy" ? authCapabilities : null;
  return (
    <Modal open={open} title={showingVerification
      ? showingLoginProgress
        ? <span className="matrix-login-title-progress"><LoaderCircle aria-hidden="true" size={22} />{text(verificationTitle(connectionState, verification))}</span>
        : text(verificationTitle(connectionState, verification))
      : t("ui.connectMatrix")} onClose={cancel} closeLabel={t("ui.cancelSignIn")} footer={<ActionButton variant="secondary" icon={X} onClick={cancel}>{t("ui.cancelSignIn")}</ActionButton>}>
      {!showingVerification && <p className="modal-lead">{t("ui.signInMatrix")}</p>}
      {showingVerification ? <div className="matrix-verification-flow" aria-live="polite">
        <section className="verification-card">
          {needsRelogin ? <>
            <p>{t("ui.signInUnavailable")}</p>
            <ActionButton size="small" variant="primary" loading={working} disabled={working} onClick={() => void useDifferentMatrixAccount()}>{t("ui.signInAgain")}</ActionButton>
          </> : initializing ?
            <div className="matrix-verification-status" role="status">{t("auth.verifyingDevice")}</div> : needsElementConfirmation ? <>
              {verification?.phase === "done" ? <p className="matrix-verification-status" role="status">{t("ui.verificationDone")}</p>
                : verification?.phase === "confirming" ? <>
                  <p>{t("ui.verifyDeviceHelp")}</p>
                  <p className="matrix-verification-status" role="status">{t("ui.waitingVerification")}</p>
                </>
                  : verification?.phase === "unsupported" ? <>
                    {verificationStatusReason && <p role="status">{text(verificationStatusReason)}</p>}
                    <p>{t("ui.verifyDeviceHelp")}</p>
                    <ActionButton size="small" variant="secondary" icon={X} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.cancelVerification())}>{t("ui.cancelVerification")}</ActionButton>
              </> : incomingRequest ? <>
                <p>{t("ui.confirmLoginHelp")}</p>
                <div className="matrix-verification-actions">
                  <ActionButton size="small" variant="secondary" icon={X} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.cancelVerification())}>{t("ui.reject")}</ActionButton>
                  <ActionButton size="small" variant="primary" icon={Check} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.startVerification())}>{t("ui.accept")}</ActionButton>
                </div>
              </> : waitingForMatrixConfirmation ? <>
                <p>{t("ui.confirmLoginHelp")}</p>
                <p className="matrix-verification-status" role="status">{t("ui.waitingSignInConfirm")}</p>
                <ActionButton size="small" variant="secondary" icon={X} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.cancelVerification())}>{t("ui.cancelVerification")}</ActionButton>
              </> : canCompare ? <>
                <p>{t("ui.checkPattern")}</p>
                <div className="matrix-sas-emojis" aria-label={t("ui.sasPatternLabel")}>
                  {verification.emojis.map((emoji, index) => <span className="matrix-sas-emoji" key={`${index}-${emoji.symbol}`} title={text(emoji.description)}><span aria-hidden="true">{emoji.symbol}</span><small>{text(emoji.description)}</small></span>)}
                </div>
                <div className="matrix-verification-actions">
                  <ActionButton size="small" variant="secondary" icon={X} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.confirmVerification(false))}>{t("ui.patternMismatch")}</ActionButton>
                  <ActionButton size="small" variant="primary" icon={Check} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.confirmVerification(true))}>{t("ui.patternMatches")}</ActionButton>
                </div>
              </> : <>
                {verificationStatusReason && <p role="status">{text(verificationStatusReason)}</p>}
                <p>{t("ui.verifyDeviceHelp")}</p>
                {verification?.phase === "sas-waiting" && <p className="matrix-verification-status" role="status">{t("ui.anotherDeviceWait")}</p>}
                {manualTrustMessage && <p className="matrix-verification-status" role="status">{text(manualTrustMessage)}</p>}
                <button type="button" className="text-button matrix-check-trust" disabled={working} onClick={() => void refreshDeviceTrust()}>{t("ui.directVerifyCheck")}</button>
              </>}
            </> : <div className="matrix-verification-status" role="status">{t("auth.checkingDevice")}</div>}
        </section>
      </div> : <>
        {stage === "saved-account" && (() => {
          const stored = readStoredMatrixSession();
          return stored ? <div className="matrix-login-options">
            <div className="matrix-provider-choice">
              <span className="identity-icon-slot"><IdentityIcon kind="matrix" size={24} /></span>
              <span className="matrix-provider-copy"><strong>{stored.userId}</strong><small>{t("ui.reconnectSaved")}</small></span>
              <ActionButton className="matrix-auth-button" variant="primary" icon={LogIn} fullWidth loading={working} disabled={working} onClick={() => void reconnectSavedMatrixDevice()}>{t("ui.reconnectMatrix")}</ActionButton>
            </div>
            <ActionButton variant="secondary" icon={ArrowRight} fullWidth disabled={working} onClick={() => void useDifferentMatrixAccount()}>{t("ui.anotherMatrix")}</ActionButton>
            <p className="auth-caption">{t("ui.otherAccountNeedsNewVerification")}</p>
          </div> : <div className="matrix-discovery-status" role="status">{t("ui.savedMatrixUnavailable")}</div>;
        })()}
        {stage === "provider" && <div className="matrix-login-options">
          <div className="matrix-provider-choice">
            <span className="identity-icon-slot"><IdentityIcon kind="matrix" size={24} /></span>
            <span className="matrix-provider-copy"><strong>{DEFAULT_MATRIX_PROVIDER.label}</strong><small>{t("ui.signInOptionLead")}</small></span>
            <ActionButton className="matrix-auth-button" variant="primary" icon={LogIn} fullWidth loading={working} disabled={working} onClick={() => void startMatrixAuthentication(DEFAULT_MATRIX_PROVIDER.server, "provider")}>{t("ui.continueMatrix")}</ActionButton>
          </div>
          <ActionButton variant="secondary" icon={ArrowRight} fullWidth disabled={working} onClick={() => { setError(""); setStage("custom-server"); }}>{t("ui.useAnotherServer")}</ActionButton>
        </div>}

        {stage === "custom-server" && <div className="matrix-login-step">
          <label className="matrix-id-field">{t("ui.matrixServer")}<input autoComplete="url" disabled={working} value={customServer} placeholder="example.org or https://matrix.example.org" onChange={(event) => { setCustomServer(event.target.value); setError(""); }} /></label>
          <p className="auth-caption">{t("ui.customServerHelp")}</p>
          <ActionButton className="matrix-auth-button" variant="primary" icon={LogIn} fullWidth loading={working} disabled={working || !customServer.trim()} onClick={() => void startMatrixAuthentication(customServer, "custom-server")}>{t("ui.continue")}</ActionButton>
          <ActionButton variant="tertiary" icon={ArrowLeft} disabled={working} onClick={() => { setStage("provider"); setError(""); }}>{t("ui.back")}</ActionButton>
        </div>}

        {stage === "discovering" && <div className="matrix-discovery-status" role="status" aria-live="polite">
          <RefreshCw size={20} aria-hidden="true" />
          <span>{t("ui.checkingMatrixMethods", { server: returnStage === "provider" ? DEFAULT_MATRIX_PROVIDER.label : customServer.trim() })}</span>
        </div>}

        {stage === "legacy-options" && legacyCapabilities && <div className="legacy-auth-options">
          <strong>{t("ui.signInToServer", { server: new URL(selectedServer).host })}</strong>
          <p>{t("ui.matrixOAuthMissing")}</p>
          {legacyCapabilities.sso && <ActionButton variant="primary" icon={LogIn} fullWidth loading={working} disabled={working} onClick={() => void startSso()}>{t("ui.continueSso")}</ActionButton>}
          {legacyCapabilities.password && <ActionButton variant={legacyCapabilities.sso ? "secondary" : "primary"} icon={LogIn} fullWidth disabled={working} onClick={() => setStage("password")}>{t("ui.usePassword")}</ActionButton>}
          {!legacyCapabilities.sso && !legacyCapabilities.password && <div className="matrix-unsupported-note" role="status">{t("ui.unsupportedMatrixServer")}</div>}
          <ActionButton size="small" variant="tertiary" icon={ArrowLeft} disabled={working} onClick={() => { setStage(returnStage); setAuthCapabilities(null); setError(""); }}>{t("ui.back")}</ActionButton>
        </div>}

        {stage === "password" && legacyCapabilities?.password && <div className="password-fallback">
          <p>{t("ui.passwordHelp")}</p>
          <label className="matrix-id-field">{t("ui.matrixId")}<input autoComplete="username" disabled={working} value={passwordUser} onChange={(event) => setPasswordUser(event.target.value)} /></label>
          <label>{t("ui.password")}<input autoComplete="current-password" type="password" disabled={working} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <ActionButton variant="primary" icon={LogIn} fullWidth loading={working} disabled={working || !passwordUser.trim() || !password} onClick={() => void passwordLogin()}>{t("common.signIn")}</ActionButton>
          <ActionButton variant="tertiary" icon={ArrowLeft} disabled={working} onClick={() => { setStage(legacyCapabilities.sso ? "legacy-options" : returnStage); setPassword(""); setError(""); }}>{t("ui.back")}</ActionButton>
        </div>}
      </>}
      {error && !initializing
        && !(stage === "custom-server" && !customServer.trim())
        && !(stage === "password" && (!passwordUser.trim() || !password))
        && <div className="transaction-error" role="alert">{text(error)}</div>}
    </Modal>
  );
}
