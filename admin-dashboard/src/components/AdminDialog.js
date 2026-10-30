"use client";

// Shared themed replacement for the native browser confirm/prompt
// dialogs across the admin dashboard.
//
// Usage: the root layout mounts <DialogProvider> once around the whole
// app (it has to sit above the page components themselves, which are
// ancestors of AdminShell), and any component inside it calls:
//
//   const { confirmDialog, promptDialog } = useAdminDialog();
//
//   if (!(await confirmDialog("Delete this item?", { danger: true }))) return;
//   const reason = await promptDialog("Rejection reason:", { defaultValue: "" });
//   if (reason === null) return; // cancelled — same semantics as the native call
//
// confirmDialog resolves true/false; promptDialog resolves the entered
// string, or null when cancelled — exactly like the native functions, so
// call sites keep their existing null/empty handling unchanged. Requests
// are queued, so a second dialog opens only after the first resolves.

import {
    createContext, useCallback, useContext, useEffect, useRef, useState,
} from "react";
import { AlertTriangle } from "lucide-react";

const DialogContext = createContext(null);

export function useAdminDialog() {
    const dialog = useContext(DialogContext);
    if (!dialog) {
        throw new Error("useAdminDialog must be used inside <DialogProvider>");
    }
    return dialog;
}

export function DialogProvider({ children }) {
    const [current, setCurrent] = useState(null);
    const [value, setValue] = useState("");
    const [validationError, setValidationError] = useState("");
    const queueRef = useRef([]);
    const busyRef = useRef(false);
    const inputRef = useRef(null);

    const showRequest = useCallback((request) => {
        busyRef.current = Boolean(request);
        setCurrent(request);
        setValue(request?.type === "prompt" ? request.options.defaultValue ?? "" : "");
        setValidationError("");
    }, []);

    const enqueue = useCallback((type, message, options) => {
        return new Promise((resolve) => {
            const request = { type, message, options: options || {}, resolve };
            if (busyRef.current) {
                queueRef.current.push(request);
            } else {
                showRequest(request);
            }
        });
    }, [showRequest]);

    const confirmDialog = useCallback(
        (message, options) => enqueue("confirm", message, options),
        [enqueue]
    );

    const promptDialog = useCallback(
        (message, options) => enqueue("prompt", message, options),
        [enqueue]
    );

    const settle = useCallback((result) => {
        if (!current) return;
        const { resolve } = current;
        resolve(result);
        // Open any queued request next; otherwise the provider is idle.
        showRequest(queueRef.current.shift() || null);
    }, [current, showRequest]);

    const cancel = useCallback(() => {
        settle(current?.type === "prompt" ? null : false);
    }, [current, settle]);

    const submit = useCallback(() => {
        if (!current) return;
        if (current.type === "confirm") {
            settle(true);
            return;
        }
        if (current.options.required && !value.trim()) {
            setValidationError(
                current.options.requiredMessage || "This field is required."
            );
            return;
        }
        settle(value);
    }, [current, settle, value]);

    // Focus the prompt input whenever a prompt opens.
    useEffect(() => {
        if (current?.type === "prompt") {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [current]);

    // Escape cancels, like the native dialogs.
    useEffect(() => {
        if (!current) return;
        function onKeyDown(event) {
            if (event.key === "Escape") cancel();
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [current, cancel]);

    const danger = Boolean(current?.options.danger);

    return (
        <DialogContext.Provider value={{ confirmDialog, promptDialog }}>
            {children}

            {current && (
                <div
                    className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
                    role="alertdialog"
                    aria-modal="true"
                    aria-label={current.type === "prompt" ? "Input required" : "Confirmation required"}
                    onClick={cancel}
                >
                    <div
                        className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3">
                            {danger && (
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                                    <AlertTriangle size={20} />
                                </span>
                            )}
                            <p className="min-h-10 flex-1 whitespace-pre-wrap pt-2 text-sm font-semibold text-slate-700">
                                {current.message}
                            </p>
                        </div>

                        {current.type === "prompt" && (
                            <form
                                className="mt-4"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    submit();
                                }}
                            >
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={value}
                                    onChange={(e) => {
                                        setValue(e.target.value);
                                        setValidationError("");
                                    }}
                                    placeholder={current.options.placeholder || ""}
                                    className="w-full rounded-xl border p-3 text-sm"
                                />
                                {validationError && (
                                    <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">
                                        {validationError}
                                    </p>
                                )}
                            </form>
                        )}

                        <div className="mt-5 flex gap-3">
                            <button
                                type="button"
                                onClick={submit}
                                className={`flex-1 rounded-xl p-3 font-bold text-white ${danger
                                    ? "bg-red-600 hover:bg-red-700"
                                    : "bg-[#087F5B]"
                                    }`}
                            >
                                {current.options.confirmLabel
                                    || (current.type === "prompt" ? "OK" : "Confirm")}
                            </button>
                            <button
                                type="button"
                                onClick={cancel}
                                className="rounded-xl border px-5 py-3 font-bold"
                            >
                                {current.options.cancelLabel || "Cancel"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </DialogContext.Provider>
    );
}
