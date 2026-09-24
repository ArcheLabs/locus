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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <WalletProvider>
        <NetworkProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </NetworkProvider>
      </WalletProvider>
    </ThemeProvider>
  </StrictMode>,
);
