import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles.css";
import { NetworkProvider } from "./network/NetworkProvider.js";
import { SessionProvider } from "./session/SessionProvider.js";
import { WalletProvider } from "./session/WalletProvider.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletProvider>
      <NetworkProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </NetworkProvider>
    </WalletProvider>
  </StrictMode>,
);
