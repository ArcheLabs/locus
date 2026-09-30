import * as Dialog from "@radix-ui/react-dialog";
import type { PropsWithChildren, ReactNode } from "react";
import { X } from "lucide-react";

type ModalProps = PropsWithChildren<{
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  hideTitle?: boolean;
  preventOutsideDismiss?: boolean;
}>;

export function Modal({ open, title, onClose, footer, hideTitle = false, preventOutsideDismiss = false, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content
          className={`modal card${hideTitle ? " modal--hidden-title" : ""}`}
          aria-describedby={undefined}
          onInteractOutside={(event) => { if (preventOutsideDismiss) event.preventDefault(); }}
        >
          <header className={`modal-header${hideTitle ? " modal-header--hidden-title" : ""}`}>
            <Dialog.Title className={hideTitle ? "sr-only" : "modal-title"}>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label="Close"><X size={20} aria-hidden="true" /></button>
            </Dialog.Close>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
