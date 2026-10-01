import * as Dialog from "@radix-ui/react-dialog";
import type { PropsWithChildren, ReactNode } from "react";
import { X } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.js";

type ModalProps = PropsWithChildren<{
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  hideTitle?: boolean;
  preventOutsideDismiss?: boolean;
  preventEscapeDismiss?: boolean;
  closeLabel?: string;
}>;

export function Modal({ open, title, onClose, footer, hideTitle = false, preventOutsideDismiss = false, preventEscapeDismiss = false, closeLabel = "Close", children }: ModalProps) {
  const { text } = useI18n();
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content
          className={`modal card${hideTitle ? " modal--hidden-title" : ""}`}
          aria-describedby={undefined}
          onInteractOutside={(event) => { if (preventOutsideDismiss) event.preventDefault(); }}
          onEscapeKeyDown={(event) => { if (preventEscapeDismiss) event.preventDefault(); }}
        >
          <header className={`modal-header${hideTitle ? " modal-header--hidden-title" : ""}`}>
            <Dialog.Title className={hideTitle ? "sr-only" : "modal-title"}>{typeof title === "string" ? text(title) : title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label={text(closeLabel)}><X size={20} aria-hidden="true" /></button>
            </Dialog.Close>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
