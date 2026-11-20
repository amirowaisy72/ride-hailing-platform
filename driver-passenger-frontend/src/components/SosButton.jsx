"use client";

import { useState } from "react";
import { ShieldAlert, Phone } from "lucide-react";
import { apiRequest } from "@/lib/api";

// ---------------------------------------------------------------------
// Safety (Safar To-Do #5, Phase 1, item a) — SOS / panic button.
//
// One tap arms, a second tap confirms and sends the alert (ride ID +
// live GPS + driver/passenger details) to the Safar admin side via
// POST /safety/sos. The button also offers a one-tap call to 15
// (Police, Pakistan). There is NO police integration — the alert goes
// to admin, and calling 15 is the emergency path.
// ---------------------------------------------------------------------

function currentPosition(timeoutMs = 8000) {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
        );
    });
}

export default function SosButton({ rideId, token, compact = false }) {
    const [armed, setArmed] = useState(false);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    async function send() {
        if (!armed) {
            setArmed(true);
            setError("");
            return;
        }
        if (sending || sent) return;
        setSending(true);
        setError("");
        try {
            const pos = await currentPosition();
            await apiRequest("/safety/sos", {
                method: "POST",
                token,
                body: JSON.stringify({
                    rideId,
                    latitude: pos?.latitude ?? null,
                    longitude: pos?.longitude ?? null,
                }),
            });
            setSent(true);
        } catch (err) {
            setError(err.message || "Could not send SOS. Call 15 now.");
        } finally {
            setSending(false);
        }
    }

    if (sent) {
        return (
            <div role="alert" className="rounded-2xl border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                <p className="text-sm font-extrabold">SOS alert sent to Safar admin.</p>
                <p className="mt-0.5 text-xs font-medium">If you are in danger, call the police now:</p>
                <a href="tel:15" className="mt-2 flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-extrabold text-white">
                    <Phone size={17} /> Call 15 (Police)
                </a>
            </div>
        );
    }

    return (
        <div>
            <button
                type="button"
                onClick={send}
                disabled={sending}
                aria-label="Send SOS emergency alert"
                className={`flex w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white disabled:opacity-60 ${armed ? "h-12 animate-pulse bg-red-700" : compact ? "h-11 bg-red-600" : "h-12 bg-red-600"}`}
            >
                <ShieldAlert size={19} />
                {sending ? "Sending SOS…" : armed ? "Tap again to confirm SOS" : "SOS — Emergency"}
            </button>
            {armed && !sending && (
                <p className="mt-1.5 text-center text-xs font-semibold text-pd-muted">
                    This alerts Safar admin with your live location. For immediate help,{" "}
                    <a href="tel:15" className="font-extrabold text-red-600 underline">call 15</a>.
                </p>
            )}
            {error && (
                <p role="alert" className="mt-1.5 text-center text-xs font-bold text-red-600">{error}</p>
            )}
        </div>
    );
}
