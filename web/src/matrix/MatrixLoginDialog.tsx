import { useEffect, useRef, useState } from "react";
import { Modal } from "../components/Modal.js";
import { IdentityIcon } from "../components/IdentityIcon.js";
import type { LocusWebSession } from "../session/types.js";
import { connectMatrixPasswordSession, readStoredMatrixSession, restoreMatrixSession, signOutMatrixSession, type MatrixConnected, type MatrixConnectionState } from "./MatrixConnector.js";
import { beginMatrixOAuth, beginMatrixSso, discoverMatrixAuthCapabilities, type MatrixAuthCapabilities } from "./MatrixOAuth.js";
import { DEFAULT_MATRIX_PROVIDER, resolveMatrixServer } from "./MatrixProvider.js";
import type { LocusClient } from "@archelabs/locus";
import { ArrowLeft, ArrowRight, Check, LogIn, RefreshCw, X } from "lucide-react";
import { ActionButton } from "../components/ActionButton.js";

type MatrixLoginStage = "saved-account" | "provider" | "custom-server" | "discovering" | "legacy-options" | "password" | "verification";

function verificationTitle(state: MatrixConnectionState, verification: MatrixConnected["verification"]): string {
  switch (state) {
    case "AUTHENTICATED":
    case "DEVICE_KEYS_READY":
    case "TRUST_CHECKING":
    case "TRUST_UNKNOWN": return "正在检查设备状态";
    case "VERIFICATION_REQUESTED":
      return verification?.phase === "requested" ? "确认登录" : "验证设备";
    case "VERIFICATION_REQUIRED":
    case "VERIFICATION_SAS_READY": return "验证设备";
    case "VERIFICATION_CONFIRMING": return "正在确认设备状态";
    case "VERIFIED":
    case "CONTROLLER_AUTHORIZING":
    case "CONTROLLER_AUTHORIZATION_QUEUED":
    case "CONTROLLER_AUTHORIZATION_FINALIZING": return "正在完成登录";
    case "CONTROLLER_AUTHORIZATION_UNKNOWN": return "正在完成登录";
    case "CONTROLLER_REVOKED":
    case "CONTROLLER_AUTHORIZATION_FAILED":
    case "RELOGIN_REQUIRED": return "暂时无法完成登录";
    case "READY": return "已连接";
  }
}

function waitingForElement(state: MatrixConnectionState): boolean {
  return state === "VERIFICATION_REQUIRED" || state === "VERIFICATION_REQUESTED"
    || state === "VERIFICATION_SAS_READY" || state === "VERIFICATION_CONFIRMING";
}

function verificationReason(verification: MatrixConnected["verification"]): string {
  if (!verification) return "";
  if (verification.reason === "timed-out") return "验证请求已超时，请重新发起验证。";
  if (verification.reason === "unsupported-method") return "此验证请求使用当前不支持的方式，请重新发起验证。";
  if (verification.reason === "sas-mismatch") return "两台设备显示的信息不一致，验证已取消。";
  if (verification.reason === "failed") return "验证未能完成，请重新发起验证。";
  if (verification.reason === "cancelled" || verification.phase === "cancelled") return "验证请求已取消，请重新发起验证。";
  return "";
}

function verificationActionError(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "";
  if (code === "UNSUPPORTED_MATRIX_CRYPTO_REQUEST") return "此设备不支持当前验证方式，请在 Matrix 设备上重新发起验证。";
  if (code === "MATRIX_SESSION_INVALID") return "Matrix 会话已失效，请重新登录。";
  return "验证操作未能完成，请重试。";
}

