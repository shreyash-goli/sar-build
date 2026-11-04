"use client";

import * as React from "react";
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastVariant = "info" | "success" | "warning" | "danger";

export type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /**
   * Auto-dismiss delay in ms. Defaults to 6000 for info/success/warning.
   * Danger toasts stay until dismissed unless a duration is given.
   * Pass `null` to keep any toast until dismissed.
   */
  duration?: number | null;
};

type ToastRecord = Required<Pick<ToastInput, "title" | "variant">> & {
  id: string;
  description?: string;
};

type ToastContextValue = {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 4;
const DEFAULT_DURATION = 6000;

const variantStyles: Record<ToastVariant, { icon: LucideIcon; tone: string }> =
  {
    info: { icon: Info, tone: "text-info" },
    success: { icon: CircleCheck, tone: "text-success" },
    warning: { icon: TriangleAlert, tone: "text-warning" },
    danger: { icon: CircleAlert, tone: "text-danger" },
  };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = React.useRef(0);

  const dismiss = React.useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, variant = "info", duration }: ToastInput) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((current) =>
        [...current, { id, title, description, variant }].slice(-MAX_VISIBLE),
      );
      const delay =
        duration === undefined
          ? variant === "danger"
            ? null
            : DEFAULT_DURATION
          : duration;
      if (delay !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), delay),
        );
      }
      return id;
    },
    [dismiss],
  );

  React.useEffect(() => {
    const active = timers.current;
    return () => {
      active.forEach((timer) => clearTimeout(timer));
      active.clear();
    };
  }, []);

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      >
        <ol className="flex w-full max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
}) {
  const { icon: Icon, tone } = variantStyles[toast.variant];
  return (
    <li
      role={toast.variant === "danger" ? "alert" : "status"}
      data-slot="toast"
      data-variant={toast.variant}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border-strong bg-surface-raised p-3.5 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.7)]"
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{toast.title}</p>
        {toast.description ? (
          <p className="text-sm leading-relaxed text-muted">
            {toast.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dismiss notification: ${toast.title}`}
        className="-m-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle hover:bg-surface-hover hover:text-foreground"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}

/** Access the toast API. Must be used under <ToastProvider>. */
export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>.");
  }
  return ctx;
}
