"use client";

import { useState } from "react";
import { CalendarClock, Minus, Plus } from "lucide-react";
import { storedLanguage } from "@/components/i18n/LanguageProvider";

const HOUR_MS = 60 * 60 * 1000;

export function tr(en, ur) {
    return storedLanguage() === "ur" ? ur : en;
}

export function toLocalInput(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function defaultWindow() {
    return {
        startAt: toLocalInput(new Date(Date.now() + 2 * HOUR_MS)),
        endAt: toLocalInput(new Date(Date.now() + 26 * HOUR_MS)),
    };
}

// Accepts a window handed over from the search screen; anything stale or
// malformed falls back to the usual defaults.
export function usableWindow(startAt, endAt) {
    const start = new Date(startAt || "");
    const end = new Date(endAt || "");
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
    if (end <= start || start.getTime() < Date.now() - 60_000) return null;
    return { startAt: toLocalInput(start), endAt: toLocalInput(end) };
}

export function windowHours(startAt, endAt) {
    const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
    return Number.isFinite(ms) && ms > 0 ? ms / HOUR_MS : 0;
}

export const UNIT_HOURS = { HOURLY: 1, DAILY: 24, WEEKLY: 168, MONTHLY: 720 };
export const PRICING_KEY = { HOURLY: "hourly", DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly" };

export function availableUnitsOf(pricing) {
    return Object.keys(PRICING_KEY).filter((unit) => Number(pricing?.[PRICING_KEY[unit]]) >= 1);
}

export function estimateTotal(pricing, unit, hours) {
    const rate = Number(pricing?.[PRICING_KEY[unit]]);
    if (!unit || !rate || !hours) return null;
    const units = Math.max(1, Math.ceil(hours / UNIT_HOURS[unit] - 1e-9));
    return { units, rate, total: units * rate };
}

export function cheapestUnit(pricing, hours) {
    let best = null;
    for (const unit of availableUnitsOf(pricing)) {
        const estimate = estimateTotal(pricing, unit, hours);
        if (estimate && (!best || estimate.total < best.total)) best = { unit, total: estimate.total };
    }
    return best?.unit || "";
}

export function formatDuration(hours) {
    const rounded = Math.max(1, Math.round(hours));
    if (rounded < 24) return rounded === 1 ? tr("1 hour", "1 گھنٹہ") : tr(`${rounded} hours`, `${rounded} گھنٹے`);
    const days = Math.floor(rounded / 24);
    const rest = rounded % 24;
    const dayText = days === 1 ? tr("1 day", "1 دن") : tr(`${days} days`, `${days} دن`);
    if (!rest) return dayText;
    return `${dayText} ${rest === 1 ? tr("1 hour", "1 گھنٹہ") : tr(`${rest} hours`, `${rest} گھنٹے`)}`;
}

export function formatWhen(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function pickupPresets() {
    const now = new Date();
    const presets = [{ key: "soon", label: tr("In 2 hours", "2 گھنٹے بعد"), date: new Date(now.getTime() + 2 * HOUR_MS) }];
    const evening = new Date(now);
    evening.setHours(18, 0, 0, 0);
    if (evening.getTime() > now.getTime() + 45 * 60_000) {
        presets.push({ key: "evening", label: tr("Today 6 PM", "آج شام 6 بجے"), date: evening });
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    presets.push({ key: "tomorrow", label: tr("Tomorrow 9 AM", "کل صبح 9 بجے"), date: tomorrow });
    return presets;
}

function durationChips() {
    return [
        [6, tr("6 hours", "6 گھنٹے")],
        [12, tr("12 hours", "12 گھنٹے")],
        [24, tr("1 day", "1 دن")],
        [72, tr("3 days", "3 دن")],
        [168, tr("1 week", "1 ہفتہ")],
        [720, tr("1 month", "1 مہینہ")],
    ];
}

const chipBase = "min-h-11 rounded-2xl px-3.5 text-[13px] font-extrabold transition-colors";
const chipOn = "bg-[#087F5B] text-white";
const chipOff = "bg-pd-surface-2 text-pd-text-2";
const inputCls =
    "w-full rounded-2xl border border-pd-line bg-pd-surface-2 px-3.5 py-3 text-sm font-semibold text-pd-text outline-none focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25";

export default function RentalWhenPicker({ startAt, endAt, onChange, idPrefix = "rw" }) {
    const hours = windowHours(startAt, endAt);
    const [kind, setKind] = useState(() => {
        const diff = new Date(startAt).getTime() - Date.now();
        return Math.abs(diff - 2 * HOUR_MS) < 10 * 60_000 ? "soon" : "custom";
    });
    const [exactOpen, setExactOpen] = useState(false);

    const keepHours = hours || 24;

    function setStart(date, nextKind) {
        setKind(nextKind);
        onChange({
            startAt: toLocalInput(date),
            endAt: toLocalInput(new Date(date.getTime() + keepHours * HOUR_MS)),
        });
    }

    function setDuration(nextHours) {
        const start = new Date(startAt);
        if (!Number.isFinite(start.getTime())) return;
        onChange({ startAt, endAt: toLocalInput(new Date(start.getTime() + Math.max(1, nextHours) * HOUR_MS)) });
    }

    function step(direction) {
        const stepHours = hours >= 24 ? 24 : 1;
        const base = hours >= 24 ? Math.round(hours / 24) * 24 : Math.round(hours);
        setDuration(Math.max(1, base + direction * stepHours));
    }

    function editStart(value) {
        const next = new Date(value);
        setKind("custom");
        if (!Number.isFinite(next.getTime())) {
            onChange({ startAt: value, endAt });
            return;
        }
        onChange({ startAt: value, endAt: toLocalInput(new Date(next.getTime() + keepHours * HOUR_MS)) });
    }

    const chips = durationChips();
    const inverted = Boolean(startAt && endAt) && hours <= 0;

    return (
        <div className="space-y-4">
            <div>
                <p className="mb-2 text-xs font-bold text-pd-text-2">{tr("When do you need it?", "آپ کو کب چاہیے؟")}</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr("Pickup time", "لینے کا وقت")}>
                    {pickupPresets().map((preset) => (
                        <button
                            key={preset.key}
                            type="button"
                            role="radio"
                            aria-checked={kind === preset.key}
                            onClick={() => setStart(preset.date, preset.key)}
                            className={`${chipBase} ${kind === preset.key ? chipOn : chipOff}`}
                        >
                            {preset.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        role="radio"
                        aria-checked={kind === "custom"}
                        onClick={() => { setKind("custom"); setExactOpen(true); }}
                        className={`${chipBase} ${kind === "custom" ? chipOn : chipOff}`}
                    >
                        {tr("Pick date & time", "تاریخ اور وقت چنیں")}
                    </button>
                </div>
            </div>

            <div>
                <p className="mb-2 text-xs font-bold text-pd-text-2">{tr("For how long?", "کتنی دیر کے لیے؟")}</p>
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-pd-surface-2 p-1.5">
                    <button
                        type="button"
                        onClick={() => step(-1)}
                        disabled={hours <= 1}
                        aria-label={tr("Shorter rental", "کم مدت")}
                        className="grid h-12 w-12 place-items-center rounded-xl bg-pd-surface text-pd-text shadow-sm disabled:opacity-40"
                    >
                        <Minus size={20} />
                    </button>
                    <p className="text-center text-lg font-extrabold" aria-live="polite">
                        {hours > 0 ? formatDuration(hours) : "—"}
                    </p>
                    <button
                        type="button"
                        onClick={() => step(1)}
                        aria-label={tr("Longer rental", "زیادہ مدت")}
                        className="grid h-12 w-12 place-items-center rounded-xl bg-pd-surface text-pd-text shadow-sm"
                    >
                        <Plus size={20} />
                    </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                    {chips.map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setDuration(value)}
                            aria-pressed={Math.round(hours) === value}
                            className={`${chipBase} ${Math.round(hours) === value ? chipOn : chipOff}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="rounded-2xl bg-pd-surface-2 px-4 py-3">
                <div className="flex items-start gap-3">
                    <CalendarClock size={18} className="mt-0.5 shrink-0 text-[#087F5B]" aria-hidden="true" />
                    <dl className="min-w-0 flex-1 space-y-1 text-sm">
                        <div className="flex justify-between gap-3">
                            <dt className="text-pd-muted">{tr("Pickup", "لینا")}</dt>
                            <dd className="text-right font-extrabold">{formatWhen(startAt) || "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="text-pd-muted">{tr("Return", "واپسی")}</dt>
                            <dd className="text-right font-extrabold">{formatWhen(endAt) || "—"}</dd>
                        </div>
                    </dl>
                </div>
                <button
                    type="button"
                    onClick={() => setExactOpen((open) => !open)}
                    aria-expanded={exactOpen}
                    aria-controls={`${idPrefix}-exact`}
                    className="mt-2 min-h-11 text-[13px] font-extrabold text-[#087F5B]"
                >
                    {exactOpen ? tr("Hide exact times", "درست وقت چھپائیں") : tr("Change exact times", "درست وقت بدلیں")}
                </button>
                {exactOpen && (
                    <div id={`${idPrefix}-exact`} className="mt-1 space-y-3">
                        <div>
                            <label htmlFor={`${idPrefix}-start`} className="mb-1.5 block text-xs font-bold text-pd-muted">{tr("Pickup", "لینا")}</label>
                            <input id={`${idPrefix}-start`} type="datetime-local" dir="ltr" value={startAt} onChange={(e) => editStart(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor={`${idPrefix}-end`} className="mb-1.5 block text-xs font-bold text-pd-muted">{tr("Return", "واپسی")}</label>
                            <input id={`${idPrefix}-end`} type="datetime-local" dir="ltr" min={startAt || undefined} value={endAt} onChange={(e) => onChange({ startAt, endAt: e.target.value })} className={inputCls} />
                        </div>
                    </div>
                )}
                {inverted && (
                    <p role="alert" className="mt-2 text-sm font-bold text-pd-danger">
                        {tr("Return must be after pickup. Make the rental longer or move the return time later.", "واپسی لینے کے بعد ہونی چاہیے۔ مدت بڑھائیں یا واپسی کا وقت آگے کریں۔")}
                    </p>
                )}
            </div>
        </div>
    );
}
