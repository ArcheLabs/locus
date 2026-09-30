import * as Dialog from "@radix-ui/react-dialog";
import { Activity, ArrowLeftRight, Coins, Globe2, Menu, X, Droplets } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AppRoute } from "../navigation/routes.js";
import { ARCHELABS_X_URL, LOCUS_WEBSITE_URL, MINI_GENESIS_URL } from "../navigation/links.js";

type MobileNavRoute = Extract<AppRoute, "assets" | "swap" | "liquidity" | "activity">;
const items: Array<{ route: MobileNavRoute; label: string; icon: typeof Coins }> = [
  { route: "assets", label: "Assets", icon: Coins },
  { route: "swap", label: "Swap", icon: ArrowLeftRight },
  { route: "liquidity", label: "Liquidity", icon: Droplets },
  { route: "activity", label: "Activity", icon: Activity },
];

export function MobileNavigation({ route, children, onNavigate }: {
  route: AppRoute;
  children: ReactNode;
  onNavigate: (route: MobileNavRoute) => void;
}) {
  const [open, setOpen] = useState(false);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <header className="mobile-header">
      <div className="mobile-header-row">
        <Dialog.Trigger asChild>
          <button type="button" className="mobile-menu-trigger" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-navigation-dialog">
            <Menu size={23} aria-hidden="true" />
          </button>
        </Dialog.Trigger>
        <div className="mobile-header-actions">{children}</div>
      </div>
    </header>
    <Dialog.Portal>
      <Dialog.Overlay className="mobile-navigation-backdrop" />
      <Dialog.Content id="mobile-navigation-dialog" className="mobile-navigation-sheet" aria-modal="true" aria-describedby={undefined}>
        <div className="mobile-navigation-handle" aria-hidden="true"><span /></div>
        <div className="mobile-navigation-heading">
          <Dialog.Title className="mobile-navigation-title">Navigate</Dialog.Title>
          <Dialog.Close asChild><button type="button" className="mobile-navigation-close" aria-label="Close navigation"><X size={20} aria-hidden="true" /></button></Dialog.Close>
        </div>
        <nav className="mobile-navigation-items" aria-label="Primary">
          {items.map(({ route: itemRoute, label, icon: Icon }) => {
            const active = itemRoute === route || (itemRoute === "liquidity" && route === "liquidity-new");
            return <Dialog.Close asChild key={itemRoute}>
              <button type="button" className="mobile-navigation-item" aria-current={active ? "page" : undefined} onClick={() => onNavigate(itemRoute)}>
                <Icon size={21} aria-hidden="true" />
                <span>{label}</span>
              </button>
            </Dialog.Close>;
          })}
        </nav>
        <footer className="mobile-navigation-footer" aria-label="ArcheLabs links">
          <a href={ARCHELABS_X_URL} target="_blank" rel="noopener noreferrer" aria-label="ArcheLabs on X"><span aria-hidden="true">𝕏</span></a>
          <a href={LOCUS_WEBSITE_URL} target="_blank" rel="noopener noreferrer"><Globe2 size={17} aria-hidden="true" /><small>Website</small></a>
          <a href={MINI_GENESIS_URL} target="_blank" rel="noopener noreferrer"><span className="mobile-navigation-mini-mark" aria-hidden="true">$</span><small>MINI</small></a>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
