"use client";

import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { BRAND } from "@/config/brand";

const backButtonClass =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-pd-line bg-pd-surface text-pd-text transition-colors hover:bg-pd-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-pd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pd-bg disabled:opacity-40";

export function AuthHeader({ backHref, onBack, backLabel = "Go back", backDisabled = false }) {
    let back = null;

    if (onBack) {
        back = (
            <button
                type="button"
                onClick={onBack}
                disabled={backDisabled}
                aria-label={backLabel}
                className={backButtonClass}
            >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
        );
    } else if (backHref) {
        back = (
            <Link href={backHref} aria-label={backLabel} className={backButtonClass}>
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
        );
    }

    return (
        <header className="flex items-center justify-between gap-3 px-6 pt-[max(20px,env(safe-area-inset-top))]">
            {back ?? <span className="h-10 w-10" aria-hidden="true" />}

            <div className="flex items-center gap-2">
                <img
                    src="/safar-icon.png"
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-lg object-cover shadow-pd"
                />
                <span className="text-base font-bold tracking-tight">{BRAND.name}</span>
            </div>

            <span className="h-10 w-10" aria-hidden="true" />
        </header>
    );
}

export function PasswordToggle({ visible, onToggle }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-pd-muted transition-colors hover:text-pd-text outline-none focus-visible:ring-2 focus-visible:ring-pd-accent"
        >
            {visible ? (
                <EyeOff className="h-5 w-5" aria-hidden="true" />
            ) : (
                <Eye className="h-5 w-5" aria-hidden="true" />
            )}
        </button>
    );
}

export function PrimaryButton({ loading, loadingLabel, children, className = "", ...props }) {
    return (
        <button
            {...props}
            disabled={loading || props.disabled}
            className={`group flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-pd-accent text-base font-bold text-pd-accent-ink shadow-pd transition-transform outline-none focus-visible:ring-2 focus-visible:ring-pd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pd-bg active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 ${className}`}
        >
            {loading ? (
                <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                    <span aria-live="polite">{loadingLabel}</span>
                </>
            ) : (
                children
            )}
        </button>
    );
}

function GoogleMark() {
    return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
            <path
                fill="#4285F4"
                d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
            />
            <path
                fill="#34A853"
                d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0 0 12 24Z"
            />
            <path
                fill="#FBBC05"
                d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.27a12 12 0 0 0 0 10.78l4-3.1Z"
            />
            <path
                fill="#EA4335"
                d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4 3.1C6.22 6.88 8.87 4.77 12 4.77Z"
            />
        </svg>
    );
}

export function GoogleButton({ children, ...props }) {
    return (
        <button
            type="button"
            {...props}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-pd-line-strong bg-pd-surface text-base font-semibold text-pd-text transition-colors hover:bg-pd-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-pd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pd-bg active:scale-[0.98] disabled:opacity-50"
        >
            <GoogleMark />
            {children}
        </button>
    );
}

export function OrDivider() {
    return (
        <div className="flex items-center gap-3" role="separator" aria-label="or">
            <span className="h-px flex-1 bg-pd-line" />
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-pd-faint">or</span>
            <span className="h-px flex-1 bg-pd-line" />
        </div>
    );
}

export function FormError({ children }) {
    if (!children) return null;

    return (
        <p
            role="alert"
            className="rounded-2xl border border-pd-danger/20 bg-pd-danger-soft px-4 py-3 text-sm font-medium leading-relaxed text-pd-danger"
        >
            {children}
        </p>
    );
}
