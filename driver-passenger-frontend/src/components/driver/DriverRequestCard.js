"use client";

import { Check, Clock3, Flag, Minus, Navigation, Plus, Route } from "lucide-react";

const vehicleNames = { BIKE: "Motorcycle", RICKSHAW: "Rickshaw", CAR_AC: "Car · AC", CAR_NON_AC: "Car · Non-AC" };
const money = (v) => (Number.isFinite(Number(v)) ? `PKR ${Number(v).toLocaleString("en-PK")}` : "—");
export const placeText = (point) =>
    point?.name || point?.address || (Array.isArray(point?.coordinates)
        ? `${point.coordinates[1].toFixed(5)}, ${point.coordinates[0].toFixed(5)}`
        : "Location unavailable");

/** Premium incoming-request card with fare stepper, offer and rebid cooldown. */
export default function DriverRequestCard({ ride, price, onPriceChange, onSend, busy, disabled, submitted, cooldownSeconds }) {
    const base = Number(ride.requestedPrice) || 0;
    const current = Number(price ?? ride.requestedPrice) || 0;
    const step = base >= 1000 ? 50 : 10;
    const diff = current - base;
    const cooling = cooldownSeconds > 0;

    return (
        <article className="dx-request" data-live={ride.live ? "true" : undefined} data-submitted={submitted ? "true" : undefined}>
            <header className="dx-request-head">
                <span className="dx-chip">{vehicleNames[ride.vehicleType] || ride.vehicleType}</span>
                {ride.distance != null && <span className="dx-chip dx-chip-ghost"><Route size={12} /> {ride.distance} km</span>}
                {ride.live && <span className="dx-chip dx-chip-new">New</span>}
                <span className="dx-request-fare">
                    <small>Passenger offer</small>
                    {money(ride.requestedPrice)}
                </span>
            </header>

            <ol className="dx-route">
                <li><span className="dx-dot dx-dot-pickup"><Navigation size={11} /></span><p><small>Pickup</small>{placeText(ride.pickup)}</p></li>
                {ride.stops?.map((stop, index) => (
                    <li key={index}><span className="dx-dot dx-dot-stop">{index + 1}</span><p><small>Stop {index + 1}</small>{placeText(stop)}</p></li>
                ))}
                <li><span className="dx-dot dx-dot-drop"><Flag size={11} /></span><p><small>Destination</small>{placeText(ride.destination)}</p></li>
            </ol>

            {submitted && (
                <p className="dx-request-sent"><Check size={14} /> Offer sent · waiting for passenger{cooling ? ` · revise in ${cooldownSeconds}s` : ""}</p>
            )}

            <div className="dx-offer">
                <div className="dx-stepper">
                    <button type="button" aria-label="Lower fare" disabled={current - step <= 0}
                        onClick={() => onPriceChange(String(Math.max(1, current - step)))}><Minus size={16} /></button>
                    <label>
                        <small>Your fare · PKR{diff !== 0 && base ? <em data-up={diff > 0}>{diff > 0 ? "+" : ""}{diff}</em> : null}</small>
                        <input type="number" inputMode="numeric" min="1" step="1"
                            value={price ?? ride.requestedPrice ?? ""}
                            onChange={(e) => onPriceChange(e.target.value)}
                            aria-label="Your offer in PKR" />
                    </label>
                    <button type="button" aria-label="Raise fare" onClick={() => onPriceChange(String(current + step))}><Plus size={16} /></button>
                </div>
                <button type="button" className="dx-btn dx-btn-lime dx-offer-send" onClick={onSend} disabled={disabled || cooling}>
                    {busy ? "Sending…" : cooling ? <><Clock3 size={15} /> {cooldownSeconds}s</> : submitted ? "Update offer" : "Send offer"}
                </button>
            </div>
            {cooling && <div className="dx-cooldown" style={{ "--p": `${(cooldownSeconds / 15) * 100}%` }} aria-hidden />}
        </article>
    );
}

export { money, vehicleNames };
