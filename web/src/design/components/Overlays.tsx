import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { t } from "../../copy";
import { X } from "../icons";
import { Button, IconButton } from "./Button";
import { useModal, useOutsideClick, focusablesIn } from "./overlayKit";
import { cx } from "./util";

interface ModalBase {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ComponentChildren;
  footer?: ComponentChildren;
  initialFocus?: string;
}

function Shell({ kind, open, onClose, title, description, children, footer, initialFocus, size }: ModalBase & { kind: "dialog" | "drawer"; size?: "sm" | "md" | "lg" }) {
  const ref = useModal(open, onClose, initialFocus);
  const id = useId();
  if (!open) return null;
  return (
    <div class={cx("ht-overlay", `ht-overlay--${kind}`)}>
      <div class="ht-overlay__scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} class={cx("ht-panel", `ht-panel--${kind}`, size && `ht-panel--${size}`)} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={description ? `${id}-d` : undefined} tabIndex={-1}>
        <header class="ht-panel__head">
          <div>
            <h2 id={`${id}-t`} class="ht-panel__title">
              {title}
            </h2>
            {description ? (
              <p id={`${id}-d`} class="ht-panel__desc">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton icon={X} label={kind === "dialog" ? t("dialog.close") : t("drawer.close")} onClick={onClose} size="sm" />
        </header>
        <div class="ht-panel__body">{children}</div>
        {footer ? <footer class="ht-panel__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export const Dialog = (p: ModalBase & { size?: "sm" | "md" | "lg" }) => <Shell kind="dialog" {...p} />;
/** بيتفتح من الجنب (على الموبايل بيبقى ورقة من تحت). */
export const Drawer = (p: ModalBase) => <Shell kind="drawer" {...p} />;

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = t("common.confirm"), cancelLabel = t("common.cancel"), danger, loading }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      // الأمان: التركيز الأول على "إلغاء" عشان Enter بالغلط ما يمسحش حاجة.
      initialFocus="[data-cancel]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-cancel="">
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={() => void onConfirm()}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/* ---------- Tooltip / Popover / Menu ---------- */

export function Tooltip({ text, children }: { text: string; children: ComponentChildren }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <span class="ht-tip" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocusIn={() => setShow(true)} onFocusOut={() => setShow(false)} onKeyDown={(e) => e.key === "Escape" && setShow(false)}>
      <span aria-describedby={show ? id : undefined}>{children}</span>
      {show ? (
        <span role="tooltip" id={id} class="ht-tip__bubble">
          {text}
        </span>
      ) : null}
    </span>
  );
}

export function Popover({ trigger, children, label, align = "start" }: { trigger: (p: { open: boolean; toggle: () => void; id: string }) => ComponentChildren; children: ComponentChildren | ((close: () => void) => ComponentChildren); label: string; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useOutsideClick(root, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLElement>("[aria-expanded]")?.focus();
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div class="ht-pop" ref={root}>
      {trigger({ open, toggle: () => setOpen((o) => !o), id })}
      {open ? (
        <div id={id} class={cx("ht-pop__panel", align === "end" && "ht-pop__panel--end")} role="dialog" aria-label={label}>
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: Parameters<typeof import("./Icon").Icon>[0]["icon"];
  danger?: boolean;
  disabled?: boolean;
}

/** قائمة إجراءات بتتحرّك بالأسهم (↑ ↓ Home End) وبتتقفل بـ Esc. */
export function Menu({ trigger, items, label, align = "end" }: { trigger: (p: { open: boolean; toggle: () => void; id: string }) => ComponentChildren; items: MenuItem[]; label: string; align?: "start" | "end" }) {
  const listRef = useRef<HTMLDivElement>(null);
  return (
    <Popover label={label} align={align} trigger={trigger}>
      {(close) => (
        <MenuList
          innerRef={listRef}
          items={items}
          label={label}
          close={close}
        />
      )}
    </Popover>
  );
}

function MenuList({ items, label, close, innerRef }: { items: MenuItem[]; label: string; close: () => void; innerRef: { current: HTMLDivElement | null } }) {
  useLayoutEffect(() => {
    const first = innerRef.current && focusablesIn(innerRef.current)[0];
    first?.focus();
  }, [innerRef]);
  const move = (e: KeyboardEvent) => {
    const root = innerRef.current;
    if (!root) return;
    const els = focusablesIn(root);
    const i = els.indexOf(document.activeElement as HTMLElement);
    let n = -1;
    if (e.key === "ArrowDown") n = (i + 1) % els.length;
    else if (e.key === "ArrowUp") n = (i - 1 + els.length) % els.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = els.length - 1;
    if (n >= 0) {
      e.preventDefault();
      els[n]?.focus();
    }
  };
  return (
    <div ref={innerRef} role="menu" aria-label={label} class="ht-menu" onKeyDown={move}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          class={cx("ht-menu__item", it.danger && "is-danger")}
          onClick={() => {
            close();
            it.onSelect();
          }}
        >
          {it.icon ? <span class="ht-menu__ico"><it.icon size={18} strokeWidth={1.75} aria-hidden="true" /></span> : null}
          {it.label}
        </button>
      ))}
    </div>
  );
}
