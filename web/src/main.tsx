import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles/tokens.css";
import "./styles.css";
import "./styles/responsive.css";
import { NetworkProvider } from "./network/NetworkProvider.js";
import { SessionProvider } from "./session/SessionProvider.js";
import { WalletProvider } from "./session/WalletProvider.js";
import { ThemeProvider } from "./theme/ThemeProvider.js";
import { AppErrorBoundary } from "./components/AppErrorBoundary.js";
import { I18nProvider } from "./i18n/I18nProvider.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <AppErrorBoundary>
          <WalletProvider>
            <NetworkProvider>
              <SessionProvider>
                <App />
              </SessionProvider>
            </NetworkProvider>
          </WalletProvider>
        </AppErrorBoundary>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
