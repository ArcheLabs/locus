import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Copy, LogOut, UserRound } from "lucide-react";
import { formatLocusId } from "@archelabs/locus";
import type { LocusWebSession } from "../session/types.js";
import { clearStoredMatrixSession } from "../matrix/MatrixConnector.js";
import { SiEthereum, SiMatrix, SiPolkadot, SiSolana } from "react-icons/si";
import type { IconType } from "react-icons";

export function AccountMenu({ session, onConnect, onDisconnect }: { session: LocusWebSession | null; onConnect: () => void; onDisconnect: () => void }) {
  if (!session) return <button type="button" className="profile-pill profile-button" onClick={onConnect}><span className="neutral-mark"><UserRound size={17} aria-hidden="true" /></span><span>Connect</span></button>;
  const locusId = formatLocusId(session.owner);
  async function copy() { await navigator.clipboard?.writeText(locusId); }
  const activeSession = session;
  function disconnect() { activeSession.cleanup?.(); clearStoredMatrixSession(); onDisconnect(); }
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" className="profile-pill profile-button"><span className={`wallet-mark ${session.kind}`}><SessionIcon kind={session.kind} /></span><span>{session.label}</span><ChevronDown size={15} aria-hidden="true" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="account-menu" sideOffset={8} align="end">
      <div className="account-heading"><strong>{session.label}</strong><small>{session.kind === "matrix" ? "Matrix Ownership" : "Ownership session"}</small></div>
      <div className="account-detail"><small>Owner</small><code>{locusId}</code></div>
      {session.kind === "matrix" && <div className="account-detail"><small>Controller</small><code>Device {session.matrix?.deviceId}</code><span className="account-status">Local controller authorization</span></div>}
      <DropdownMenu.Item className="account-action" onSelect={() => void copy()}><Copy size={15} aria-hidden="true" /> Copy Locus ID</DropdownMenu.Item>
      <DropdownMenu.Item className="account-action danger" onSelect={disconnect}><LogOut size={15} aria-hidden="true" /> Disconnect</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

function SessionIcon({ kind }: { kind: LocusWebSession["kind"] }) {
  const icons: Record<LocusWebSession["kind"], IconType> = { matrix: SiMatrix, evm: SiEthereum, polkadot: SiPolkadot, solana: SiSolana };
  const Icon = icons[kind];
  return <Icon size={16} aria-hidden="true" />;
}
