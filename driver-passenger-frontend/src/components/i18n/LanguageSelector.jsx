"use client";

import { Languages } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

const OPTIONS = [
    { value: "en", labelKey: "language.english" },
    { value: "ur", labelKey: "language.urdu" },
];

/**
 * Segmented Language control used in Passenger and Driver account
 * pages (mirrors ThemeSelector). Urdu = native Urdu script; the
 * whole app flips to RTL when it is chosen.
 */
export default function LanguageSelector({ className = "" }) {
    const { lang, setLang, t } = useLanguage();

    return (
        <section
            aria-labelledby="language-title"
            className={`rounded-[24px] border border-pd-line bg-pd-surface p-5 text-pd-text shadow-pd ${className}`}
        >
            <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-pd-accent-soft text-pd-accent-text">
                    <Languages size={19} aria-hidden="true" />
                </span>
                <div>
                    <h2 id="language-title" className="text-base font-extrabold">{t("language.title")}</h2>
                    <p className="mt-0.5 text-xs text-pd-muted">{t("language.subtitle")}</p>
                </div>
            </div>

            <div role="radiogroup" aria-label={t("language.title")} className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-pd-surface-2 p-1">
                {OPTIONS.map(({ value, labelKey }) => {
                    const active = lang === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setLang(value)}
                            className={`flex min-h-12 items-center justify-center rounded-xl text-sm font-bold transition ${active
                                ? "bg-pd-surface text-pd-text shadow-pd"
                                : "text-pd-muted"
                                }`}
                        >
                            {t(labelKey)}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
