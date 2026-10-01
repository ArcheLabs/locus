import type { LocusWebSession, SessionAccessSnapshot } from "./types.js";

export type ActionAuthorizationContext = {
  networkMode: boolean;
  networkReady: boolean;
  authorizationScopeKey: string | null;
  session: LocusWebSession | null;
  access: SessionAccessSnapshot | null;
};

export function canPerformAuthorizedAction(context: ActionAuthorizationContext): boolean {
  if (!context.networkMode) return true;
  if (!context.networkReady || !context.session) return false;
  if (context.session.kind !== "matrix") return true;
  return context.access?.identity === "CONNECTED"
    && context.access.authorization === "READY"
    && context.authorizationScopeKey !== null
    && context.access.scopeKey === context.authorizationScopeKey;
}

export function authorizationWaitMessage(context: ActionAuthorizationContext): string {
  if (!context.networkMode) return "";
  if (!context.networkReady) return "网络或服务尚未就绪，请稍候。";
  if (!context.session) return "请先连接账户。";
  if (context.session.kind !== "matrix") return "";
  if (context.access?.identity === "STATUS_UNKNOWN") return "正在检查设备状态，请稍候。";
  if (context.access?.identity !== "CONNECTED") return "设备状态暂时不可用，敏感操作已暂停。";
  if (context.access?.authorization === "REVOKED") return "此设备的账户授权已撤销，请使用其他已授权设备。";
  if (context.access?.authorization === "REJECTED" || context.access?.authorization === "RETRY_REQUIRED") {
    return "账户授权暂未完成，请在账户菜单中重试。";
  }
  return "正在准备账户，请稍候。";
}
