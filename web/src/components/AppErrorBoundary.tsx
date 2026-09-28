import { Component, type ErrorInfo, type ReactNode } from "react";
import { ActionButton } from "./ActionButton.js";
import { RefreshCw } from "lucide-react";

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
      return <main className="app-error-page"><section className="card"><h1>Something went wrong in this page.</h1><p>Reload Locus to try again.</p><ActionButton variant="primary" icon={RefreshCw} onClick={() => window.location.reload()}>Reload page</ActionButton></section></main>;
    }
    return this.props.children;
  }
}
