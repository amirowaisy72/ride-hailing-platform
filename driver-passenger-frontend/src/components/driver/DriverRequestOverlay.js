"use client";

import { Check, Clock3, Flag, MapPin, Minus, Navigation, Plus, Route, X } from "lucide-react";
import { money, placeText, vehicleNames } from "@/components/driver/DriverRequestCard";

/**
 * Full-screen incoming-request takeover. Shows one live request at a
 * time with the fare large, pickup distance, destination and a visible
 * response countdown. Accepting sends the offer at the shown fare
 * (passenger's fare by default; chips/stepper adjust it first).
 * Rejecting only dismisses the takeover — the request stays in the
 * list behind it. The countdown is a response prompt: when it ends the
 * parent returns the driver to the list, the request itself is kept
 * by the backend until the passenger closes it.
 */
export default function DriverRequestOverlay({
    ride, price, onPriceChange, onSend, onReject,
    pickupDistanceText, secondsLeft, totalSeconds, busy, submitted,
}) {
    const base = Number(ride.requestedPrice) || 0;
    const current = Number(price ?? ride.requestedPrice) || 0;
    const step = base >= 1000 ? 50 : 10;
    const progress = totalSeconds > 0
        ? Math.max(0, Math.min(100, (secondsLeft / totalSeconds) * 100))
        : 0;

    return (
        <div className="dx-overlay" role="alertdialog" aria-modal="true" aria-label="New ride request">
            <div className="dx-overlay-card">
                <header className="dx-overlay-head">
                    <span className="dx-chip">{vehicleNames[ride.vehicleType] || ride.vehicleType}</span>
                    <span className="dx-chip dx-chip-ghost">
                        {ride.tripType === "ROUND_TRIP" ? "↩ Round Trip" : "One Way"}
                    </span>
                    {ride.distance != null && (
                        <span className="dx-chip dx-chip-ghost"><Route size={12} /> {ride.distance} km trip</span>
                    )}
                    <span className="dx-overlay-timer" data-low={secondsLeft <= 10 ? "true" : undefined}>
                        <Clock3 size={15} /> {secondsLeft}s
                    </span>
                </header>
                <div className="dx-overlay-progress" aria-hidden>
                    <span style={{ width: `${progress}%` }} data-low={secondsLeft <= 10 ? "true" : undefined} />
                </div>

                <p className="dx-overlay-fare-label">Passenger offer</p>
                <p className="dx-overlay-fare">{money(ride.requestedPrice)}</p>
                {pickupDistanceText && (
                    <p className="dx-overlay-pickup-dist">
                        <MapPin size={15} /> Pickup is {pickupDistanceText} away
                    </p>
                )}

                <ol className="dx-route dx-overlay-route">
                    <li>
                        <span className="dx-dot dx-dot-pickup"><Navigation size={11} /></span>
                        <p><small>Pickup</small>{placeText(ride.pickup)}</p>
                    </li>
                    {ride.stops?.map((stop, index) => (
                        <li key={index}>
                            <span className="dx-dot dx-dot-stop">{index + 1}</span>
                            <p>
                                <small>
                                    {ride.tripType === "ROUND_TRIP" && index === ride.stops.length - 1
                                        ? "Outbound Destination"
                                        : `Stop ${index + 1}`}
                                </small>
                                {placeText(stop)}
                            </p>
                        </li>
                    ))}
                    <li>
                        <span className="dx-dot dx-dot-drop"><Flag size={11} /></span>
                        <p>
                            <small>{ride.tripType === "ROUND_TRIP" ? "Return to Pickup" : "Destination"}</small>
                            {placeText(ride.destination)}
                        </p>
                    </li>
                </ol>

                <div className="dx-chips" role="group" aria-label="Quick fare add-ons">
                    {[10, 20, 50].map((amount) => (
                        <button key={amount} type="button" className="dx-chip-add"
                            onClick={() => onPriceChange(String(current + amount))}
                            aria-label={`Add PKR ${amount} to your fare`}>
                            +{amount}
                        </button>
                    ))}
                    {base > 0 && current !== base && (
                        <button type="button" className="dx-chip-add dx-chip-reset"
                            onClick={() => onPriceChange(String(base))}
                            aria-label="Reset to the passenger's fare">
                            Reset
                        </button>
                    )}
                </div>

                <div className="dx-stepper dx-overlay-stepper">
                    <button type="button" aria-label="Lower fare" disabled={current - step <= 0}
                        onClick={() => onPriceChange(String(Math.max(1, current - step)))}><Minus size={18} /></button>
                    <label>
                        <small>Your fare · PKR</small>
                        <input type="number" inputMode="numeric" min="1" step="1"
                            value={price ?? ride.requestedPrice ?? ""}
                            onChange={(e) => onPriceChange(e.target.value)}
                            aria-label="Your offer in PKR" />
                    </label>
                    <button type="button" aria-label="Raise fare" onClick={() => onPriceChange(String(current + step))}><Plus size={18} /></button>
                </div>

                <div className="dx-overlay-actions">
                    <button type="button" className="dx-btn dx-overlay-reject" onClick={onReject} disabled={busy}>
                        <X size={20} /> Reject
                    </button>
                    <button type="button" className="dx-btn dx-btn-lime dx-overlay-accept" onClick={onSend} disabled={busy}>
                        <Check size={20} /> {busy ? "Sending…" : submitted ? `Update offer · ${money(current)}` : `Accept · ${money(current)}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