export function MatrixLoginDialog({ open, onClose, onCancel, onConnected, locus, initialConnection = null }: {
  open: boolean;
  onClose: () => void;
  onCancel: (connection: MatrixConnected | null) => void;
  onConnected: (session: LocusWebSession) => void;
  locus: LocusClient | null;
  initialConnection?: MatrixConnected | null;
}) {
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
      if (pendingConnection.state === "READY") {
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
        setError(cause instanceof Error ? cause.message : "Matrix sign-in could not start.");
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
    } catch (cause) { if (attempt === authAttempt.current) setError(cause instanceof Error ? cause.message : "Matrix SSO sign-in could not start."); }
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
      if (connected.state === "READY") {
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
      if (attempt === authAttempt.current) setError(cause instanceof Error ? cause.message : "Matrix sign-in failed.");
    } finally {
      if (passwordAbort.current === abortController) passwordAbort.current = null;
      if (attempt === authAttempt.current) { setPassword(""); setWorking(false); }
    }
  }

  async function reconnectSavedMatrixDevice() {
    const stored = readStoredMatrixSession();
    if (!stored) {
      setStage("provider");
      setError("The saved Matrix session is no longer available. Sign in to Matrix to create a device.");
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
      if (connected.state === "READY") {
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
        setError(cause instanceof Error ? cause.message : "Could not restore the saved Matrix device.");
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
      setError(cause instanceof Error ? cause.message : "Could not sign out of the saved Matrix device.");
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
      if (result.state === "UNVERIFIED") setManualTrustMessage("尚未检测到验证完成，正在等待更新");
      else if (result.state === "UNKNOWN") setManualTrustMessage("暂时无法读取设备状态，正在等待更新");
    } catch {
      if (generation === dialogGeneration.current && activeConnection.current === connection) setManualTrustMessage("暂时无法读取设备状态，正在等待更新");
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
  const initializing = connectionState === "AUTHENTICATED" || connectionState === "DEVICE_KEYS_READY" || connectionState === "TRUST_CHECKING";
  const canCompare = connectionState === "VERIFICATION_SAS_READY" && verification?.phase === "sas-ready";
  const canRetryConnection = connectionState === "CONTROLLER_AUTHORIZATION_FAILED"
    || (connectionState === "CONTROLLER_AUTHORIZATION_UNKNOWN" && Boolean(pendingConnection?.error));
  const needsRelogin = connectionState === "RELOGIN_REQUIRED" || connectionState === "CONTROLLER_REVOKED";
  const incomingRequest = verification?.phase === "requested" && !verification.startedByLocus;
  const waitingForMatrixConfirmation = verification?.phase === "requested" && verification.startedByLocus;
  const verificationStatusReason = verificationReason(verification);
  const authorizationProgress = connectionState === "VERIFIED" ? "设备已验证，正在准备登录信息。"
    : connectionState === "CONTROLLER_AUTHORIZING" ? "登录信息已就绪，正在完成账户授权。"
      : connectionState === "CONTROLLER_AUTHORIZATION_QUEUED" || connectionState === "CONTROLLER_AUTHORIZATION_FINALIZING"
        ? "账户授权已提交，正在等待确认。" : "正在完成登录…";
  const legacyCapabilities = authCapabilities?.mode === "legacy" ? authCapabilities : null;
  return (
    <Modal open={open} title={showingVerification ? verificationTitle(connectionState, verification) : "Connect Matrix"} onClose={cancel} preventOutsideDismiss={working || showingVerification} preventEscapeDismiss={working || showingVerification} closeLabel={working || showingVerification ? "取消登录" : "Close"} footer={<ActionButton variant="secondary" icon={X} onClick={cancel}>取消登录</ActionButton>}>
      {!showingVerification && <p className="modal-lead">Sign in with your Matrix account.</p>}
      {showingVerification ? <div className="matrix-verification-flow" aria-live="polite">
        <section className="verification-card">
          {needsRelogin ? <>
            <p>当前登录状态不可用，请重新登录。</p>
            <ActionButton size="small" variant="primary" loading={working} disabled={working} onClick={() => void useDifferentMatrixAccount()}>重新登录</ActionButton>
          </> : initializing ?
            <div className="matrix-verification-status" role="status">正在检查设备状态…</div> : connectionState === "TRUST_UNKNOWN" ? <>
              {verificationStatusReason && <p role="status">{verificationStatusReason}</p>}
              <p role="status">{pendingConnection?.error || "正在检查设备状态，请稍候。"}</p>
              <ActionButton size="small" variant="secondary" icon={RefreshCw} loading={working} disabled={working} onClick={() => void refreshDeviceTrust()}>重试</ActionButton>
            </> : canRetryConnection ? <>
              <p>{pendingConnection?.error || "暂时无法完成登录，请重试。"}</p>
              <ActionButton size="small" variant="secondary" icon={RefreshCw} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.retryControllerAuthorization())}>重试</ActionButton>
            </> : needsElementConfirmation ? <>
              {verification?.phase === "done" ? <p className="matrix-verification-status" role="status">验证操作已完成，正在确认设备状态。</p>
                : verification?.phase === "confirming" ? <>
                  <p>请在已登录的 Matrix 设备中完成此设备的验证。</p>
                  <p className="matrix-verification-status" role="status">正在等待另一台设备完成验证。</p>
                </>
                  : verification?.phase === "unsupported" ? <>
                    {verificationStatusReason && <p role="status">{verificationStatusReason}</p>}
                    <p>请在已登录的 Matrix 设备中完成此设备的验证。</p>
                    <ActionButton size="small" variant="secondary" icon={X} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.cancelVerification())}>取消验证</ActionButton>
              </> : incomingRequest ? <>
                <p>请在已登录的 Matrix 设备中确认此次登录。</p>
                <div className="matrix-verification-actions">
                  <ActionButton size="small" variant="secondary" icon={X} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.cancelVerification())}>拒绝</ActionButton>
                  <ActionButton size="small" variant="primary" icon={Check} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.startVerification())}>接受</ActionButton>
                </div>
              </> : waitingForMatrixConfirmation ? <>
                <p>请在已登录的 Matrix 设备中确认此次登录。</p>
                <p className="matrix-verification-status" role="status">正在等待确认。</p>
                <ActionButton size="small" variant="secondary" icon={X} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.cancelVerification())}>取消验证</ActionButton>
              </> : canCompare ? <>
                <p>请核对另一台 Matrix 设备上显示的图案。</p>
                <div className="matrix-sas-emojis" aria-label="确认图案">
                  {verification.emojis.map((emoji, index) => <span className="matrix-sas-emoji" key={`${index}-${emoji.symbol}`} title={emoji.description}><span aria-hidden="true">{emoji.symbol}</span><small>{emoji.description}</small></span>)}
                </div>
                <div className="matrix-verification-actions">
                  <ActionButton size="small" variant="secondary" icon={X} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.confirmVerification(false))}>不一致</ActionButton>
                  <ActionButton size="small" variant="primary" icon={Check} loading={working} disabled={working} onClick={() => void performVerification(() => pendingConnection!.confirmVerification(true))}>一致</ActionButton>
                </div>
              </> : <>
                {verificationStatusReason && <p role="status">{verificationStatusReason}</p>}
                <p>请在已登录的 Matrix 设备中完成此设备的验证。</p>
                {verification?.phase === "sas-waiting" && <p className="matrix-verification-status" role="status">正在等待另一台设备响应。</p>}
                {manualTrustMessage && <p className="matrix-verification-status" role="status">{manualTrustMessage}</p>}
                <button type="button" className="text-button matrix-check-trust" disabled={working} onClick={() => void refreshDeviceTrust()}>已在 Matrix 设备直接验证</button>
              </>}
            </> : <div className="matrix-verification-status" role="status">{authorizationProgress}</div>}
        </section>
      </div> : <>
        {stage === "saved-account" && (() => {
          const stored = readStoredMatrixSession();
          return stored ? <div className="matrix-login-options">
            <div className="matrix-provider-choice">
              <span className="identity-icon-slot"><IdentityIcon kind="matrix" size={24} /></span>
              <span className="matrix-provider-copy"><strong>{stored.userId}</strong><small>Reconnect this Matrix account with its saved Locus device</small></span>
              <ActionButton className="matrix-auth-button" variant="primary" icon={LogIn} fullWidth loading={working} disabled={working} onClick={() => void reconnectSavedMatrixDevice()}>Reconnect Matrix</ActionButton>
            </div>
            <ActionButton variant="secondary" icon={ArrowRight} fullWidth disabled={working} onClick={() => void useDifferentMatrixAccount()}>Sign in with another Matrix account</ActionButton>
            <p className="auth-caption">Using another account removes this saved Locus device. The new device will need verification.</p>
          </div> : <div className="matrix-discovery-status" role="status">The saved Matrix session is unavailable. Choose a Matrix sign-in method.</div>;
        })()}
        {stage === "provider" && <div className="matrix-login-options">
          <div className="matrix-provider-choice">
            <span className="identity-icon-slot"><IdentityIcon kind="matrix" size={24} /></span>
            <span className="matrix-provider-copy"><strong>{DEFAULT_MATRIX_PROVIDER.label}</strong><small>Sign in with your Matrix account</small></span>
            <ActionButton className="matrix-auth-button" variant="primary" icon={LogIn} fullWidth loading={working} disabled={working} onClick={() => void startMatrixAuthentication(DEFAULT_MATRIX_PROVIDER.server, "provider")}>Continue with Matrix.org</ActionButton>
          </div>
          <ActionButton variant="secondary" icon={ArrowRight} fullWidth disabled={working} onClick={() => { setError(""); setStage("custom-server"); }}>Use another Matrix server</ActionButton>
        </div>}

        {stage === "custom-server" && <div className="matrix-login-step">
          <label className="matrix-id-field">Matrix server<input autoComplete="url" disabled={working} value={customServer} placeholder="example.org or https://matrix.example.org" onChange={(event) => { setCustomServer(event.target.value); setError(""); }} /></label>
          <p className="auth-caption">Choose the Matrix server that hosts your account. You will sign in with that server next.</p>
          <ActionButton className="matrix-auth-button" variant="primary" icon={LogIn} fullWidth loading={working} disabled={working || !customServer.trim()} onClick={() => void startMatrixAuthentication(customServer, "custom-server")}>Continue</ActionButton>
          <ActionButton variant="tertiary" icon={ArrowLeft} disabled={working} onClick={() => { setStage("provider"); setError(""); }}>Back</ActionButton>
        </div>}

        {stage === "discovering" && <div className="matrix-discovery-status" role="status" aria-live="polite">
          <RefreshCw size={20} aria-hidden="true" />
          <span>Checking sign-in options for {returnStage === "provider" ? DEFAULT_MATRIX_PROVIDER.label : customServer.trim()}…</span>
        </div>}

        {stage === "legacy-options" && legacyCapabilities && <div className="legacy-auth-options">
          <strong>Sign in to {new URL(selectedServer).host}</strong>
          <p>This server does not advertise Matrix OAuth. Choose one of its supported sign-in methods.</p>
          {legacyCapabilities.sso && <ActionButton variant="primary" icon={LogIn} fullWidth loading={working} disabled={working} onClick={() => void startSso()}>Continue with Matrix SSO</ActionButton>}
          {legacyCapabilities.password && <ActionButton variant={legacyCapabilities.sso ? "secondary" : "primary"} icon={LogIn} fullWidth disabled={working} onClick={() => setStage("password")}>Use password instead</ActionButton>}
          {!legacyCapabilities.sso && !legacyCapabilities.password && <div className="matrix-unsupported-note" role="status">This Matrix server does not advertise a supported sign-in method. Ask its administrator which methods are available.</div>}
          <ActionButton size="small" variant="tertiary" icon={ArrowLeft} disabled={working} onClick={() => { setStage(returnStage); setAuthCapabilities(null); setError(""); }}>Back</ActionButton>
        </div>}

        {stage === "password" && legacyCapabilities?.password && <div className="password-fallback">
          <p>This server supports password sign-in. Your password is sent to the selected Matrix server and is never saved by Locus.</p>
          <label className="matrix-id-field">Matrix ID or username<input autoComplete="username" disabled={working} value={passwordUser} onChange={(event) => setPasswordUser(event.target.value)} /></label>
          <label>Password<input autoComplete="current-password" type="password" disabled={working} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <ActionButton variant="primary" icon={LogIn} fullWidth loading={working} disabled={working || !passwordUser.trim() || !password} onClick={() => void passwordLogin()}>Sign in</ActionButton>
          <ActionButton variant="tertiary" icon={ArrowLeft} disabled={working} onClick={() => { setStage(legacyCapabilities.sso ? "legacy-options" : returnStage); setPassword(""); setError(""); }}>Back</ActionButton>
        </div>}
      </>}
      {error && !(showingVerification && connectionState === "TRUST_UNKNOWN")
        && !(stage === "custom-server" && !customServer.trim())
        && !(stage === "password" && (!passwordUser.trim() || !password))
        && <div className="transaction-error" role="alert">{error}</div>}
    </Modal>
  );
}
