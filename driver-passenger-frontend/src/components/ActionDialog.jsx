"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";

// Shared in-app replacement for the native confirm / prompt dialogs.
//
// Usage:
//   const dialog = useActionDialog();
//   if (!(await dialog.confirm({ title, message, danger: true }))) return;
//   const reason = await dialog.prompt({ title, label, placeholder });
//   if (reason === null) return; // user cancelled the dialog
//
// confirm() resolves true/false; prompt() resolves the entered string
// ("" when an optional field is left empty) or null on cancel.
// Styled only with pd-* theme tokens, so it follows light AND dark
// themes; it renders as a bottom sheet on small screens.

const ActionDialogContext = createContext(null);

export function useActionDialog() {
    const ctx = useContext(ActionDialogContext);
    if (!ctx) {
        throw new Error("useActionDialog must be used inside <ActionDialogProvider>");
    }
    return ctx;
}

export function ActionDialogProvider({ children }) {
    const { t } = useLanguage();
    const [current, setCurrent] = useState(null); // { kind, options, resolve }
    const [value, setValue] = useState("");
    const queueRef = useRef([]);
    const inputRef = useRef(null);

    const openNext = useCallback(() => {
        setCurrent((prev) => {
            if (prev) return prev;
            const next = queueRef.current.shift() || null;
            if (next?.kind === "prompt") {
                setValue(next.options.initialValue || "");
            } else {
                setValue("");
            }
            return next;
        });
    }, []);

    const enqueue = useCallback(
        (kind, options) =>
            new Promise((resolve) => {
                queueRef.current.push({ kind, options: options || {}, resolve });
                openNext();
            }),
        [openNext]
    );

    const confirm = useCallback(
        (options) => enqueue("confirm", options),
        [enqueue]
    );

    const prompt = useCallback(
        (options) => enqueue("prompt", options),
        [enqueue]
    );

    const settle = useCallback(
        (result) => {
            setCurrent((prev) => {
                if (prev) prev.resolve(result);
                return null;
            });
            // Let a queued dialog (e.g. prompt followed by confirm) open next.
            setTimeout(openNext, 0);
        },
        [openNext]
    );

    const handleConfirm = useCallback(() => {
        if (!current) return;
        if (current.kind === "prompt") {
            if (current.options.required && !value.trim()) return;
            settle(value);
        } else {
            settle(true);
        }
    }, [current, value, settle]);

    const handleCancel = useCallback(() => {
        if (!current) return;
        settle(current.kind === "prompt" ? null : false);
    }, [current, settle]);

    useEffect(() => {
        if (current?.kind === "prompt") {
            // Focus after paint so the mobile keyboard opens on the field.
            const timer = setTimeout(() => inputRef.current?.focus(), 50);
            return () => clearTimeout(timer);
        }
    }, [current]);

    useEffect(() => {
        if (!current) return;
        const onKey = (event) => {
            if (event.key === "Escape") handleCancel();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [current, handleCancel]);

    const api = { confirm, prompt };
    const options = current?.options || {};
    const danger = Boolean(options.danger);
    const confirmLabel =
        options.confirmLabel || (current?.kind === "prompt" ? t("common.ok") : t("common.confirm"));
    const cancelLabel = options.cancelLabel || t("common.cancel");
    const promptInvalid = Boolean(options.required) && !value.trim();

    return (
        <ActionDialogContext.Provider value={api}>
            {children}
            {current &&
                typeof document !== "undefined" &&
                createPortal(
                    <div
                        className="fixed inset-0 z-[120] flex items-end justify-center bg-pd-scrim sm:items-center sm:p-4"
                        role="presentation"
                        onClick={handleCancel}
                    >
                        <div
                            role="alertdialog"
                            aria-modal="true"
                            aria-label={options.title || t("common.confirm")}
                            className="pd-rise w-full max-w-md rounded-t-[24px] border border-pd-line bg-pd-surface p-5 pb-[max(20px,env(safe-area-inset-bottom))] text-pd-text shadow-pd-lg sm:rounded-[24px]"
                            onClick={(event) => event.stopPropagation()}
                        >
                            {options.title && (
                                <h2 className="text-base font-extrabold leading-snug">
                                    {options.title}
                                </h2>
                            )}
                            {options.message && (
                                <p className="mt-1.5 text-sm leading-relaxed text-pd-muted">
                                    {options.message}
                                </p>
                            )}

                            {current.kind === "prompt" && (
                                <div className="mt-4">
                                    {options.label && (
                                        <label
                                            htmlFor="action-dialog-input"
                                            className="mb-1.5 block text-xs font-bold text-pd-text-2"
                                        >
                                            {options.label}
                                            {options.optional !== false && !options.required
                                                ? " (optional)"
                                                : ""}
                                        </label>
                                    )}
                                    <textarea
                                        id="action-dialog-input"
                                        ref={inputRef}
                                        value={value}
                                        onChange={(event) => setValue(event.target.value)}
                                        placeholder={options.placeholder || ""}
                                        rows={options.rows || 3}
                                        maxLength={options.maxLength || 500}
                                        className="pd-input resize-none"
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                                event.preventDefault();
                                                handleConfirm();
                                            }
                                        }}
                                    />
                                </div>
                            )}

                            <div className="mt-5 flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="flex h-12 flex-1 items-center justify-center rounded-xl bg-pd-surface-2 text-sm font-bold text-pd-text-2"
                                >
                                    {cancelLabel}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleConfirm}
                                    disabled={promptInvalid}
                                    className={`flex h-12 flex-1 items-center justify-center rounded-xl text-sm font-extrabold text-white disabled:opacity-50 ${
                                        danger ? "bg-red-600" : "bg-pd-accent"
                                    }`}
                                >
                                    {confirmLabel}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </ActionDialogContext.Provider>
    );
}

export default ActionDialogProvider;
