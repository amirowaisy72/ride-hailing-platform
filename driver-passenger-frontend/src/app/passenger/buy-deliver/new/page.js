"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Geolocation } from "@capacitor/geolocation";
import {
    ArrowLeft,
    Check,
    ChevronDown,
    ImagePlus,
    Loader2,
    LocateFixed,
    MapPin,
    ShoppingBag,
    X,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import ServiceGuide from "@/components/guides/ServiceGuide";
import { recordFlowCompletion } from "@/lib/guides/guideStore";
import { useLanguage } from "@/components/i18n/LanguageProvider";
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

const COORDS_TEXT = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/;

function BuyDeliverForm() {
    const { user, token } = useAuth();
    const { t } = useLanguage();
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

    // Wizard state (A3): 1 list → 2 budget & delivery → 3 review.
    // "More options" is a collapsed section reachable from steps 1 and 2;
    // all field state lives here in the parent, so expanding/collapsing
    // or moving between steps never loses anything typed.
    const [step, setStep] = useState(1);
    const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);

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
            let resolvedName = "";
            try {
                const result = await reverseGeocode(latitude, longitude, token);
                // A4: /locations/reverse returns { name, source } — name
                // is a provider address or a "Near <saved place>" label.
                // Older/other shapes (display_name / address) are still
                // honoured, but `name` is the field the backend sends.
                const resolved =
                    result?.name ||
                    result?.display_name ||
                    result?.displayName ||
                    result?.address;
                if (typeof resolved === "string" && resolved.trim()) {
                    resolvedName = resolved.trim();
                    address = resolvedName;
                }
            } catch { /* Keep coordinates as the address. */ }
            setDelivery({ latitude, longitude, address });
            // The DISPLAYED label is the resolved name when one exists
            // (incl. "Near …") — never raw coordinates. The stored
            // payload still carries the coordinates via `delivery`.
            setDeliveryLabel(resolvedName || "Current location");
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

    function validateList() {
        if (!itemsText.trim()) {
            setError(t("bdNew.errList"));
            return false;
        }
        return true;
    }

    function validateBudgetAndDelivery() {
        const budget = Number(estimatedBudget);
        if (!Number.isSafeInteger(budget) || budget <= 0) {
            setError(t("bdNew.errBudget"));
            return false;
        }
        if (!delivery && !manualAddress.trim()) {
            setError(t("bdNew.errAddress"));
            return false;
        }
        return true;
    }

    function goNext() {
        setError("");
        if (step === 1) {
            if (!validateList()) return;
            setStep(2);
        } else if (step === 2) {
            if (!validateBudgetAndDelivery()) return;
            setStep(3);
        }
    }

    function goBack() {
        setError("");
        setStep((s) => Math.max(1, s - 1));
    }

    async function submit(event) {
        event.preventDefault();
        if (submitting) return;
        // Enter-key / implicit submits before the review step just
        // advance the wizard — "Place request" is the only submit.
        if (step < 3) {
            goNext();
            return;
        }
        const budget = Number(estimatedBudget);
        if (!validateList() || !validateBudgetAndDelivery()) return;
        const addressText = manualAddress.trim();
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
            recordFlowCompletion(user?._id, "bdPassenger");
            router.push(`/passenger/buy-deliver/details?id=${data.order._id}`);
        } catch (e) {
            setError(e.message);
            setSubmitting(false);
        }
    }

    const inputCls =
        "w-full rounded-2xl border border-pd-line bg-pd-surface-2 px-4 py-3 text-[15px] text-pd-text outline-none placeholder:text-pd-faint focus:border-[#087F5B] focus:ring-2 focus:ring-[#087F5B]/25";

    const primaryBtnCls =
        "flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-[#087F5B] text-[15px] font-extrabold text-white shadow-sm transition-transform active:scale-[0.99] disabled:opacity-60";
    const backBtnCls =
        "flex h-14 items-center justify-center gap-1.5 rounded-[20px] bg-pd-surface px-5 text-[15px] font-extrabold text-pd-text shadow-sm transition-transform active:scale-[0.99]";

    // The pinned-location line: show the human name (saved place label,
    // reverse-geocoded name, "Near …") whenever one exists; coordinates
    // are only a last-resort display when no name was resolved.
    const pinnedName =
        deliveryLabel && deliveryLabel !== "Current location"
            ? deliveryLabel
            : delivery?.address && !COORDS_TEXT.test(delivery.address.trim())
              ? delivery.address
              : "";

    function renderMoreOptions() {
        return (
            <section className="rounded-[24px] bg-pd-surface shadow-sm">
                <button
                    type="button"
                    aria-expanded={moreOptionsOpen}
                    onClick={() => setMoreOptionsOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-4 py-3.5 text-left"
                >
                    <span className="text-[15px] font-extrabold">
                        {t("bdNew.moreOptions")} <span className="font-semibold text-pd-muted">{t("bdNew.optional")}</span>
                    </span>
                    <ChevronDown
                        size={18}
                        className={`shrink-0 text-pd-muted transition-transform ${moreOptionsOpen ? "rotate-180" : ""}`}
                        aria-hidden="true"
                    />
                </button>
                {moreOptionsOpen && (
                    <div className="space-y-3 px-4 pb-4">
                        <div>
                            <p className="mb-2 text-xs font-bold text-pd-text-2">{t("bdNew.refPhotos")}</p>
                            <div className="flex flex-wrap gap-2">
                                {imageUrls.map((url) => (
                                    <span key={url} className="relative block h-20 w-20 overflow-hidden rounded-2xl bg-pd-surface-3">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={url} alt="Reference" className="h-full w-full object-cover" />
                                        <button
                                            type="button"
                                            aria-label={t("bdNew.removePhoto")}
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
                                        className="grid h-20 w-20 place-items-center rounded-2xl border-2 border-dashed border-pd-line text-pd-faint disabled:opacity-50"
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
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                                <label htmlFor="bd-shop" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("bdNew.preferredShop")}</label>
                                <input
                                    id="bd-shop"
                                    value={preferredShop}
                                    onChange={(e) => setPreferredShop(e.target.value)}
                                    maxLength={120}
                                    placeholder={t("bdNew.shopPlaceholder")}
                                    className={inputCls}
                                />
                            </div>
                            <div>
                                <label htmlFor="bd-brand" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("bdNew.preferredBrand")}</label>
                                <input
                                    id="bd-brand"
                                    value={preferredBrand}
                                    onChange={(e) => setPreferredBrand(e.target.value)}
                                    maxLength={120}
                                    placeholder={t("bdNew.brandPlaceholder")}
                                    className={inputCls}
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-2xl bg-pd-surface-2 px-4 py-3">
                            <div>
                                <p className="text-sm font-bold">{t("bdNew.alternatives")}</p>
                                <p className="text-xs text-pd-muted">{t("bdNew.alternativesHint")}</p>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={alternativesAllowed}
                                aria-label={t("bdNew.alternatives")}
                                onClick={() => setAlternativesAllowed((v) => !v)}
                                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${alternativesAllowed ? "bg-[#087F5B]" : "bg-pd-surface-3"}`}
                            >
                                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${alternativesAllowed ? "left-[22px]" : "left-0.5"}`} />
                            </button>
                        </div>
                        {alternativesAllowed && (
                            <input
                                value={alternativesNote}
                                onChange={(e) => setAlternativesNote(e.target.value)}
                                maxLength={300}
                                placeholder={t("bdNew.alternativesNotePlaceholder")}
                                className={inputCls}
                                aria-label={t("bdNew.alternativesLabel")}
                            />
                        )}
                    </div>
                )}
            </section>
        );
    }

    const stepTitles = [t("bdNew.stepList"), t("bdNew.stepBudget"), t("bdNew.stepReview")];

    return (
        <main className="min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <div className="sticky top-0 z-20 border-b border-pd-line bg-pd-elevated backdrop-blur-xl">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
                    <Link
                        href="/passenger/buy-deliver"
                        aria-label={t("bdNew.title")}
                        className="grid h-11 w-11 place-items-center rounded-2xl hover:bg-pd-surface-2"
                    >
                        <ArrowLeft size={21} />
                    </Link>
                    <div className="min-w-0 flex-1">
                        <h1 className="text-lg font-extrabold leading-tight tracking-tight">{t("bdNew.title")}</h1>
                        <p className="text-xs text-pd-muted">{t("bdNew.subtitle")}</p>
                    </div>
                    <ShoppingBag size={20} className="text-[#087F5B]" aria-hidden="true" />
                </div>
            </div>

            <form onSubmit={submit} className="mx-auto max-w-xl space-y-4 px-4 pt-4" noValidate>
                {/* Step indicator */}
                <ol className="flex items-center gap-2" aria-label="Request steps">
                    {stepTitles.map((title, i) => {
                        const n = i + 1;
                        const active = step === n;
                        const done = step > n;
                        return (
                            <li key={title} className="flex min-w-0 flex-1 items-center gap-2">
                                <span
                                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold ${
                                        active || done
                                            ? "bg-[#087F5B] text-white"
                                            : "bg-pd-surface-3 text-pd-muted"
                                    }`}
                                    aria-current={active ? "step" : undefined}
                                >
                                    {done ? <Check size={14} /> : n}
                                </span>
                                <span className={`truncate text-xs font-bold ${active ? "text-pd-text" : "text-pd-muted"}`}>
                                    {title}
                                </span>
                            </li>
                        );
                    })}
                </ol>

                {step === 1 && (
                    <>
                        <section data-guide="bd-list" className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm">
                            <h2 className="text-[15px] font-extrabold">{t("bdNew.stepList")}</h2>
                            <textarea
                                value={itemsText}
                                onChange={(e) => setItemsText(e.target.value)}
                                rows={6}
                                maxLength={2000}
                                required
                                placeholder={t("bdNew.listPlaceholder")}
                                className={`${inputCls} resize-none leading-relaxed`}
                                aria-label={t("bdNew.shoppingList")}
                            />
                            <p className="text-xs text-pd-faint">{t("bdNew.listHint", { count: itemsText.length })}</p>
                        </section>

                        {renderMoreOptions()}

                        {error && (
                            <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">
                                {error}
                            </p>
                        )}

                        <button type="button" data-guide="bd-next" onClick={goNext} className={primaryBtnCls}>
                            {t("common.next")}
                        </button>
                    </>
                )}

                {step === 2 && (
                    <>
                        <section className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm">
                            <h2 className="text-[15px] font-extrabold">{t("bdNew.stepBudget")}</h2>
                            <div>
                                <label htmlFor="bd-budget" className="mb-1.5 block text-xs font-bold text-pd-text-2">
                                    {t("bdNew.budgetRequired")}
                                </label>
                                <div className="relative">
                                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-pd-faint">PKR</span>
                                    <input
                                        data-guide="bd-budget"
                                        id="bd-budget"
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        autoComplete="off"
                                        required
                                        value={estimatedBudget}
                                        onChange={(e) => setEstimatedBudget(e.target.value.replace(/[^\d]/g, ""))}
                                        placeholder="3000"
                                        className={`${inputCls} pl-14 text-lg font-extrabold`}
                                    />
                                </div>
                                <p className="mt-1.5 text-xs text-pd-faint">
                                    {t("bdNew.budgetHint")}
                                </p>
                            </div>
                        </section>

                        <section data-guide="bd-location" className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm">
                            <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                                <MapPin size={17} className="text-[#087F5B]" /> {t("bdNew.deliverTo")}
                            </h2>
                            {savedPlaces.length > 0 && (
                                <div>
                                    <label htmlFor="bd-place" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("bdNew.savedPlaces")}</label>
                                    <select
                                        id="bd-place"
                                        value={deliveryLabel && savedPlaces.some((p) => (p.name || p.type) === deliveryLabel) ? String(savedPlaces.find((p) => (p.name || p.type) === deliveryLabel)?._id || "") : ""}
                                        onChange={(e) => chooseSavedPlace(e.target.value)}
                                        className={inputCls}
                                    >
                                        <option value="">{t("bdNew.chooseSaved")}</option>
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
                                <label htmlFor="bd-address" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("bdNew.deliveryAddress")}</label>
                                <div className="flex items-start gap-2">
                                    <textarea
                                        id="bd-address"
                                        value={manualAddress}
                                        onChange={(e) => setManualAddress(e.target.value)}
                                        rows={2}
                                        maxLength={300}
                                        placeholder={t("bdNew.addressPlaceholder")}
                                        className={`${inputCls} resize-none`}
                                    />
                                </div>
                                {delivery && (
                                    <p className="mt-1.5 text-xs font-semibold text-[#087F5B]">
                                        📍 {pinnedName
                                            ? `${t("bdNew.locationPinned")} · ${pinnedName}`
                                            : `${t("bdNew.locationPinned")} (${delivery.latitude.toFixed(5)}, ${delivery.longitude.toFixed(5)})`}
                                    </p>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={useCurrentLocation}
                                disabled={locating}
                                className="flex min-h-11 items-center gap-2 rounded-xl bg-pd-accent-soft px-3 text-xs font-bold text-pd-accent-text disabled:opacity-60"
                            >
                                <LocateFixed size={15} className={locating ? "animate-pulse" : ""} />
                                {locating ? t("bdNew.locating") : t("bdNew.useCurrentLocation")}
                            </button>
                            <div>
                                <label htmlFor="bd-notes" className="mb-1.5 block text-xs font-bold text-pd-text-2">{t("bdNew.deliveryNotes")}</label>
                                <div className="flex items-start gap-2">
                                    <textarea
                                        id="bd-notes"
                                        value={deliveryNotes}
                                        onChange={(e) => setDeliveryNotes(e.target.value)}
                                        rows={2}
                                        maxLength={500}
                                        placeholder={t("bdNew.notesPlaceholder")}
                                        className={`${inputCls} resize-none`}
                                    />
                                </div>
                            </div>
                        </section>

                        {renderMoreOptions()}

                        {error && (
                            <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">
                                {error}
                            </p>
                        )}

                        <div className="flex gap-3">
                            <button type="button" onClick={goBack} className={backBtnCls}>
                                <ArrowLeft size={17} /> {t("common.back")}
                            </button>
                            <button type="button" onClick={goNext} className={`${primaryBtnCls} flex-1`}>
                                {t("common.next")}
                            </button>
                        </div>
                    </>
                )}

                {step === 3 && (
                    <>
                        <section className="space-y-3 rounded-[24px] bg-pd-surface p-4 shadow-sm">
                            <h2 className="text-[15px] font-extrabold">{t("bdNew.reviewTitle")}</h2>
                            <div>
                                <p className="mb-1.5 text-xs font-bold text-pd-text-2">{t("bdNew.shoppingList")}</p>
                                <p className="whitespace-pre-line rounded-2xl bg-pd-surface-2 px-4 py-3 text-sm leading-relaxed">
                                    {itemsText.trim()}
                                </p>
                            </div>
                            <div className="space-y-1.5 border-t border-pd-line pt-3 text-sm">
                                <p className="flex items-start justify-between gap-3">
                                    <span className="text-pd-muted">{t("bdNew.deliverTo")}</span>
                                    <span className="text-right font-semibold">
                                        {deliveryLabel || manualAddress.trim() || "—"}
                                        {manualAddress.trim() && deliveryLabel && manualAddress.trim() !== deliveryLabel && (
                                            <span className="block text-xs font-medium text-pd-muted">{manualAddress.trim()}</span>
                                        )}
                                    </span>
                                </p>
                                {preferredShop.trim() && (
                                    <p className="flex justify-between gap-3">
                                        <span className="text-pd-muted">{t("bdNew.preferredShopLabel")}</span>
                                        <span className="font-semibold">{preferredShop.trim()}</span>
                                    </p>
                                )}
                                {preferredBrand.trim() && (
                                    <p className="flex justify-between gap-3">
                                        <span className="text-pd-muted">{t("bdNew.preferredBrandLabel")}</span>
                                        <span className="font-semibold">{preferredBrand.trim()}</span>
                                    </p>
                                )}
                                {imageUrls.length > 0 && (
                                    <p className="flex justify-between gap-3">
                                        <span className="text-pd-muted">{t("bdNew.refPhotosLabel")}</span>
                                        <span className="font-semibold">{t("bdNew.attached", { count: imageUrls.length })}</span>
                                    </p>
                                )}
                                <p className="flex justify-between gap-3">
                                    <span className="text-pd-muted">{t("bdNew.alternativesLabel")}</span>
                                    <span className="font-semibold">{alternativesAllowed ? t("bdNew.allowed") : t("bdNew.notAllowed")}</span>
                                </p>
                                {deliveryNotes.trim() && (
                                    <p className="flex justify-between gap-3">
                                        <span className="text-pd-muted">{t("bdNew.deliveryNotesLabel")}</span>
                                        <span className="text-right font-semibold">{deliveryNotes.trim()}</span>
                                    </p>
                                )}
                            </div>
                        </section>

                        {error && (
                            <p role="alert" className="rounded-2xl bg-pd-danger-soft px-4 py-3 text-sm font-semibold text-pd-danger">
                                {error}
                            </p>
                        )}

                        <p className="rounded-2xl bg-pd-surface px-4 py-3 text-base font-extrabold text-pd-text shadow-sm" aria-live="polite">
                            {t("bdNew.totalBudget")}{" "}
                            {estimatedBudget
                                ? `PKR ${Number(estimatedBudget).toLocaleString("en-PK")}`
                                : t("bdNew.notSetYet")}
                        </p>

                        <div className="flex gap-3">
                            <button type="button" onClick={goBack} className={backBtnCls}>
                                <ArrowLeft size={17} /> {t("common.back")}
                            </button>
                            <button
                                type="submit"
                                data-guide="bd-submit"
                                disabled={submitting || uploading}
                                className={`${primaryBtnCls} flex-1`}
                            >
                                {submitting ? (
                                    <><Loader2 size={19} className="animate-spin" /> {t("bdNew.sendingRequest")}</>
                                ) : (
                                    <><Check size={19} /> {t("bdNew.placeRequest")}</>
                                )}
                            </button>
                        </div>
                        <p className="px-2 text-center text-xs leading-relaxed text-pd-faint">
                            {t("bdNew.reviewHint")}
                        </p>
                    </>
                )}
            </form>

            <MobileBottomNav role="PASSENGER" />
            <ServiceGuide serviceId="bdPassenger" userId={user?._id} />
        </main>
    );
}
