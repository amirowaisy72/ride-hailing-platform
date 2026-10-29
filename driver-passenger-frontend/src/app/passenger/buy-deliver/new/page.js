"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Geolocation } from "@capacitor/geolocation";
import {
    ArrowLeft,
    Check,
    ImagePlus,
    Loader2,
    LocateFixed,
    MapPin,
    ShoppingBag,
    X,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { reverseGeocode } from "@/lib/locationService";
import { uploadOrderImage } from "@/lib/orderChatService";
import { createPurchaseOrder } from "@/lib/purchaseService";

export default function NewBuyDeliverPage() {
    return (
        <AuthGuard role="PASSENGER">
            <BuyDeliverForm />
        </AuthGuard>
    );
}

function BuyDeliverForm() {
    const { token } = useAuth();
    const router = useRouter();

    const [itemsText, setItemsText] = useState("");
    const [imageUrls, setImageUrls] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [estimatedBudget, setEstimatedBudget] = useState("");
    const [preferredShop, setPreferredShop] = useState("");
    const [preferredBrand, setPreferredBrand] = useState("");
    const [alternativesAllowed, setAlternativesAllowed] = useState(false);
    const [alternativesNote, setAlternativesNote] = useState("");
    const [deliveryNotes, setDeliveryNotes] = useState("");

    const [savedPlaces, setSavedPlaces] = useState([]);
    const [delivery, setDelivery] = useState(null); // { latitude, longitude, address }
    const [deliveryLabel, setDeliveryLabel] = useState("");
    const [manualAddress, setManualAddress] = useState("");
    const [locating, setLocating] = useState(false);

    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const fileRef = useRef(null);

    // Saved places pre-fill the delivery address (HOME first) — the
    // backend falls back to HOME too, but showing it keeps the
    // passenger in control of where their shopping arrives.
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        apiRequest("/saved-places", { token })
            .then((data) => {
                if (cancelled) return;
                const places = data.places || [];
                setSavedPlaces(places);
                const home = places.find((p) => p.type === "HOME") || places[0];
                if (home) {
                    setDelivery({
                        latitude: Number(home.latitude),
                        longitude: Number(home.longitude),
                        address: home.address || home.name || "",
                    });
                    setDeliveryLabel(home.name || home.type || "Saved place");
                    setManualAddress(home.address || home.name || "");
                }
            })
            .catch(() => { /* Manual address + GPS still work. */ });
        return () => { cancelled = true; };
    }, [token]);

    function chooseSavedPlace(placeId) {
        const place = savedPlaces.find((p) => String(p._id) === String(placeId));
        if (!place) return;
        setDelivery({
            latitude: Number(place.latitude),
            longitude: Number(place.longitude),
            address: place.address || place.name || "",
        });
        setDeliveryLabel(place.name || place.type || "Saved place");
        setManualAddress(place.address || place.name || "");
    }

    async function useCurrentLocation() {
        setLocating(true);
        setError("");
        try {
            const position = await Geolocation.getCurrentPosition({
                enableHighAccuracy: true,
                timeout: 15000,
            });
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;
            let address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            try {
                const result = await reverseGeocode(latitude, longitude, token);
                const resolved = result?.display_name || result?.displayName || result?.address;
                if (typeof resolved === "string" && resolved.trim()) address = resolved;
            } catch { /* Keep coordinates as the address. */ }
            setDelivery({ latitude, longitude, address });
            setDeliveryLabel("Current location");
            setManualAddress(address);
        } catch (e) {
            setError(e.message || "Unable to detect your location.");
        } finally {
            setLocating(false);
        }
    }

    async function attachPhotos(files) {
        const list = Array.from(files || []).slice(0, 6 - imageUrls.length);
        if (list.length === 0) return;
        setUploading(true);
        setError("");
        try {
            for (const file of list) {
                const uploaded = await uploadOrderImage(file, token);
                const url = uploaded.imageUrl || uploaded.url;
                if (url) setImageUrls((prev) => [...prev, url].slice(0, 6));
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setUploading(false);
        }
    }

    async function submit(event) {
        event.preventDefault();
        if (submitting) return;
        const budget = Number(estimatedBudget);
        if (!itemsText.trim()) {
            setError("Write your shopping list first — what should the partner buy?");
            return;
        }
        if (!Number.isSafeInteger(budget) || budget <= 0) {
            setError("Enter your estimated budget in PKR.");
            return;
        }
        const addressText = manualAddress.trim();
        if (!delivery && !addressText) {
            setError("Add a delivery address — pick a saved place or use your current location.");
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            const deliveryPoint = delivery
                ? { latitude: delivery.latitude, longitude: delivery.longitude, address: addressText || delivery.address || "" }
                : null;
            const data = await createPurchaseOrder(
                {
                    itemsText: itemsText.trim(),
                    imageUrls,
                    preferences: {
                        preferredShop: preferredShop.trim(),
                        preferredBrand: preferredBrand.trim(),
                        alternativesAllowed,
                        alternativesNote: alternativesAllowed ? alternativesNote.trim() : "",
                    },
                    deliveryNotes: deliveryNotes.trim(),
                    estimatedBudget: budget,
                    ...(deliveryPoint
                        ? { deliveryAddress: deliveryPoint, deliveryLabel: deliveryLabel || "Delivery" }
                        : {}),
                },
                token
            );
            router.push(`/passenger/buy-deliver/details?id=${data.order._id}`);
        } catch (e) {
            setError(e.message);
            setSubmitting(false);
        }
    }

    const inputCls =
        "w-full rounded-2xl border border-slate-200 bg-[#F9FAFB] px-4 py-3 text-[15px] text-[#111111] outline-none placeholder:text-slate-400 focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25";

    return (
        <main className="min-h-dvh bg-[#F4F5F7] pb-28 text-[#111111]">
            <div className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur-xl">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                    <Link
                        href="/passenger/buy-deliver"
                        aria-label="Back to Buy & Deliver"
                        className="grid h-11 w-11 place-items-center rounded-2xl hover:bg-[#F4F5F7]"
                    >
                        <ArrowLeft size={21} />
                    </Link>
                    <div className="min-w-0 flex-1">
                        <h1 className="text-lg font-extrabold leading-tight tracking-tight">New shopping request</h1>
                        <p className="text-xs text-slate-500">Kharid Kar Lao — no store to pick, just your list</p>
                    </div>
                    <ShoppingBag size={20} className="text-[#087F5B]" aria-hidden="true" />
                </div>
            </div>

            <form onSubmit={submit} className="mx-auto max-w-xl space-y-4 px-4 pt-4" noValidate>
                <section className="space-y-3 rounded-[24px] bg-white p-4 shadow-sm">
                    <h2 className="text-[15px] font-extrabold">Your shopping list</h2>
                    <textarea
                        value={itemsText}
                        onChange={(e) => setItemsText(e.target.value)}
                        rows={6}
                        maxLength={2000}
                        required
                        placeholder={"e.g.\n2 kg chicken\n1 dozen eggs\nOlpers milk 1 litre x2\nBrown bread 1 pack"}
                        className={`${inputCls} resize-none leading-relaxed`}
                        aria-label="Shopping list"
                    />
                    <p className="text-xs text-slate-400">{itemsText.length}/2000 — brands, sizes and quantities help your partner shop exactly right.</p>

                    <div>
                        <p className="mb-2 text-xs font-bold text-slate-600">Reference photos (optional)</p>
                        <div className="flex flex-wrap gap-2">
                            {imageUrls.map((url) => (
                                <span key={url} className="relative block h-20 w-20 overflow-hidden rounded-2xl bg-slate-100">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt="Reference" className="h-full w-full object-cover" />
                                    <button
                                        type="button"
                                        aria-label="Remove photo"
                                        onClick={() => setImageUrls((prev) => prev.filter((u) => u !== url))}
                                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white"
                                    >
                                        <X size={13} />
                                    </button>
                                </span>
                            ))}
                            {imageUrls.length < 6 && (
                                <button
                                    type="button"
                                    disabled={uploading}
                                    onClick={() => fileRef.current?.click()}
                                    className="grid h-20 w-20 place-items-center rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 disabled:opacity-50"
                                >
                                    {uploading ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
                                </button>
                            )}
                        </div>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            aria-hidden="true"
                            tabIndex={-1}
                            onChange={(e) => {
                                void attachPhotos(e.target.files);
                                e.target.value = "";
                            }}
                        />
                    </div>
                </section>

                <section className="space-y-3 rounded-[24px] bg-white p-4 shadow-sm">
                    <h2 className="text-[15px] font-extrabold">Budget & preferences</h2>
                    <div>
                        <label htmlFor="bd-budget" className="mb-1.5 block text-xs font-bold text-slate-600">
                            Estimated budget (required)
                        </label>
                        <div className="relative">
                            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">PKR</span>
                            <input
                                id="bd-budget"
                                type="number"
                                inputMode="numeric"
                                min="1"
                                step="1"
                                required
                                value={estimatedBudget}
                                onChange={(e) => setEstimatedBudget(e.target.value.replace(/[^\d]/g, ""))}
                                placeholder="3,000"
                                className={`${inputCls} pl-14 text-lg font-extrabold`}
                            />
                        </div>
                        <p className="mt-1.5 text-xs text-slate-400">
                            Your partner will ask for your approval before spending — nothing is bought above what you approve.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label htmlFor="bd-shop" className="mb-1.5 block text-xs font-bold text-slate-600">Preferred shop (optional)</label>
                            <input
                                id="bd-shop"
                                value={preferredShop}
                                onChange={(e) => setPreferredShop(e.target.value)}
                                maxLength={120}
                                placeholder="e.g. Carrefour, local market"
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label htmlFor="bd-brand" className="mb-1.5 block text-xs font-bold text-slate-600">Preferred brand (optional)</label>
                            <input
                                id="bd-brand"
                                value={preferredBrand}
                                onChange={(e) => setPreferredBrand(e.target.value)}
                                maxLength={120}
                                placeholder="e.g. Nestlé, Shan"
                                className={inputCls}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#F9FAFB] px-4 py-3">
                        <div>
                            <p className="text-sm font-bold">Alternatives allowed</p>
                            <p className="text-xs text-slate-500">Partner may suggest a substitute if an item is unavailable.</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={alternativesAllowed}
                            aria-label="Alternatives allowed"
                            onClick={() => setAlternativesAllowed((v) => !v)}
                            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${alternativesAllowed ? "bg-[#087F5B]" : "bg-slate-300"}`}
                        >
                            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${alternativesAllowed ? "left-[22px]" : "left-0.5"}`} />
                        </button>
                    </div>
                    {alternativesAllowed && (
                        <input
                            value={alternativesNote}
                            onChange={(e) => setAlternativesNote(e.target.value)}
                            maxLength={300}
                            placeholder="e.g. Any good brand is fine for spices"
                            className={inputCls}
                            aria-label="Alternatives note"
                        />
                    )}
                </section>

                <section className="space-y-3 rounded-[24px] bg-white p-4 shadow-sm">
                    <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                        <MapPin size={17} className="text-[#087F5B]" /> Deliver to
                    </h2>
                    {savedPlaces.length > 0 && (
                        <div>
                            <label htmlFor="bd-place" className="mb-1.5 block text-xs font-bold text-slate-600">Saved places</label>
                            <select
                                id="bd-place"
                                value={deliveryLabel && savedPlaces.some((p) => (p.name || p.type) === deliveryLabel) ? String(savedPlaces.find((p) => (p.name || p.type) === deliveryLabel)?._id || "") : ""}
                                onChange={(e) => chooseSavedPlace(e.target.value)}
                                className={inputCls}
                            >
                                <option value="">Choose a saved place…</option>
                                {savedPlaces.map((place) => (
                                    <option key={place._id} value={place._id}>
                                        {place.type === "HOME" ? "🏠 " : place.type === "WORK" ? "💼 " : "⭐ "}
                                        {place.name || place.type} — {place.address || ""}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label htmlFor="bd-address" className="mb-1.5 block text-xs font-bold text-slate-600">Delivery address</label>
                        <textarea
                            id="bd-address"
                            value={manualAddress}
                            onChange={(e) => setManualAddress(e.target.value)}
                            rows={2}
                            maxLength={300}
                            placeholder="House, street, mohalla, landmark…"
                            className={`${inputCls} resize-none`}
                        />
                        {delivery && (
                            <p className="mt-1.5 text-xs font-semibold text-[#087F5B]">
                                📍 Location pinned ({delivery.latitude.toFixed(5)}, {delivery.longitude.toFixed(5)})
                                {deliveryLabel ? ` · ${deliveryLabel}` : ""}
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={useCurrentLocation}
                        disabled={locating}
                        className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-50 px-3 text-xs font-bold text-[#087F5B] disabled:opacity-60"
                    >
                        <LocateFixed size={15} className={locating ? "animate-pulse" : ""} />
                        {locating ? "Locating…" : "Use my current location"}
                    </button>
                    <div>
                        <label htmlFor="bd-notes" className="mb-1.5 block text-xs font-bold text-slate-600">Delivery notes (optional)</label>
                        <textarea
                            id="bd-notes"
                            value={deliveryNotes}
                            onChange={(e) => setDeliveryNotes(e.target.value)}
                            rows={2}
                            maxLength={500}
                            placeholder="Gate code, floor, call on arrival…"
                            className={`${inputCls} resize-none`}
                        />
                    </div>
                </section>

                {error && (
                    <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                        {error}
                    </p>
                )}

                <button
                    type="submit"
                    disabled={submitting || uploading}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-[#087F5B] text-[15px] font-extrabold text-white shadow-sm transition-transform active:scale-[0.99] disabled:opacity-60"
                >
                    {submitting ? (
                        <><Loader2 size={19} className="animate-spin" /> Sending request…</>
                    ) : (
                        <><Check size={19} /> Send shopping request</>
                    )}
                </button>
                <p className="px-2 text-center text-xs leading-relaxed text-slate-400">
                    Nearby partners will offer their delivery fee. You pick one, approve the
                    shopping cost in the app, and pay cash (items + fee) at your door.
                </p>
            </form>

            <MobileBottomNav role="PASSENGER" />
        </main>
    );
}
