import * as Dialog from "@radix-ui/react-dialog";
import type { PropsWithChildren, ReactNode } from "react";
import { X } from "lucide-react";

type ModalProps = PropsWithChildren<{
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
}>;

export function Modal({ open, title, onClose, footer, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content className="modal card" aria-describedby={undefined}>
          <header className="modal-header">
            <Dialog.Title className="modal-title">{title}</Dialog.Title>
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
