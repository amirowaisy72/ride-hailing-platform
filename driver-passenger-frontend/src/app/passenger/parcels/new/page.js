"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Geolocation } from "@capacitor/geolocation";
import {
    ArrowLeft, Check, ChevronRight, Crosshair, LocateFixed, MapPin, Package, Search, ShoppingBag, X,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import MicButton from "@/components/MicButton";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { apiRequest } from "@/lib/api";
import { searchLocations, reverseGeocode } from "@/lib/locationService";
import RideMap from "@/components/RideMap";
import { useVisibleViewport, visibleViewportSurfaceStyle } from "@/hooks/useVisibleViewport";
import { Button, InlineError, RouteSummary } from "@/components/parcel/ParcelKit";
import { CATEGORY_LABELS, VEHICLE_LABELS, categoryLabel, formatPKR, serviceLabel , vehicleLabel } from "@/components/parcel/parcelUi";

export default function NewParcelPage() {
    return (
        <AuthGuard role="PASSENGER">
            <ParcelBookingForm />
        </AuthGuard>
    );
}

const STEP_TITLES = {
    1: "Sender & receiver",
    2: "Parcel details",
    3: "Vehicle & offer",
    4: "Review",
};
const PHONE_RE = /^[+\d][\d\s-]{6,}$/;

function ParcelBookingForm() {
    const { token } = useAuth();
    const { t } = useLanguage();
    const router = useRouter();

    const [serviceType, setServiceType] = useState("SEND_PARCEL");
    const [bookingStep, setBookingStep] = useState(1);
    const [picking, setPicking] = useState(false);
    const [mapSelectionMode, setMapSelectionMode] = useState(null);
    const [pickup, setPickup] = useState(null);
    const [destination, setDestination] = useState(null);
    const [pickupQuery, setPickupQuery] = useState("");
    const [destinationQuery, setDestinationQuery] = useState("");
    const [results, setResults] = useState([]);
    const [activeSearch, setActiveSearch] = useState(null);
    const [searching, setSearching] = useState(false);
    const [searchLocation, setSearchLocation] = useState(null);
    const [locating, setLocating] = useState(false);
    const searchTimer = useRef(null);
    // Address search panel: while the keyboard is open, pin the panel
    // to the visible viewport so its results area (already flex-1)
    // fills the space above the keyboard instead of extending behind
    // it — same Round 5 fix as the ride booking sheet.
    const visibleViewport = useVisibleViewport();
    const searchSurface = visibleViewportSurfaceStyle(visibleViewport);
    const searchPanelStyle = searchSurface ? { ...searchSurface, maxHeight: "none" } : undefined;

    useEffect(() => {
        return () => clearTimeout(searchTimer.current);
    }, []);

    // Deep link from the dashboard: /passenger/parcels/new?service=SHOP_PICKUP
    useEffect(() => {
        const service = new URLSearchParams(window.location.search).get("service");
        if (service === "SHOP_PICKUP" || service === "SEND_PARCEL") setServiceType(service);
    }, []);

    const [error, setError] = useState("");
    const [touchedStep, setTouchedStep] = useState(0);

    const [sender, setSender] = useState({ name: "", phone: "" });
    const [receiver, setReceiver] = useState({ name: "", phone: "" });
    const [category, setCategory] = useState("OTHER");
    const [description, setDescription] = useState("");
    const [weightKg, setWeightKg] = useState("1");
    const [quantity, setQuantity] = useState("1");
    const [vehicleType, setVehicleType] = useState("BIKE");
    const [requestedPrice, setRequestedPrice] = useState("");
    const [paymentBy, setPaymentBy] = useState("SENDER");
    const [instructions, setInstructions] = useState("");
    const [submitting, setSubmitting] = useState(false);

    async function findPlaces(query, field) {
        if (field === "pickup") {
            setPickupQuery(query);
            setPickup(null);
        } else {
            setDestinationQuery(query);
            setDestination(null);
        }

        setActiveSearch(field);
        setResults([]);

        if (query.trim().length < 3) return;

        setSearching(true);
        try {
            let location = searchLocation;

            if (!location) {
                const position = await Geolocation.getCurrentPosition({
                    enableHighAccuracy: true,
                    timeout: 15000,
                });

                location = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                };

                setSearchLocation(location);
            }

            const places = await searchLocations(query, token, location);
            setResults(places || []);
        } catch (e) {
            setError(e.message);
        } finally {
            setSearching(false);
        }
    }

    function choosePlace(place) {
        const point = {
            latitude: Number(place.latitude),
            longitude: Number(place.longitude),
            address: place.display_name || place.name || "",
        };

        if (activeSearch === "pickup") {
            setPickup(point);
            setPickupQuery(point.address);
        } else {
            setDestination(point);
            setDestinationQuery(point.address);
        }

        setResults([]);
        setActiveSearch(null);
    }

    async function useCurrentPickup() {
        setLocating(true);
        setError("");
        try {
            const position = await Geolocation.getCurrentPosition({
                enableHighAccuracy: true,
                timeout: 15000,
            });

            setSearchLocation({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
            });

            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;

            let address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

            try {
                const result = await reverseGeocode(latitude, longitude, token);
                address = result?.display_name || result?.address || result?.name || address;
                if (typeof address !== "string") {
                    address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                }
            } catch {
                // Keep accurate GPS coordinates if address lookup fails.
            }

            setPickup({ latitude, longitude, address });
            setPickupQuery(address);
            setResults([]);
            setActiveSearch(null);
        } catch (e) {
            setError(e.message);
        } finally {
            setLocating(false);
        }
    }

    async function selectLocationOnMap(point) {
        const field = mapSelectionMode || activeSearch || (pickup ? "destination" : "pickup");
        setMapSelectionMode(null);
        const { latitude, longitude } = point;

        setError("");
        setResults([]);
        setActiveSearch(null);

        const fallback = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        const selected = { latitude, longitude, address: fallback };

        if (field === "pickup") {
            setPickup(selected);
            setPickupQuery(fallback);
        } else {
            setDestination(selected);
            setDestinationQuery(fallback);
        }

        try {
            const result = await reverseGeocode(latitude, longitude, token);
            const address = typeof result === "string"
                ? result
                : result?.display_name || result?.address || result?.name;

            if (typeof address !== "string" || !address.trim()) return;

            const updated = { latitude, longitude, address };

            if (field === "pickup") {
                setPickup(updated);
                setPickupQuery(address);
            } else {
                setDestination(updated);
                setDestinationQuery(address);
            }
        } catch {
            // Coordinates remain selected if address lookup fails.
        }
    }

    function onQueryChange(field, value) {
        clearTimeout(searchTimer.current);

        if (field === "pickup") {
            setPickupQuery(value);
            setPickup(null);
        } else {
            setDestinationQuery(value);
            setDestination(null);
        }

        setActiveSearch(field);
        setResults([]);

        if (value.trim().length >= 3) {
            searchTimer.current = setTimeout(() => {
                findPlaces(value, field);
            }, 500);
        }
    }

    // ---- Per-step validation (client-side only; payload unchanged) ----
    const fieldErrors = {
        senderName: !sender.name.trim() && t("parcels.errSenderName"),
        senderPhone: !PHONE_RE.test(sender.phone.trim()) && t("parcels.errPhone"),
        receiverName: !receiver.name.trim() && t("parcels.errReceiverName"),
        receiverPhone: !PHONE_RE.test(receiver.phone.trim()) && t("parcels.errPhone"),
        weightKg: !(Number(weightKg) > 0) && t("parcels.errWeight"),
        quantity: !(Number.isInteger(Number(quantity)) && Number(quantity) >= 1) && t("parcels.errQuantity"),
        requestedPrice: !(Number.isSafeInteger(Number(requestedPrice)) && Number(requestedPrice) > 0) && t("parcels.errFare"),
    };
    const FIELD_STEP = {
        senderName: 1, senderPhone: 1, receiverName: 1, receiverPhone: 1,
        weightKg: 2, quantity: 2,
        requestedPrice: 3,
    };
    const stepHasErrors = (step) =>
        Object.entries(FIELD_STEP).some(
            ([key, fieldStep]) => fieldStep === step && fieldErrors[key]
        );
    const showErr = (key) =>
        touchedStep >= (FIELD_STEP[key] || 1) ? fieldErrors[key] : false;

    function goNext() {
        setTouchedStep(bookingStep);
        if (bookingStep === 1 && (!pickup || !destination)) {
            setError(t("parcels.errChooseLocations"));
            return;
        }
        if (stepHasErrors(bookingStep)) {
            setError(t("parcels.errCompleteFields"));
            return;
        }
        setError("");
        setBookingStep(bookingStep + 1);
        window.scrollTo({ top: 0 });
    }

    async function submitParcel(event) {
        event.preventDefault();
        if (bookingStep !== 4) return;
        if (!pickup || !destination || submitting) {
            if (!pickup || !destination) setError(t("parcels.errSelectLocations"));
            return;
        }

        setSubmitting(true);
        setError("");

        try {
            const data = await apiRequest("/parcels", {
                method: "POST",
                token,
                body: JSON.stringify({
                    serviceType,
                    pickup,
                    destination,
                    sender,
                    receiver,
                    parcel: {
                        category,
                        description,
                        weightKg: Number(weightKg),
                        quantity: Number(quantity),
                    },
                    vehicleType,
                    requestedPrice: Number(requestedPrice),
                    paymentBy,
                    instructions,
                }),
            });

            router.push(`/passenger/parcels/details?parcelId=${data.order._id}`);
        } catch (e) {
            setError(e.message);
            setSubmitting(false);
        }
    }

    // ===================== STEP 1 — LOCATION PICKER =====================
    if (bookingStep === 1 && picking) {
        const searchField = activeSearch;
        return (
            <main className="relative h-dvh overflow-hidden bg-pd-surface-3 text-pd-text">
                <div className="absolute inset-0 z-0">
                    <RideMap
                        userLocation={pickup}
                        destination={destination}
                        onMapClick={selectLocationOnMap}
                        showNavigationControl={false}
                        sheetRatio={0.42}
                    />
                </div>

                {/* Compact top bar */}
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 pd-safe-top">
                    <div className="mx-auto flex max-w-xl items-center gap-2 px-3">
                        <button
                            type="button"
                            onClick={() => setPicking(false)}
                            aria-label={t("parcels.backDetails")}
                            className="pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-pd-surface text-pd-text shadow-pd"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div role="radiogroup" aria-label={t("parcels.serviceType")} className="pointer-events-auto ml-auto flex rounded-2xl bg-pd-surface p-1 shadow-pd">
                            {[
                                ["SEND_PARCEL", "Send", Package],
                                ["SHOP_PICKUP", t("parcels.shopPickup"), ShoppingBag],
                            ].map(([id, label, Icon]) => (
                                <button
                                    key={id}
                                    type="button"
                                    role="radio"
                                    aria-checked={serviceType === id}
                                    onClick={() => setServiceType(id)}
                                    className={`flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition ${serviceType === id
                                        ? "bg-pd-ink text-pd-ink-text"
                                        : "text-pd-muted"
                                        }`}
                                >
                                    <Icon size={14} /> {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {mapSelectionMode && (
                        <div className="pd-drop pointer-events-auto mx-auto mt-2 flex max-w-xl items-center gap-3 px-3">
                            <div className="flex min-h-12 flex-1 items-center gap-2 rounded-2xl bg-pd-ink px-4 text-sm font-bold text-pd-ink-text shadow-pd-lg">
                                <Crosshair size={16} className="shrink-0" />
                                Tap the map to set {mapSelectionMode === "pickup" ? "pickup" : "drop-off"}
                            </div>
                            <button
                                type="button"
                                onClick={() => setMapSelectionMode(null)}
                                className="h-12 rounded-2xl bg-pd-surface px-4 text-sm font-bold shadow-pd"
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </div>

                {/* Location card */}
                {!mapSelectionMode && !searchField && (
                    <section className="pd-rise absolute inset-x-0 bottom-0 z-20 mx-auto max-w-xl rounded-t-[28px] bg-pd-surface px-4 pt-4 shadow-pd-lg sm:inset-x-3 sm:bottom-3 sm:rounded-[28px]">
                        <h1 className="text-lg font-extrabold tracking-tight">
                            {serviceType === "SHOP_PICKUP" ? t("parcels.whereShop") : t("parcels.whereGoing")}
                        </h1>
                        <p className="mt-0.5 text-xs text-pd-muted">{t("parcels.mapHint")}</p>

                        <div className="relative mt-3 rounded-2xl bg-pd-surface-2">
                            <span className="absolute bottom-[26px] left-[22px] top-[26px] w-px border-l-2 border-dotted border-pd-line-strong" aria-hidden="true" />
                            {["pickup", "destination"].map((field, idx) => {
                                const point = field === "pickup" ? pickup : destination;
                                const query = field === "pickup" ? pickupQuery : destinationQuery;
                                return (
                                    <div key={field} className={`flex items-center gap-1 ${idx === 0 ? "border-b border-pd-line" : ""}`}>
                                        <button
                                            type="button"
                                            onClick={() => { setActiveSearch(field); setResults([]); }}
                                            className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3.5 text-left"
                                        >
                                            <span className={`relative z-10 grid h-4 w-4 shrink-0 place-items-center ${field === "pickup" ? "rounded-full bg-pd-ink" : "rounded-[4px] bg-pd-danger"}`}>
                                                <span className="h-1.5 w-1.5 rounded-full bg-pd-surface" />
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-[10px] font-bold uppercase tracking-wide text-pd-muted">
                                                    {field === "pickup" ? (serviceType === "SHOP_PICKUP" ? t("parcels.shopPickupPoint") : t("parcels.pickup")) : t("parcels.dropoff")}
                                                </span>
                                                <span className={`block truncate text-sm font-semibold ${point ? "text-pd-text" : "text-pd-faint"}`}>
                                                    {point ? (point.address || query) : field === "pickup" ? t("parcels.setPickup") : t("parcels.setDelivery")}
                                                </span>
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Choose ${field === "pickup" ? "pickup" : "drop-off"} on map`}
                                            onClick={() => { setMapSelectionMode(field); setActiveSearch(null); setResults([]); }}
                                            className="mr-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-pd-muted"
                                        >
                                            <MapPin size={18} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-2.5 flex gap-2">
                            <button
                                type="button"
                                onClick={useCurrentPickup}
                                disabled={locating}
                                className="flex min-h-11 items-center gap-2 rounded-xl bg-pd-surface-2 px-3 text-xs font-bold disabled:opacity-60"
                            >
                                <LocateFixed size={15} className={locating ? "animate-pulse" : ""} />
                                {locating ? t("parcels.locating") : t("parcels.useMyLocation")}
                            </button>
                        </div>

                        <div className="mt-3">
                            <InlineError onDismiss={() => setError("")}>{error}</InlineError>
                        </div>

                        <Button
                            className="mt-3 w-full"
                            disabled={!pickup || !destination}
                            onClick={() => { setError(""); setPicking(false); }}
                        >
                            {!pickup ? t("parcels.setPickupContinue") : !destination ? t("parcels.setDropoffContinue") : <>{t("parcels.done")} <Check size={18} /></>}
                        </Button>
                        <StepDots step={1} />
                        <div className="pd-safe-bottom" />
                    </section>
                )}

                {/* Search panel */}
                {searchField && !mapSelectionMode && (
                    <section style={searchPanelStyle} className="pd-rise absolute inset-x-0 bottom-0 z-30 mx-auto flex max-h-[85dvh] max-w-xl flex-col rounded-t-[28px] bg-pd-surface shadow-pd-lg sm:inset-x-3 sm:bottom-3 sm:rounded-[28px]">
                        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
                            <h2 className="flex-1 text-base font-extrabold">
                                {searchField === "pickup" ? t("parcels.pickupLocation") : t("parcels.deliveryLocation")}
                            </h2>
                            <button
                                type="button"
                                aria-label={t("parcels.closeSearch")}
                                onClick={() => { setActiveSearch(null); setResults([]); }}
                                className="grid h-10 w-10 place-items-center rounded-full bg-pd-surface-2"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="px-4">
                            <div className="flex items-start gap-2">
                            <label className="relative block min-w-0 flex-1">
                                <span className="sr-only">{t("parcels.searchPlaceholder")}</span>
                                <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-pd-faint" />
                                <input
                                    autoFocus
                                    type="search"
                                    enterKeyHint="search"
                                    autoComplete="off"
                                    value={searchField === "pickup" ? pickupQuery : destinationQuery}
                                    onChange={(e) => onQueryChange(searchField, e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            clearTimeout(searchTimer.current);
                                            findPlaces(e.currentTarget.value, searchField);
                                        }
                                    }}
                                    placeholder={t("parcels.searchPlaceholder")}
                                    className="pd-input pl-10"
                                />
                            </label>
                            <MicButton
                                onAppend={(spoken) => {
                                    const current = searchField === "pickup" ? pickupQuery : destinationQuery;
                                    onQueryChange(searchField, current.trim() ? `${current.replace(/\s+$/, "")} ${spoken}` : spoken);
                                }}
                            />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {searchField === "pickup" && (
                                    <button type="button" onClick={useCurrentPickup} disabled={locating} className="flex min-h-10 items-center gap-1.5 rounded-xl bg-pd-accent-soft px-3 text-xs font-bold text-pd-accent-text">
                                        <LocateFixed size={14} /> {locating ? t("parcels.locating") : t("parcels.currentLocation")}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => { setMapSelectionMode(searchField); setActiveSearch(null); setResults([]); }}
                                    className="flex min-h-10 items-center gap-1.5 rounded-xl bg-pd-surface-2 px-3 text-xs font-bold"
                                >
                                    <MapPin size={14} /> Choose on map
                                </button>
                            </div>
                        </div>
                        <div className="pd-no-scrollbar mt-2 min-h-[120px] flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
                            {searching && (
                                <div className="space-y-2 p-2">
                                    {[0, 1, 2].map((i) => <div key={i} className="pd-skeleton h-12 rounded-xl" />)}
                                </div>
                            )}
                            {!searching && results.length === 0 && (
                                <p className="px-3 py-6 text-center text-sm text-pd-muted">
                                    {(searchField === "pickup" ? pickupQuery : destinationQuery).trim().length < 3
                                        ? t("parcels.typeMore")
                                        : t("parcels.noPlaces")}
                                </p>
                            )}
                            {!searching && results.map((place, index) => (
                                <button
                                    key={place.place_id || index}
                                    type="button"
                                    onClick={() => choosePlace(place)}
                                    className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-pd-surface-2"
                                >
                                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pd-surface-2 text-pd-muted">
                                        <MapPin size={16} />
                                    </span>
                                    <span className="line-clamp-2 text-sm font-medium">{place.display_name || place.name}</span>
                                </button>
                            ))}
                        </div>
                        {error && <div className="px-4 pb-2"><InlineError onDismiss={() => setError("")}>{error}</InlineError></div>}
                        <div className="pd-safe-bottom" />
                    </section>
                )}
            </main>
        );
    }

    // ===================== STEPS 1–4 — FORM SCREENS =====================
    return (
        <main className="min-h-dvh bg-pd-bg text-pd-text">
            <div className="sticky top-0 z-20 border-b border-pd-line bg-pd-elevated backdrop-blur-xl pd-safe-top">
                <div className="mx-auto flex max-w-xl items-center gap-2 px-3 pb-2.5">
                    {bookingStep === 1 ? (
                        <Link
                            href="/passenger/parcels"
                            aria-label={t("parcels.backParcels")}
                            className="grid h-11 w-11 place-items-center rounded-2xl"
                        >
                            <ArrowLeft size={21} />
                        </Link>
                    ) : (
                        <button
                            type="button"
                            aria-label={t("parcels.previousStep")}
                            onClick={() => { setError(""); setBookingStep(bookingStep - 1); }}
                            className="grid h-11 w-11 place-items-center rounded-2xl"
                        >
                            <ArrowLeft size={21} />
                        </button>
                    )}
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-pd-muted">{t("dBd.stepOf", { step: bookingStep, total: 4, title: "" }).replace(/\s*—\s*$/, "")}</p>
                        <h1 className="text-base font-extrabold leading-tight">{t(`parcels.step${bookingStep}`)}</h1>
                    </div>
                    <span className="rounded-full bg-pd-surface-2 px-3 py-1.5 text-[11px] font-bold">{serviceLabel(serviceType)}</span>
                </div>
                <div className="mx-auto flex max-w-xl gap-1 px-4 pb-2">
                    {[1, 2, 3, 4].map((s) => (
                        <span key={s} className={`h-1 flex-1 rounded-full ${s <= bookingStep ? "bg-pd-accent" : "bg-pd-surface-3"}`} />
                    ))}
                </div>
            </div>

            <form onSubmit={submitParcel} noValidate className="mx-auto max-w-xl px-4 pt-4">
                {bookingStep === 1 && (
                    <div className="space-y-4 pb-4">
                        <Card title={t("parcels.locations")} hint={t("parcels.locationsHint")}>
                            <RouteSummary pickup={pickup} destination={destination} />
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPicking(true)}
                                    className="flex min-h-11 items-center gap-2 rounded-xl bg-pd-accent-soft px-3 text-xs font-bold text-pd-accent-text"
                                >
                                    <MapPin size={14} />
                                    {pickup && destination ? t("parcels.changeLocations") : t("parcels.chooseOnMap")}
                                </button>
                                <button
                                    type="button"
                                    onClick={useCurrentPickup}
                                    disabled={locating}
                                    className="flex min-h-11 items-center gap-2 rounded-xl bg-pd-surface-2 px-3 text-xs font-bold disabled:opacity-60"
                                >
                                    <LocateFixed size={14} className={locating ? "animate-pulse" : ""} />
                                    {locating ? t("parcels.locating") : t("parcels.useMyLocation")}
                                </button>
                            </div>
                            {touchedStep >= 1 && (!pickup || !destination) && (
                                <p className="text-xs font-semibold text-pd-danger">
                                    {!pickup
                                        ? t("parcels.setPickupErr")
                                        : t("parcels.setDropoffErr")}
                                </p>
                            )}
                        </Card>

                        <Card title={t("parcels.sender")} hint={t("parcels.senderHint")}>
                            <Field label={t("parcels.fullName")} error={showErr("senderName")}>
                                <input autoComplete="name" value={sender.name} onChange={(e) => setSender({ ...sender, name: e.target.value })} className="pd-input" aria-invalid={Boolean(showErr("senderName"))} placeholder={t("parcels.namePlaceholder")} />
                            </Field>
                            <Field label={t("parcels.phone")} error={showErr("senderPhone")}>
                                <input type="tel" inputMode="tel" autoComplete="tel" value={sender.phone} onChange={(e) => setSender({ ...sender, phone: e.target.value })} className="pd-input" aria-invalid={Boolean(showErr("senderPhone"))} placeholder="03xx xxxxxxx" />
                            </Field>
                        </Card>

                        <Card title={t("parcels.receiver")} hint={t("parcels.receiverHint")}>
                            <Field label={t("parcels.fullName")} error={showErr("receiverName")}>
                                <input value={receiver.name} onChange={(e) => setReceiver({ ...receiver, name: e.target.value })} className="pd-input" aria-invalid={Boolean(showErr("receiverName"))} placeholder={t("parcels.receiverNamePlaceholder")} />
                            </Field>
                            <Field label={t("parcels.phone")} error={showErr("receiverPhone")}>
                                <input type="tel" inputMode="tel" value={receiver.phone} onChange={(e) => setReceiver({ ...receiver, phone: e.target.value })} className="pd-input" aria-invalid={Boolean(showErr("receiverPhone"))} placeholder="03xx xxxxxxx" />
                            </Field>
                        </Card>

                    </div>
                )}

                {bookingStep === 2 && (
                    <div className="space-y-4 pb-4">
                        <Card title={t("parcels.parcelCard")}>
                            <div className="pd-no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        aria-pressed={category === value}
                                        onClick={() => setCategory(value)}
                                        className={`h-10 shrink-0 rounded-xl px-3.5 text-sm font-bold transition ${category === value
                                            ? "bg-pd-ink text-pd-ink-text"
                                            : "bg-pd-surface-2 text-pd-text-2"
                                            }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label={t("parcels.weight")} error={showErr("weightKg")}>
                                    <input type="number" inputMode="decimal" min="0.01" step="0.01" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} className="pd-input" aria-invalid={Boolean(showErr("weightKg"))} />
                                </Field>
                                <Field label={t("parcels.quantity")} error={showErr("quantity")}>
                                    <input type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="pd-input" aria-invalid={Boolean(showErr("quantity"))} />
                                </Field>
                            </div>
                            <Field label={t("parcels.descriptionOptional")}>
                                <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("parcels.descriptionPlaceholder")} maxLength={500} className="pd-input resize-none" />
                            </Field>
                        </Card>

                    </div>
                )}

                {bookingStep === 3 && (
                    <div className="space-y-4 pb-4">
                        <Card title={t("parcels.deliveryPayment")}>
                            <Field label={t("parcels.vehicle")}>
                                <div className="grid grid-cols-2 gap-2">
                                    {Object.entries(VEHICLE_LABELS).map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            aria-pressed={vehicleType === value}
                                            onClick={() => setVehicleType(value)}
                                            className={`min-h-11 rounded-xl border-2 px-3 text-sm font-bold transition ${vehicleType === value
                                                ? "border-pd-text bg-pd-surface text-pd-text"
                                                : "border-transparent bg-pd-surface-2 text-pd-text-2"
                                                }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </Field>

                            <Field label={t("parcels.yourOffer")} error={showErr("requestedPrice")}>
                                <div className="relative">
                                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-pd-muted">PKR</span>
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        min="1"
                                        step="1"
                                        value={requestedPrice}
                                        onChange={(e) => setRequestedPrice(e.target.value.replace(/[^\d]/g, ""))}
                                        placeholder="0"
                                        aria-invalid={Boolean(showErr("requestedPrice"))}
                                        className="pd-input pl-14 text-xl font-extrabold"
                                    />
                                </div>
                                <p className="mt-1.5 text-xs text-pd-muted">{t("parcels.counterHint")}</p>
                            </Field>

                            <Field label={t("parcels.whoPays")}>
                                <div className="grid grid-cols-2 gap-1 rounded-2xl bg-pd-surface-2 p-1">
                                    {[["SENDER", t("parcels.senderPays")], ["RECEIVER", t("parcels.receiverPays")]].map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            aria-pressed={paymentBy === value}
                                            onClick={() => setPaymentBy(value)}
                                            className={`min-h-11 rounded-xl text-sm font-bold ${paymentBy === value ? "bg-pd-surface text-pd-text shadow-pd" : "text-pd-muted"}`}
                                        >
                                            {label} pays
                                        </button>
                                    ))}
                                </div>
                            </Field>

                            <Field label={t("parcels.instructionsOptional")}>
                                <div className="flex items-start gap-2">
                                    <textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t("parcels.instructionsPlaceholder")} maxLength={500} className="pd-input min-w-0 flex-1 resize-none" />
                                    <MicButton onAppend={(spoken) => setInstructions((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")} ${spoken}` : spoken))} />
                                </div>
                            </Field>
                        </Card>
                    </div>
                )}

                {bookingStep === 4 && (
                    <div className="space-y-4 pb-4">
                        <Card title="Route" action={<EditLink onClick={() => { setError(""); setBookingStep(1); setPicking(true); }} />}>
                            <RouteSummary pickup={pickup} destination={destination} />
                        </Card>
                        <Card title={t("parcels.people")} action={<EditLink onClick={() => { setError(""); setPicking(false); setBookingStep(1); }} />}>
                            <ReviewRow label={t("parcels.sender")} value={`${sender.name} · ${sender.phone}`} />
                            <ReviewRow label={t("parcels.receiver")} value={`${receiver.name} · ${receiver.phone}`} />
                        </Card>
                        <Card title={t("parcels.parcelCard")} action={<EditLink onClick={() => setBookingStep(2)} />}>
                            <ReviewRow label={t("parcels.type")} value={`${categoryLabel(category)} · ${weightKg} kg · ×${quantity}`} />
                            {description && <ReviewRow label={t("parcels.description")} value={description} />}
                        </Card>
                        <Card title={t("parcels.delivery")} action={<EditLink onClick={() => setBookingStep(3)} />}>
                            <ReviewRow label={t("parcels.vehicle")} value={vehicleLabel(vehicleType)} />
                            {instructions && <ReviewRow label={t("parcels.instructions")} value={instructions} />}
                        </Card>
                        <div className="flex items-center justify-between rounded-3xl bg-pd-ink p-5 text-pd-ink-text">
                            <div>
                                <p className="text-xs font-semibold opacity-70">{t("parcels.offerLine", { who: paymentBy === "SENDER" ? t("parcels.senderPays") : t("parcels.receiverPays") })}</p>
                                <p className="mt-0.5 text-2xl font-extrabold">{formatPKR(requestedPrice)}</p>
                            </div>
                            <Package size={28} className="opacity-60" />
                        </div>
                    </div>
                )}

                {/* Sticky action bar (sits above keyboard / safe area) */}
                <div className="sticky bottom-0 z-10 -mx-4 border-t border-pd-line bg-pd-elevated px-4 pt-3 backdrop-blur-xl pd-safe-bottom">
                    <InlineError onDismiss={() => setError("")}>{error}</InlineError>
                    {bookingStep < 4 ? (
                        <Button className={`w-full ${error ? "mt-2" : ""}`} onClick={goNext}>
                            {bookingStep === 3 ? t("parcels.reviewBooking") : t("parcels.continue")} <ChevronRight size={18} />
                        </Button>
                    ) : (
                        <Button type="submit" className={`w-full ${error ? "mt-2" : ""}`} disabled={submitting}>
                            {submitting ? t("parcels.requesting") : <>{t("parcels.requestDelivery")} <Check size={18} /></>}
                        </Button>
                    )}
                </div>
            </form>
        </main>
    );
}

function StepDots({ step }) {
    return (
        <div className="mt-3 flex justify-center gap-1.5" aria-label={`Step ${step} of 4`}>
            {[1, 2, 3, 4].map((s) => (
                <span key={s} className={`h-1.5 rounded-full transition-all ${s === step ? "w-5 bg-pd-text" : "w-1.5 bg-pd-line-strong"}`} />
            ))}
        </div>
    );
}

function Card({ title, hint, action, children }) {
    return (
        <section className="pd-rise space-y-3 rounded-3xl border border-pd-line bg-pd-surface p-4">
            <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-extrabold">
                    {title}
                    {hint && <span className="ml-2 text-xs font-medium text-pd-muted">{hint}</span>}
                </h2>
                {action}
            </div>
            {children}
        </section>
    );
}

function Field({ label, error, children }) {
    return (
        <div>
            <label className="mb-1.5 block text-xs font-bold text-pd-text-2">
                {label}
            </label>
            {children}
            {error && <p className="mt-1 text-xs font-semibold text-pd-danger">{error}</p>}
        </div>
    );
}

function ReviewRow({ label, value }) {
    return (
        <div className="flex gap-3 text-sm">
            <span className="w-24 shrink-0 text-pd-muted">{label}</span>
            <span className="min-w-0 flex-1 break-words font-semibold">{value}</span>
        </div>
    );
}

function EditLink({ onClick }) {
    return (
        <button type="button" onClick={onClick} className="-my-2 min-h-10 px-2 text-xs font-bold text-pd-accent-text underline-offset-2 hover:underline">
            Edit
        </button>
    );
}
