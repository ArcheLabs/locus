import { Hash, Mail } from "lucide-react";
import { SiGithub, SiMatrix, SiPolkadot, SiTelegram } from "react-icons/si";
import solanaMark from "../assets/brands/solana.svg";
import type { SessionKind } from "../session/types.js";
import type { RecipientType } from "../locus/recipients.js";
import "../styles/identity-icons.css";

export type IdentityKind = SessionKind | RecipientType;
type IdentityIconProps = {
  kind: IdentityKind;
  size?: number;
  className?: string;
};

function iconClass(kind: IdentityKind, className: string): string {
  return ["identity-icon", `identity-icon--${kind}`, className].filter(Boolean).join(" ");
}

export function IdentityIcon({ kind, size = 24, className = "" }: IdentityIconProps) {
  const iconSize = Number.isInteger(size) && size > 0 ? size : 24;
  const classes = iconClass(kind, className);
  const iconStyle = { width: iconSize, height: iconSize };
  switch (kind) {
    case "matrix":
      return <SiMatrix className={classes} size={iconSize} style={iconStyle} aria-hidden="true" />;
    case "telegram":
      return <SiTelegram className={classes} size={iconSize} style={iconStyle} aria-hidden="true" />;
    case "github":
      return <SiGithub className={classes} size={iconSize} style={iconStyle} aria-hidden="true" />;
    case "polkadot":
      return <SiPolkadot className={classes} size={iconSize} style={iconStyle} aria-hidden="true" />;
    case "solana":
      return <img className={classes} src={solanaMark} width={iconSize} height={iconSize} style={iconStyle} alt="" aria-hidden="true" />;
    case "email":
      return <Mail className={classes} size={iconSize} strokeWidth={1.9} style={iconStyle} aria-hidden="true" />;
    case "evm":
      return <span className={`${classes} evm-address-glyph`} style={{ ...iconStyle, fontSize: Math.round(iconSize * 0.68) }} aria-hidden="true">0x</span>;
    case "locus":
      return <Hash className={classes} size={iconSize} strokeWidth={1.9} style={iconStyle} aria-hidden="true" />;
  }
}
