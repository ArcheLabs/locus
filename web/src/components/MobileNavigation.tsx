import * as Dialog from "@radix-ui/react-dialog";
import { Activity, ArrowLeft, ArrowLeftRight, Coins, Menu, Settings, Send, X, Droplets } from "lucide-react";
import { SiGithub } from "react-icons/si";
import { useState, type ReactNode } from "react";
import type { AppRoute } from "../navigation/routes.js";
import { ARCHELABS_X_URL, LOCUS_GITHUB_URL, MINI_GENESIS_URL } from "../navigation/links.js";
import { SettingsFields } from "./SettingsPanel.js";
import { useI18n } from "../i18n/I18nProvider.js";

type MobileNavRoute = Extract<AppRoute, "assets" | "send" | "swap" | "liquidity" | "activity">;
const items: Array<{ route: MobileNavRoute; label: string; icon: typeof Coins }> = [
  { route: "assets", label: "Assets", icon: Coins },
  { route: "send", label: "Send", icon: Send },
  { route: "swap", label: "Swap", icon: ArrowLeftRight },
  { route: "liquidity", label: "Liquidity", icon: Droplets },
  { route: "activity", label: "Activity", icon: Activity },
];

export function MobileNavigation({ route, children, homeHref, onHome, onNavigate }: {
  route: AppRoute;
  children: ReactNode;
  homeHref: string;
  onHome: () => void;
  onNavigate: (route: MobileNavRoute) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { t, text } = useI18n();
  return <Dialog.Root open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setShowSettings(false); }}>
    <header className="mobile-header">
      <div className="mobile-header-row">
        <Dialog.Trigger asChild>
          <button type="button" className="mobile-menu-trigger" aria-label={t("common.navigate")} aria-expanded={open} aria-controls="mobile-navigation-dialog">
            <Menu size={23} aria-hidden="true" />
          </button>
        </Dialog.Trigger>
        <Dialog.Close asChild>
          <a href={homeHref} className="brand brand--mobile" aria-label={t("common.home")} onClick={(event) => { event.preventDefault(); setShowSettings(false); onHome(); }}>Locus</a>
        </Dialog.Close>
        <div className="mobile-header-actions">{children}</div>
      </div>
    </header>
    <Dialog.Portal>
      <Dialog.Overlay className="mobile-navigation-backdrop" />
      <Dialog.Content id="mobile-navigation-dialog" className="mobile-navigation-sheet" aria-modal="true" aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <div className="mobile-navigation-handle" aria-hidden="true"><span /></div>
        <div className="mobile-navigation-heading">
          <Dialog.Title className="mobile-navigation-title">{showSettings ? t("settings.title") : t("common.navigate")}</Dialog.Title>
          <Dialog.Close asChild><button type="button" className="mobile-navigation-close" aria-label={t("common.close")} onClick={() => setShowSettings(false)}><X size={20} aria-hidden="true" /></button></Dialog.Close>
        </div>
        {showSettings ? <div className="mobile-navigation-settings">
          <button type="button" className="mobile-navigation-back" onClick={() => setShowSettings(false)}><ArrowLeft size={17} aria-hidden="true" />{t("common.back")}</button>
          <SettingsFields mobile />
        </div> : <nav className="mobile-navigation-items" aria-label={t("common.primaryNavigation")}>
          {items.map(({ route: itemRoute, label, icon: Icon }) => {
            const active = itemRoute === route || (itemRoute === "liquidity" && route === "liquidity-new");
            return <Dialog.Close asChild key={itemRoute}>
              <button type="button" className="mobile-navigation-item" aria-current={active ? "page" : undefined} onClick={() => onNavigate(itemRoute)}>
                <Icon size={21} aria-hidden="true" />
                <span>{text(label)}</span>
              </button>
            </Dialog.Close>;
          })}
          <button type="button" className="mobile-navigation-item" onClick={() => setShowSettings(true)}><Settings size={21} aria-hidden="true" /><span>{t("common.settings")}</span></button>
        </nav>}
        {!showSettings && <footer className="mobile-navigation-footer" aria-label={t("common.links")}>
          <a href={LOCUS_GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label={t("common.github")}><SiGithub size={18} aria-hidden="true" /></a>
          <a href={ARCHELABS_X_URL} target="_blank" rel="noopener noreferrer" aria-label={t("common.onX")}><span aria-hidden="true">𝕏</span></a>
          <a href={MINI_GENESIS_URL} target="_blank" rel="noopener noreferrer" aria-label={t("common.mini")}><span className="mobile-navigation-mini-mark">$MINI</span></a>
        </footer>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
