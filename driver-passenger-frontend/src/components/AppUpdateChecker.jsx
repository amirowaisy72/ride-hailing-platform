"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { storedLanguage } from "@/components/i18n/LanguageProvider";
import { apiRequest } from "@/lib/api";

// ---------------------------------------------------------------------------
// New-update popup, shown on every app launch while the installed app
// is older than the admin-set latest version.
//
// Behaviour the user asked for, exactly:
//  * Checks once per launch (this component mounts with the root
//    layout, so it runs on app open, before any screen is used).
//  * Update takes the user straight to Safar's Play Store listing,
//    where the Update button lives.
//  * Cancel is always available and never blocks the app: it only
//    dismisses the popup for THIS session. The next app launch runs
//    the check again, so the popup returns until the app is updated.
//  * Web / preview builds are skipped: App.getInfo().build is the
//    Android versionCode only on a native install.
// ---------------------------------------------------------------------------

const PLAY_URL =
    "https://play.google.com/store/apps/details?id=com.safar.ridehailing";

function openPlayStore() {
    // No new native plugin: a _blank link is handed to the system
    // browser by Capacitor, which lands on Safar's Play listing.
    // The market:// scheme is tried first on Android via the same
    // anchor trick in supporting WebViews; the https URL is the
    // reliable fallback and is what actually opens here.
    const anchor = document.createElement("a");
    anchor.href = PLAY_URL;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

export default function AppUpdateChecker() {
    const [update, setUpdate] = useState(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                if (!Capacitor.isNativePlatform()) return;
                const info = await App.getInfo();
                const currentCode = Number.parseInt(info.build, 10);
                if (!Number.isFinite(currentCode)) return;

                const result = await apiRequest("/app-version");
                if (cancelled) return;
                if (!result?.configured) return;
                const latestCode = Number(result.latestVersionCode);
                if (!Number.isFinite(latestCode)) return;
                if (currentCode >= latestCode) return;

                setUpdate({
                    latestVersionName: result.latestVersionName,
                    message: result.message || "",
                    playUrl: result.playUrl || PLAY_URL,
                });
            } catch {
                // Version check must never break app launch: any
                // failure (offline, old backend) simply shows nothing.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (!update || dismissed) return null;

    const isUr = storedLanguage() === "ur";

    return (
        <div
            className="fixed inset-0 z-[140] flex items-end justify-center bg-black/45 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
            role="alertdialog"
            aria-modal="true"
            aria-label={isUr ? "نئی اپ ڈیٹ دستیاب ہے" : "New update available"}
        >
            <div className="pd-rise w-full max-w-md rounded-[24px] border border-pd-line bg-pd-elevated p-5 shadow-pd-lg">
                <h2 className="text-base font-extrabold text-pd-text">
                    {isUr ? "نئی اپ ڈیٹ دستیاب ہے" : "New update available"}
                </h2>
                <p className="mt-2 text-sm leading-snug text-pd-muted">
                    {update.message ||
                        (isUr
                            ? `سفر کا نیا ورژن (${update.latestVersionName}) دستیاب ہے۔ براہ کرم اپ ڈیٹ کریں۔`
                            : `A new version of Safar (${update.latestVersionName}) is available. Please update.`)}
                </p>
                <div className="mt-4 flex gap-2">
                    <button
                        type="button"
                        onClick={openPlayStore}
                        className="flex h-12 flex-1 items-center justify-center rounded-xl bg-pd-accent text-sm font-extrabold text-pd-accent-ink"
                    >
                        {isUr ? "اپ ڈیٹ کریں" : "Update now"}
                    </button>
                    <button
                        type="button"
                        onClick={() => setDismissed(true)}
                        className="flex h-12 flex-1 items-center justify-center rounded-xl bg-pd-surface-2 text-sm font-bold text-pd-text ring-1 ring-pd-line"
                    >
                        {isUr ? "بعد میں" : "Later"}
                    </button>
                </div>
                <p className="mt-3 text-xs text-pd-muted">
                    {isUr
                        ? "بعد میں دبانے سے ایپ استعمال ہوتی رہے گی، لیکن اگلی بار ایپ کھولنے پر یہ پیغام دوبارہ آئے گا۔"
                        : "Later only hides this for now — it will appear again the next time you open the app until you update."}
                </p>
            </div>
        </div>
    );
}
