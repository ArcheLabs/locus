import { Component, type ErrorInfo, type ReactNode } from "react";
import { ActionButton } from "./ActionButton.js";
import { RefreshCw } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.js";

function ErrorFallback() {
  const { t } = useI18n();
  return <main className="app-error-page"><section className="card"><h1>{t("errors.pageFailed")}</h1><p>{t("errors.reloadHint")}</p><ActionButton variant="primary" icon={RefreshCw} onClick={() => window.location.reload()}>{t("common.reload")}</ActionButton></section></main>;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error(error);
  }

  render() {
    if (this.state.failed) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
