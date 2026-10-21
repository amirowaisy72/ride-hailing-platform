"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";

const OPTIONS = [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
];

/** Segmented Appearance control used in Passenger and Driver account pages. */
export default function ThemeSelector({ className = "" }) {
    const { preference, resolvedTheme, setPreference } = useTheme();

    return (
        <section
            aria-labelledby="appearance-title"
            className={`rounded-[24px] border border-pd-line bg-pd-surface p-5 text-pd-text shadow-pd ${className}`}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 id="appearance-title" className="text-base font-extrabold">Appearance</h2>
                    <p className="mt-0.5 text-xs text-pd-muted">
                        {preference === "system"
                            ? `Following your phone · currently ${resolvedTheme}`
                            : `Always ${preference}`}
                    </p>
                </div>
            </div>

            <div role="radiogroup" aria-label="Theme preference" className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-pd-surface-2 p-1">
                {OPTIONS.map(({ value, label, icon: Icon }) => {
                    const active = preference === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setPreference(value)}
                            className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-xs font-bold transition ${active
                                ? "bg-pd-surface text-pd-text shadow-pd"
                                : "text-pd-muted"
                                }`}
                        >
                            <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
                            {label}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
