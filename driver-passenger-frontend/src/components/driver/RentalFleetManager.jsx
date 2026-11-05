"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    Camera,
    CalendarDays,
    CarFront,
    CheckCircle2,
    ChevronDown,
    CircleAlert,
    FileCheck2,
    LocateFixed,
    Pause,
    Pencil,
    Play,
    Plus,
    Trash2,
    X,
} from "lucide-react";

import { uploadOrderImage } from "@/lib/orderChatService";
import {
    acceptRentalAgreement,
    createRentalVehicle,
    deleteRentalVehicle,
    getMyRentalVehicles,
    getRentalAgreement,
    setRentalVehicleActive,
    setRentalVehicleBlockedDates,
    updateRentalVehicle,
} from "@/lib/rentalService";

// Rental Partner fleet management: agreement gate, vehicle listings
// (create / edit / pause / delete), photo groups and the blocked-dates
// availability calendar. Listings start as PENDING moderation — the
// pill on every card says exactly where a listing stands.

const LISTING_META = {
    PENDING: { label: "In moderation", pill: "bg-pd-warning-soft text-pd-warning" },
    APPROVED: { label: "Live", pill: "bg-pd-success-soft text-[#087F5B]" },
    REJECTED: { label: "Rejected", pill: "bg-pd-danger-soft text-pd-danger" },
    SUSPENDED: { label: "Suspended", pill: "bg-pd-danger-soft text-pd-danger" },
};

// Presentation-only steps for the listing form. All fields keep living
// in the single `form` state below — a step only shows or hides its
// group, so switching steps never loses input and validation / payload
// building in saveVehicle are untouched.
const FORM_STEPS = [
    { label: "Vehicle" },
    { label: "Pricing & options" },
    { label: "Photos & publish" },
];

const DRAFT_KEY = "safar:rental-vehicle-draft";

const money = (value) =>
    value == null ? "Not offered" : `PKR ${Number(value).toLocaleString("en-PK")}`;

const EMPTY_FORM = {
    brand: "",
    model: "",
    year: String(new Date().getFullYear()),
    registrationNumber: "",
    transmission: "MANUAL",
    hasAC: true,
    seats: "4",
    rentalModes: ["WITH_DRIVER"],
    hourly: "",
    daily: "",
    weekly: "",
    monthly: "",
    mileageLimitKmPerDay: "",
    extraKmFee: "0",
    overtimeFeePerHour: "0",
    securityDeposit: "0",
    fuelPolicy: "",
    tollsNote: "",
    insuranceNote: "",
    cancellationPolicy: "MODERATE",
    pickupAreaLabel: "",
    exactPickupAddress: "",
    pickupContactName: "",
    pickupContactPhone: "",
    pickupLatitude: "",
    pickupLongitude: "",
    pickupAddress: "",
    photos: { exterior: [], interior: [], condition: [] },
};

function vehicleToForm(vehicle) {
    const coords = vehicle.pickupArea?.coordinates;
    return {
        ...EMPTY_FORM,
        brand: vehicle.brand || "",
        model: vehicle.model || "",
        year: String(vehicle.year || ""),
        registrationNumber: "",
        transmission: vehicle.transmission || "MANUAL",
        hasAC: vehicle.hasAC !== false,
        seats: String(vehicle.seats || 4),
        rentalModes: vehicle.rentalModes?.length
            ? vehicle.rentalModes
            : ["WITH_DRIVER"],
        hourly: vehicle.pricing?.hourly ?? "",
        daily: vehicle.pricing?.daily ?? "",
        weekly: vehicle.pricing?.weekly ?? "",
        monthly: vehicle.pricing?.monthly ?? "",
        mileageLimitKmPerDay: vehicle.mileageLimitKmPerDay ?? "",
        extraKmFee: String(vehicle.extraKmFee ?? 0),
        overtimeFeePerHour: String(vehicle.overtimeFeePerHour ?? 0),
        securityDeposit: String(vehicle.securityDeposit ?? 0),
        fuelPolicy: vehicle.fuelPolicy || "",
        tollsNote: vehicle.tollsNote || "",
        insuranceNote: vehicle.insuranceNote || "",
        cancellationPolicy: vehicle.cancellationPolicy || "MODERATE",
        pickupAreaLabel: vehicle.pickupAreaLabel || "",
        exactPickupAddress: "",
        pickupContactName: "",
        pickupContactPhone: "",
        pickupLatitude: coords ? String(coords[1]) : "",
        pickupLongitude: coords ? String(coords[0]) : "",
        pickupAddress: vehicle.pickupArea?.address || "",
        photos: {
            exterior: vehicle.photos?.exterior || [],
            interior: vehicle.photos?.interior || [],
            condition: vehicle.photos?.condition || [],
        },
    };
}

function formToPayload(form, { isEdit }) {
    const numOrNull = (value) =>
        value === "" || value == null ? null : Number(value);
    const payload = {
        brand: form.brand.trim(),
        model: form.model.trim(),
        year: Number(form.year),
        transmission: form.transmission,
        hasAC: Boolean(form.hasAC),
        seats: Number(form.seats),
        rentalModes: form.rentalModes,
        photos: form.photos,
        pricing: {
            hourly: numOrNull(form.hourly),
            daily: numOrNull(form.daily),
            weekly: numOrNull(form.weekly),
            monthly: numOrNull(form.monthly),
        },
        mileageLimitKmPerDay: numOrNull(form.mileageLimitKmPerDay),
        extraKmFee: Number(form.extraKmFee || 0),
        overtimeFeePerHour: Number(form.overtimeFeePerHour || 0),
        securityDeposit: Number(form.securityDeposit || 0),
        fuelPolicy: form.fuelPolicy.trim(),
        tollsNote: form.tollsNote.trim(),
        insuranceNote: form.insuranceNote.trim(),
        cancellationPolicy: form.cancellationPolicy,
        pickupAreaLabel: form.pickupAreaLabel.trim(),
        pickupArea: {
            latitude: Number(form.pickupLatitude),
            longitude: Number(form.pickupLongitude),
            address: form.pickupAddress.trim(),
        },
    };
    // Registration + exact pickup contact are write-only on the API
    // (never echoed back). On edit they are only sent when re-entered.
    if (!isEdit || form.registrationNumber.trim()) {
        payload.registrationNumber = form.registrationNumber.trim();
    }
    if (!isEdit || form.exactPickupAddress.trim()) {
        payload.exactPickupAddress = form.exactPickupAddress.trim();
    }
    if (!isEdit || form.pickupContactName.trim()) {
        payload.pickupContactName = form.pickupContactName.trim();
    }
    if (!isEdit || form.pickupContactPhone.trim()) {
        payload.pickupContactPhone = form.pickupContactPhone.trim();
    }
    return payload;
}

// ---- Date helpers (blocked dates are plain YYYY-MM-DD strings) ----

const toIso = (date) => date.toLocaleDateString("en-CA");
const todayIso = () => toIso(new Date());

function addDays(isoDate, days) {
    const date = new Date(`${isoDate}T00:00:00`);
    date.setDate(date.getDate() + days);
    return toIso(date);
}

function expandRange(from, to) {
    const dates = [];
    let cursor = from;
    while (cursor <= to && dates.length < 366) {
        dates.push(cursor);
        cursor = addDays(cursor, 1);
    }
    return dates;
}

function groupRanges(dates) {
    const sorted = [...dates].sort();
    const ranges = [];
    for (const date of sorted) {
        const last = ranges[ranges.length - 1];
        if (last && addDays(last.to, 1) === date) last.to = date;
        else ranges.push({ from: date, to: date });
    }
    return ranges;
}

const fmtShort = (isoDate) =>
    new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-PK", {
        day: "numeric",
        month: "short",
    });

const fmtRange = (range) =>
    range.from === range.to
        ? fmtShort(range.from)
        : `${fmtShort(range.from)} – ${fmtShort(range.to)}`;

// What is stopping this listing from taking bookings, in plain words.
function listingHints(vehicle) {
    const hints = [];
    if (vehicle.listingStatus === "REJECTED") {
        hints.push(
            vehicle.rejectionReason
                ? `Rejected: ${vehicle.rejectionReason}. Edit and save to resubmit.`
                : "Rejected by moderation. Edit the listing and save to resubmit."
        );
    } else if (vehicle.listingStatus === "SUSPENDED") {
        hints.push("Suspended by Safar. Contact support to resolve this.");
    } else if (vehicle.listingStatus === "PENDING") {
        hints.push("Safar is checking this listing. It goes live once approved.");
    } else if (!vehicle.isActive) {
        hints.push("Paused — customers cannot see or book this car.");
    }
    if (!vehicle.photos?.exterior?.length) {
        hints.push("Add an exterior photo — listings with photos get booked more.");
    }
    if (
        vehicle.pricing &&
        [
            vehicle.pricing.hourly,
            vehicle.pricing.daily,
            vehicle.pricing.weekly,
            vehicle.pricing.monthly,
        ].every((value) => value == null)
    ) {
        hints.push("Set at least one price.");
    }
    return hints;
}

export default function RentalFleetManager({ token, notify }) {
    const [agreement, setAgreement] = useState(undefined);
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState("");
    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formStep, setFormStep] = useState(0);
    const [form, setForm] = useState(EMPTY_FORM);
    const [fieldErrors, setFieldErrors] = useState({});
    const [draftRestored, setDraftRestored] = useState(false);
    const [blockedDraft, setBlockedDraft] = useState({});
    const [uploadingGroup, setUploadingGroup] = useState("");
    const [confirmDeleteId, setConfirmDeleteId] = useState("");
    const formRef = useRef(null);

    const set = (field, value) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: "" } : prev));
    };

    const load = useCallback(async () => {
        if (!token) return;
        try {
            const [agreementData, fleetData] = await Promise.allSettled([
                getRentalAgreement(token),
                getMyRentalVehicles(token),
            ]);
            if (agreementData.status === "fulfilled") {
                setAgreement(agreementData.value);
            } else {
                setAgreement(null);
            }
            if (fleetData.status === "fulfilled") {
                setVehicles(fleetData.value.vehicles || []);
                setError("");
            } else {
                setError(fleetData.reason?.message || "Unable to load vehicles");
            }
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            const [agreementData, fleetData] = await Promise.allSettled([
                getRentalAgreement(token),
                getMyRentalVehicles(token),
            ]);
            if (cancelled) return;
            setAgreement(
                agreementData.status === "fulfilled" ? agreementData.value : null
            );
            if (fleetData.status === "fulfilled") {
                setVehicles(fleetData.value.vehicles || []);
            } else {
                setError(fleetData.reason?.message || "Unable to load vehicles");
            }
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);

    // A new listing is kept as a draft, so leaving this tab or going
    // back never loses what was already typed.
    useEffect(() => {
        if (!formOpen || editingId) return;
        try {
            sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
        } catch {
            // Storage unavailable (private mode) — the draft simply is not kept.
        }
    }, [form, formOpen, editingId]);

    const agreementAccepted = agreement?.accepted === true;

    function scrollToForm() {
        requestAnimationFrame(() =>
            formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        );
    }

    async function acceptAgreement() {
        setBusy("agreement");
        notify(null);
        try {
            const data = await acceptRentalAgreement(token);
            setAgreement({ ...data, accepted: true });
            notify({
                kind: "success",
                text: "Agreement accepted — you can list vehicles now.",
            });
        } catch (err) {
            notify({ kind: "error", text: err.message });
        } finally {
            setBusy("");
        }
    }

    function openCreate() {
        setEditingId(null);
        let restored = false;
        let nextForm = EMPTY_FORM;
        try {
            const saved = sessionStorage.getItem(DRAFT_KEY);
            if (saved) {
                nextForm = {
                    ...EMPTY_FORM,
                    ...JSON.parse(saved),
                };
                restored = true;
            }
        } catch {
            nextForm = EMPTY_FORM;
        }
        setForm(nextForm);
        setDraftRestored(restored);
        setFieldErrors({});
        setFormStep(0);
        setFormOpen(true);
        scrollToForm();
    }

    function startOver() {
        try {
            sessionStorage.removeItem(DRAFT_KEY);
        } catch {
            // Nothing stored to clear.
        }
        setForm(EMPTY_FORM);
        setDraftRestored(false);
        setFieldErrors({});
        setFormStep(0);
    }

    function openEdit(vehicle) {
        setEditingId(vehicle.id);
        setForm(vehicleToForm(vehicle));
        setDraftRestored(false);
        setFieldErrors({});
        setFormStep(0);
        setFormOpen(true);
        scrollToForm();
    }

    function closeForm() {
        setFormOpen(false);
        setEditingId(null);
        setFormStep(0);
        setFieldErrors({});
    }

    async function uploadPhotos(group, files) {
        if (!files?.length || uploadingGroup) return;
        setUploadingGroup(group);
        notify(null);
        try {
            const urls = [];
            for (const file of files) {
                const result = await uploadOrderImage(file, token);
                if (result?.imageUrl) urls.push(result.imageUrl);
            }
            setForm((prev) => ({
                ...prev,
                photos: {
                    ...prev.photos,
                    [group]: [...prev.photos[group], ...urls].slice(0, 10),
                },
            }));
        } catch (err) {
            notify({ kind: "error", text: err.message });
        } finally {
            setUploadingGroup("");
        }
    }

    function useCurrentLocation() {
        if (!("geolocation" in navigator)) {
            notify({
                kind: "error",
                text: "Location is not available on this device — enter latitude/longitude manually.",
            });
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                set("pickupLatitude", String(pos.coords.latitude));
                set("pickupLongitude", String(pos.coords.longitude));
            },
            () =>
                notify({
                    kind: "error",
                    text: "Could not get your current location.",
                }),
            { enableHighAccuracy: true, timeout: 12000 }
        );
    }

    async function saveVehicle() {
        const errors = {};
        if (!form.brand.trim() || !form.model.trim()) {
            errors.brandModel = "Brand and model are required.";
        }
        if (!editingId && !form.registrationNumber.trim()) {
            errors.registrationNumber = "Registration number is required.";
        }
        if (
            !Number.isFinite(Number(form.pickupLatitude)) ||
            !Number.isFinite(Number(form.pickupLongitude))
        ) {
            errors.pickup =
                "Pickup area needs a latitude and longitude — use the current-location button.";
        }
        if (
            [form.hourly, form.daily, form.weekly, form.monthly].every(
                (v) => v === "" || v == null
            )
        ) {
            errors.pricing =
                "Set at least one price (hourly, daily, weekly or monthly).";
        }
        const firstError =
            errors.brandModel ||
            errors.registrationNumber ||
            errors.pickup ||
            errors.pricing;
        if (firstError) {
            setFieldErrors(errors);
            // Take the driver straight to the step that needs fixing.
            if (errors.brandModel || errors.registrationNumber) setFormStep(0);
            else if (errors.pricing) setFormStep(1);
            else setFormStep(2);
            notify({ kind: "error", text: firstError });
            return;
        }
        setFieldErrors({});
        setBusy("save");
        notify(null);
        try {
            const payload = formToPayload(form, { isEdit: Boolean(editingId) });
            if (editingId) {
                await updateRentalVehicle(editingId, payload, token);
                notify({
                    kind: "success",
                    text: "Vehicle updated — edits go back through moderation before the listing is live again.",
                });
            } else {
                await createRentalVehicle(payload, token);
                try {
                    sessionStorage.removeItem(DRAFT_KEY);
                } catch {
                    // Nothing stored to clear.
                }
                notify({
                    kind: "success",
                    text: "Vehicle listed — it is now in moderation.",
                });
            }
            closeForm();
            void load();
        } catch (err) {
            notify({ kind: "error", text: err.message });
        } finally {
            setBusy("");
        }
    }

    async function toggleActive(vehicle) {
        setBusy(`active:${vehicle.id}`);
        notify(null);
        try {
            const data = await setRentalVehicleActive(
                vehicle.id,
                !vehicle.isActive,
                token
            );
            setVehicles((prev) =>
                prev.map((v) => (v.id === vehicle.id ? data.vehicle : v))
            );
        } catch (err) {
            notify({ kind: "error", text: err.message });
        } finally {
            setBusy("");
        }
    }

    async function saveBlockedDates(vehicle) {
        const dates = blockedDraft[vehicle.id] ?? vehicle.blockedDates ?? [];
        setBusy(`blocked:${vehicle.id}`);
        notify(null);
        try {
            const data = await setRentalVehicleBlockedDates(
                vehicle.id,
                dates,
                token
            );
            setVehicles((prev) =>
                prev.map((v) => (v.id === vehicle.id ? data.vehicle : v))
            );
            setBlockedDraft((prev) => {
                const next = { ...prev };
                delete next[vehicle.id];
                return next;
            });
            notify({ kind: "success", text: "Availability calendar saved." });
        } catch (err) {
            notify({ kind: "error", text: err.message });
        } finally {
            setBusy("");
        }
    }

    async function removeVehicle(vehicle) {
        setBusy(`delete:${vehicle.id}`);
        notify(null);
        try {
            await deleteRentalVehicle(vehicle.id, token);
            setVehicles((prev) => prev.filter((v) => v.id !== vehicle.id));
            setConfirmDeleteId("");
            notify({ kind: "success", text: "Vehicle listing deleted." });
        } catch (err) {
            notify({ kind: "error", text: err.message });
        } finally {
            setBusy("");
        }
    }

    if (loading) {
        return (
            <div
                className="h-56 animate-pulse rounded-[24px] bg-pd-surface shadow-sm"
                aria-busy="true"
            />
        );
    }

    const liveCount = vehicles.filter(
        (v) => v.listingStatus === "APPROVED" && v.isActive
    ).length;
    const reviewCount = vehicles.filter(
        (v) => v.listingStatus === "PENDING"
    ).length;
    const pausedCount = vehicles.filter(
        (v) => v.listingStatus === "APPROVED" && !v.isActive
    ).length;

    return (
        <div className="space-y-5">
            {agreement !== undefined && !agreementAccepted && (
                <section className="rounded-[24px] bg-pd-warning-soft p-5 shadow-sm">
                    <h3 className="flex items-center gap-2 text-base font-extrabold text-pd-warning">
                        <FileCheck2 size={19} /> Rental Partner Agreement
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-pd-warning">
                        Before listing vehicles, accept the Safar Rentals
                        partner agreement: bookings are completed inside Safar,
                        the platform booking fee is collected by Safar at
                        confirmation, the security deposit is refundable to the
                        customer, and taking a Safar booking offline is a
                        policy violation.
                    </p>
                    <button
                        type="button"
                        disabled={busy === "agreement"}
                        onClick={() => void acceptAgreement()}
                        className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#087F5B] text-base font-bold text-white disabled:opacity-40"
                    >
                        <CheckCircle2 size={18} />
                        {busy === "agreement"
                            ? "Please wait…"
                            : "I accept the agreement"}
                    </button>
                </section>
            )}

            {error && (
                <p
                    role="alert"
                    className="flex items-start gap-2 rounded-xl bg-pd-danger-soft p-4 text-sm font-semibold text-pd-danger"
                >
                    <CircleAlert size={17} className="mt-0.5 shrink-0" />
                    {error}
                </p>
            )}

            {formOpen && (
                <div ref={formRef} className="scroll-mt-4">
                    <VehicleForm
                        form={form}
                        set={set}
                        setForm={setForm}
                        editingId={editingId}
                        formStep={formStep}
                        setFormStep={setFormStep}
                        fieldErrors={fieldErrors}
                        draftRestored={draftRestored}
                        onStartOver={startOver}
                        onClose={closeForm}
                        onSave={() => void saveVehicle()}
                        saving={busy === "save"}
                        uploadingGroup={uploadingGroup}
                        onUploadPhotos={(group, files) =>
                            void uploadPhotos(group, files)
                        }
                        onUseLocation={useCurrentLocation}
                    />
                </div>
            )}

            <section>
                <div className="flex items-center justify-between gap-3 px-1">
                    <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                        <CarFront size={14} /> My vehicles ({vehicles.length})
                    </h3>
                    {!formOpen && (
                        <button
                            type="button"
                            disabled={!agreementAccepted}
                            onClick={openCreate}
                            className="inline-flex h-12 items-center gap-1.5 rounded-2xl bg-[#087F5B] px-4 text-sm font-extrabold text-white disabled:opacity-40"
                        >
                            <Plus size={16} /> Add vehicle
                        </button>
                    )}
                </div>
                {!agreementAccepted && (
                    <p className="mt-2 px-1 text-xs font-semibold text-pd-faint">
                        Accept the agreement above to list vehicles.
                    </p>
                )}

                {vehicles.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                        {[
                            { label: "Live", value: liveCount, tone: "text-[#087F5B]" },
                            { label: "In moderation", value: reviewCount, tone: "text-pd-warning" },
                            { label: "Paused", value: pausedCount, tone: "text-pd-muted" },
                        ].map((stat) => (
                            <div
                                key={stat.label}
                                className="rounded-2xl bg-pd-surface p-3 text-center shadow-sm"
                            >
                                <p className={`text-xl font-extrabold ${stat.tone}`}>
                                    {stat.value}
                                </p>
                                <p className="text-[11px] font-bold text-pd-muted">
                                    {stat.label}
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                <div className="mt-3 space-y-3">
                    {vehicles.length === 0 && !formOpen && (
                        <div className="rounded-[24px] bg-pd-surface p-6 text-center shadow-sm">
                            <CarFront size={30} className="mx-auto text-[#087F5B]" />
                            <p className="mt-2 text-sm font-bold">
                                No vehicles listed yet
                            </p>
                            <p className="mt-1 text-xs text-pd-muted">
                                Add your first car — listings pass a quick
                                moderation check before they go live.
                            </p>
                            {agreementAccepted && (
                                <button
                                    type="button"
                                    onClick={openCreate}
                                    className="mt-4 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#087F5B] text-base font-bold text-white"
                                >
                                    <Plus size={18} /> List my first car
                                </button>
                            )}
                        </div>
                    )}

                    {vehicles.map((vehicle) => {
                        const meta =
                            LISTING_META[vehicle.listingStatus] ||
                            LISTING_META.PENDING;
                        const cover =
                            vehicle.photos?.exterior?.[0] ||
                            vehicle.photos?.condition?.[0];
                        const blocked =
                            blockedDraft[vehicle.id] ?? vehicle.blockedDates ?? [];
                        const blockedDirty =
                            JSON.stringify(blocked) !==
                            JSON.stringify(vehicle.blockedDates ?? []);
                        const hints = listingHints(vehicle);
                        const canPause = vehicle.listingStatus === "APPROVED";
                        return (
                            <article
                                key={vehicle.id}
                                className="overflow-hidden rounded-[24px] bg-pd-surface shadow-sm"
                            >
                                <div className="flex gap-3 p-4">
                                    {cover ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={cover}
                                            alt={`${vehicle.brand} ${vehicle.model}`}
                                            className="h-20 w-24 shrink-0 rounded-2xl object-cover"
                                        />
                                    ) : (
                                        <span className="flex h-20 w-24 shrink-0 items-center justify-center rounded-2xl bg-pd-success-soft text-[#087F5B]">
                                            <CarFront size={28} />
                                        </span>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-extrabold">
                                                {vehicle.brand} {vehicle.model} ·{" "}
                                                {vehicle.year}
                                            </p>
                                            <span
                                                className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${meta.pill}`}
                                            >
                                                {meta.label}
                                            </span>
                                        </div>
                                        <p className="mt-0.5 text-xs font-semibold text-pd-muted">
                                            {vehicle.transmission === "AUTOMATIC"
                                                ? "Automatic"
                                                : "Manual"}{" "}
                                            · {vehicle.seats} seats
                                            {vehicle.hasAC ? " · AC" : ""} ·{" "}
                                            {(vehicle.rentalModes || [])
                                                .map((m) =>
                                                    m === "WITH_DRIVER"
                                                        ? "With Driver"
                                                        : "Self-Drive"
                                                )
                                                .join(", ")}
                                        </p>
                                        <p className="mt-1 text-xs font-bold text-[#087F5B]">
                                            {[
                                                vehicle.pricing?.daily != null &&
                                                    `${money(vehicle.pricing.daily)}/day`,
                                                vehicle.pricing?.hourly != null &&
                                                    `${money(vehicle.pricing.hourly)}/hr`,
                                                vehicle.pricing?.weekly != null &&
                                                    `${money(vehicle.pricing.weekly)}/week`,
                                                vehicle.pricing?.monthly != null &&
                                                    `${money(vehicle.pricing.monthly)}/month`,
                                            ]
                                                .filter(Boolean)
                                                .join(" · ") || "No pricing set"}
                                        </p>
                                        <p className="mt-0.5 text-[11px] font-semibold text-pd-faint">
                                            Deposit {money(vehicle.securityDeposit)}
                                            {vehicle.pickupAreaLabel
                                                ? ` · Pickup: ${vehicle.pickupAreaLabel}`
                                                : ""}
                                        </p>
                                    </div>
                                </div>

                                {hints.length > 0 && (
                                    <ul className="mx-4 mb-3 space-y-1 rounded-xl bg-pd-surface-2 p-3">
                                        {hints.map((hint) => (
                                            <li
                                                key={hint}
                                                className="flex items-start gap-2 text-xs font-semibold text-pd-text-2"
                                            >
                                                <CircleAlert
                                                    size={13}
                                                    className="mt-0.5 shrink-0 text-pd-warning"
                                                />
                                                {hint}
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                <div className="flex items-center gap-3 border-t border-pd-line px-4 py-3">
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-extrabold">
                                            {vehicle.isActive
                                                ? "Accepting bookings"
                                                : "Paused"}
                                        </span>
                                        <span className="block text-[11px] text-pd-muted">
                                            {canPause
                                                ? vehicle.isActive
                                                    ? "Tap to pause this car"
                                                    : "Tap to start taking bookings"
                                                : "Available once the listing is live"}
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={vehicle.isActive}
                                        aria-label={`Toggle bookings for ${vehicle.brand} ${vehicle.model}`}
                                        disabled={busy === `active:${vehicle.id}`}
                                        onClick={() => void toggleActive(vehicle)}
                                        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                                            vehicle.isActive
                                                ? "bg-[#087F5B]"
                                                : "bg-pd-surface-3"
                                        }`}
                                    >
                                        <span
                                            className={`absolute top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-pd-muted shadow transition-all ${
                                                vehicle.isActive
                                                    ? "left-[30px]"
                                                    : "left-1"
                                            }`}
                                        >
                                            {vehicle.isActive ? (
                                                <Play size={11} className="text-[#087F5B]" />
                                            ) : (
                                                <Pause size={11} />
                                            )}
                                        </span>
                                    </button>
                                </div>

                                <div className="flex items-center gap-2 border-t border-pd-line px-4 py-3">
                                    <button
                                        type="button"
                                        onClick={() => openEdit(vehicle)}
                                        className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-pd-surface-3 text-sm font-extrabold text-pd-text-2"
                                    >
                                        <Pencil size={15} /> Edit
                                    </button>
                                    {confirmDeleteId === vehicle.id ? (
                                        <>
                                            <button
                                                type="button"
                                                disabled={busy === `delete:${vehicle.id}`}
                                                onClick={() => void removeVehicle(vehicle)}
                                                className="inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-pd-danger text-sm font-extrabold text-white disabled:opacity-40"
                                            >
                                                Confirm delete
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setConfirmDeleteId("")}
                                                className="inline-flex h-12 items-center rounded-xl bg-pd-surface-3 px-4 text-sm font-extrabold text-pd-text-2"
                                            >
                                                Keep
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDeleteId(vehicle.id)}
                                            className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-pd-danger-soft text-sm font-extrabold text-pd-danger"
                                        >
                                            <Trash2 size={15} /> Delete
                                        </button>
                                    )}
                                </div>

                                <BlockedDates
                                    blocked={blocked}
                                    dirty={blockedDirty}
                                    saving={busy === `blocked:${vehicle.id}`}
                                    onChange={(dates) =>
                                        setBlockedDraft((prev) => ({
                                            ...prev,
                                            [vehicle.id]: dates,
                                        }))
                                    }
                                    onSave={() => void saveBlockedDates(vehicle)}
                                />
                            </article>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}

// Blocked dates: one tap for the common cases, a from/to range for the
// rest — and each blocked range is removed with a single tap.
function BlockedDates({ blocked, dirty, saving, onChange, onSave }) {
    const [open, setOpen] = useState(false);
    const [from, setFrom] = useState(todayIso);
    const [to, setTo] = useState(todayIso);
    const ranges = groupRanges(blocked);
    const expanded = open || dirty;

    function block(dates) {
        onChange([...new Set([...blocked, ...dates])].sort());
    }

    function blockWeekend() {
        const date = new Date();
        const untilSaturday = (6 - date.getDay() + 7) % 7;
        const saturday = addDays(todayIso(), untilSaturday);
        block([saturday, addDays(saturday, 1)]);
    }

    function blockRange() {
        const start = from <= to ? from : to;
        const end = from <= to ? to : from;
        block(expandRange(start, end));
    }

    return (
        <div className="border-t border-pd-line">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={expanded}
                className="flex min-h-14 w-full items-center gap-2 px-4 text-left"
            >
                <CalendarDays size={16} className="shrink-0 text-[#087F5B]" />
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold">
                        Blocked dates — vehicle unavailable
                    </span>
                    <span className="block truncate text-[11px] text-pd-muted">
                        {ranges.length === 0
                            ? "None — available every day."
                            : ranges.map(fmtRange).join(" · ")}
                    </span>
                </span>
                <ChevronDown
                    size={17}
                    className={`shrink-0 text-pd-faint transition-transform ${expanded ? "rotate-180" : ""}`}
                />
            </button>

            {expanded && (
                <div className="px-4 pb-4">
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => block([todayIso()])}
                            className="h-11 rounded-full bg-pd-surface-3 px-4 text-xs font-extrabold text-pd-text-2"
                        >
                            Today
                        </button>
                        <button
                            type="button"
                            onClick={blockWeekend}
                            className="h-11 rounded-full bg-pd-surface-3 px-4 text-xs font-extrabold text-pd-text-2"
                        >
                            This weekend
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                block(expandRange(todayIso(), addDays(todayIso(), 6)))
                            }
                            className="h-11 rounded-full bg-pd-surface-3 px-4 text-xs font-extrabold text-pd-text-2"
                        >
                            Next 7 days
                        </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <label className="block">
                            <span className="text-xs font-semibold text-pd-muted">
                                From
                            </span>
                            <input
                                type="date"
                                dir="ltr"
                                min={todayIso()}
                                value={from}
                                onChange={(e) => {
                                    setFrom(e.target.value);
                                    if (e.target.value > to) setTo(e.target.value);
                                }}
                                className="mt-1 h-12 w-full rounded-xl border px-3 text-sm font-semibold"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-semibold text-pd-muted">
                                To
                            </span>
                            <input
                                type="date"
                                dir="ltr"
                                min={from}
                                value={to}
                                onChange={(e) => setTo(e.target.value)}
                                className="mt-1 h-12 w-full rounded-xl border px-3 text-sm font-semibold"
                            />
                        </label>
                    </div>
                    <button
                        type="button"
                        disabled={!from || !to}
                        onClick={blockRange}
                        className="mt-2 h-12 w-full rounded-xl bg-pd-surface-3 text-sm font-extrabold text-pd-text-2 disabled:opacity-40"
                    >
                        Block {from === to ? "this date" : "these dates"}
                    </button>

                    {ranges.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {ranges.map((range) => (
                                <span
                                    key={range.from}
                                    className="inline-flex h-10 items-center gap-1.5 rounded-full bg-pd-surface-3 pl-3.5 pr-2 text-xs font-bold text-pd-text-2"
                                >
                                    {fmtRange(range)}
                                    <button
                                        type="button"
                                        aria-label={`Unblock ${fmtRange(range)}`}
                                        onClick={() =>
                                            onChange(
                                                blocked.filter(
                                                    (date) =>
                                                        date < range.from ||
                                                        date > range.to
                                                )
                                            )
                                        }
                                        className="flex h-7 w-7 items-center justify-center rounded-full text-pd-faint"
                                    >
                                        <X size={13} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}

                    {dirty && (
                        <button
                            type="button"
                            disabled={saving}
                            onClick={onSave}
                            className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#087F5B] text-base font-bold text-white disabled:opacity-40"
                        >
                            <CheckCircle2 size={18} />
                            {saving ? "Saving…" : "Save availability"}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

const PRICE_UNITS = [
    { field: "hourly", label: "Per hour", unit: "hour", placeholder: "Not offered" },
    { field: "daily", label: "Per day", unit: "day", placeholder: "e.g. 8000" },
    { field: "weekly", label: "Per week", unit: "week", placeholder: "Not offered" },
    { field: "monthly", label: "Per month", unit: "month", placeholder: "Not offered" },
];

function VehicleForm({
    form,
    set,
    setForm,
    editingId,
    formStep,
    setFormStep,
    fieldErrors,
    draftRestored,
    onStartOver,
    onClose,
    onSave,
    saving,
    uploadingGroup,
    onUploadPhotos,
    onUseLocation,
}) {
    const hasLocation =
        form.pickupLatitude !== "" && form.pickupLongitude !== "";
    const dailyNumber = Number(form.daily);
    const weeklyNumber = Number(form.weekly);
    const weeklySaving =
        form.daily !== "" &&
        form.weekly !== "" &&
        dailyNumber > 0 &&
        weeklyNumber > 0
            ? Math.round((1 - weeklyNumber / (dailyNumber * 7)) * 100)
            : null;
    const photoCount =
        form.photos.exterior.length +
        form.photos.interior.length +
        form.photos.condition.length;

    return (
        <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-extrabold">
                    {editingId ? "Edit vehicle" : "Add a vehicle"}
                </h3>
                <button
                    type="button"
                    aria-label="Close vehicle form"
                    onClick={onClose}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-pd-surface-3 text-pd-text-2"
                >
                    <X size={18} />
                </button>
            </div>
            {editingId && (
                <p className="mt-2 rounded-xl bg-pd-warning-soft p-3 text-xs leading-5 font-semibold text-pd-warning">
                    Saving an edit sends the listing back through
                    moderation. Registration number and pickup contact
                    are never shown back — re-enter them only if they
                    changed.
                </p>
            )}
            {draftRestored && !editingId && (
                <p className="mt-2 flex items-center gap-2 rounded-xl bg-pd-success-soft p-3 text-xs font-semibold text-[#087F5B]">
                    <CheckCircle2 size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                        We kept what you entered last time.
                    </span>
                    <button
                        type="button"
                        onClick={onStartOver}
                        className="shrink-0 font-extrabold underline"
                    >
                        Start over
                    </button>
                </p>
            )}

            <ol
                className="mt-4 grid grid-cols-3 gap-2"
                aria-label="Vehicle listing steps"
            >
                {FORM_STEPS.map((step, index) => (
                    <li
                        key={step.label}
                        aria-current={formStep === index ? "step" : undefined}
                    >
                        <button
                            type="button"
                            onClick={() => setFormStep(index)}
                            className="block w-full text-left"
                        >
                            <span
                                className={`block h-1.5 rounded-full ${
                                    index <= formStep
                                        ? "bg-[#087F5B]"
                                        : "bg-pd-surface-3"
                                }`}
                            />
                            <span
                                className={`mt-1.5 block text-[11px] font-extrabold ${
                                    index === formStep ? "" : "text-pd-muted"
                                }`}
                            >
                                {index + 1}. {step.label}
                            </span>
                        </button>
                    </li>
                ))}
            </ol>

            <div className="mt-4 space-y-4">
                {formStep === 0 && (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <TextField label="Brand *" value={form.brand} onChange={(v) => set("brand", v)} placeholder="Toyota" error={fieldErrors.brandModel && !form.brand.trim() ? "Required" : ""} />
                            <TextField label="Model *" value={form.model} onChange={(v) => set("model", v)} placeholder="Corolla" error={fieldErrors.brandModel && !form.model.trim() ? "Required" : ""} />
                            <TextField label="Year *" type="number" inputMode="numeric" value={form.year} onChange={(v) => set("year", v)} placeholder="2021" />
                            <TextField
                                label={editingId ? "Registration no. (if changed)" : "Registration no. *"}
                                value={form.registrationNumber}
                                onChange={(v) => set("registrationNumber", v)}
                                placeholder="LEA-21-1234"
                                error={fieldErrors.registrationNumber}
                            />
                        </div>

                        <div>
                            <p className="text-xs font-semibold text-pd-muted">
                                Transmission
                            </p>
                            <Segmented
                                value={form.transmission}
                                onChange={(v) => set("transmission", v)}
                                options={[
                                    { value: "MANUAL", label: "Manual" },
                                    { value: "AUTOMATIC", label: "Automatic" },
                                ]}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <TextField label="Seats" type="number" inputMode="numeric" value={form.seats} onChange={(v) => set("seats", v)} placeholder="4" />
                            <div>
                                <p className="text-xs font-semibold text-pd-muted">
                                    Air conditioning
                                </p>
                                <Segmented
                                    value={form.hasAC ? "yes" : "no"}
                                    onChange={(v) => set("hasAC", v === "yes")}
                                    options={[
                                        { value: "yes", label: "Yes" },
                                        { value: "no", label: "No" },
                                    ]}
                                />
                            </div>
                        </div>

                        <div>
                            <p className="text-xs font-semibold text-pd-muted">
                                How can it be rented?
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-2">
                                {[
                                    { value: "WITH_DRIVER", label: "With Driver" },
                                    { value: "SELF_DRIVE", label: "Self-Drive" },
                                ].map((mode) => {
                                    const active = form.rentalModes.includes(mode.value);
                                    return (
                                        <button
                                            key={mode.value}
                                            type="button"
                                            aria-pressed={active}
                                            onClick={() =>
                                                set(
                                                    "rentalModes",
                                                    active
                                                        ? form.rentalModes.filter(
                                                              (m) => m !== mode.value
                                                          )
                                                        : [...form.rentalModes, mode.value]
                                                )
                                            }
                                            className={`h-12 rounded-full px-5 text-sm font-extrabold ${
                                                active
                                                    ? "bg-[#087F5B] text-white"
                                                    : "bg-pd-surface-3 text-pd-text-2"
                                            }`}
                                        >
                                            {mode.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}

                {formStep === 1 && (
                    <>
                        <div>
                            <p className="text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                                Pricing (PKR) — blank = not offered
                            </p>
                            <p className="mt-1 text-xs leading-5 text-pd-muted">
                                Set at least one rate. Safar&apos;s booking
                                fee is collected separately — the price you
                                enter is what you earn.
                            </p>
                            <div className="mt-3 space-y-2">
                                {PRICE_UNITS.map((unit) => {
                                    const value = form[unit.field];
                                    return (
                                        <div
                                            key={unit.field}
                                            className="rounded-2xl bg-pd-surface-2 p-3"
                                        >
                                            <TextField
                                                label={unit.label}
                                                type="number"
                                                inputMode="numeric"
                                                value={value}
                                                onChange={(v) => set(unit.field, v)}
                                                placeholder={unit.placeholder}
                                            />
                                            {value !== "" && Number(value) > 0 && (
                                                <p className="mt-1.5 text-xs font-bold text-[#087F5B]">
                                                    You earn{" "}
                                                    {money(Number(value))} per{" "}
                                                    {unit.unit}
                                                    {unit.field === "weekly" &&
                                                    weeklySaving !== null &&
                                                    weeklySaving > 0
                                                        ? ` · ${weeklySaving}% less than 7 days at your day rate`
                                                        : ""}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {fieldErrors.pricing && (
                                <FieldError>{fieldErrors.pricing}</FieldError>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <TextField label="Mileage limit km/day" type="number" inputMode="numeric" value={form.mileageLimitKmPerDay} onChange={(v) => set("mileageLimitKmPerDay", v)} placeholder="Unlimited" />
                            <TextField label="Extra km fee (PKR)" type="number" inputMode="numeric" value={form.extraKmFee} onChange={(v) => set("extraKmFee", v)} placeholder="0" />
                            <TextField label="Overtime / hour (PKR)" type="number" inputMode="numeric" value={form.overtimeFeePerHour} onChange={(v) => set("overtimeFeePerHour", v)} placeholder="0" />
                            <TextField label="Security deposit (PKR)" type="number" inputMode="numeric" value={form.securityDeposit} onChange={(v) => set("securityDeposit", v)} placeholder="0" />
                        </div>

                        <div className="space-y-3">
                            <TextField label="Fuel policy" value={form.fuelPolicy} onChange={(v) => set("fuelPolicy", v)} placeholder="e.g. Return with same fuel level" />
                            <TextField label="Tolls note" value={form.tollsNote} onChange={(v) => set("tollsNote", v)} placeholder="e.g. Tolls paid by customer" />
                            <TextField label="Insurance note" value={form.insuranceNote} onChange={(v) => set("insuranceNote", v)} placeholder="Insurance details (optional)" />
                            <div>
                                <p className="text-xs font-semibold text-pd-muted">
                                    Cancellation policy
                                </p>
                                <Segmented
                                    value={form.cancellationPolicy}
                                    onChange={(v) => set("cancellationPolicy", v)}
                                    options={[
                                        { value: "FLEXIBLE", label: "Flexible" },
                                        { value: "MODERATE", label: "Moderate" },
                                        { value: "STRICT", label: "Strict" },
                                    ]}
                                />
                            </div>
                        </div>
                    </>
                )}

                {formStep === 2 && (
                    <>
                        {[
                            ["exterior", "Exterior photos", "Front, back and sides"],
                            ["interior", "Interior photos", "Seats and dashboard"],
                            ["condition", "Condition photos", "Any scratches or dents"],
                        ].map(([group, label, hint]) => (
                            <div key={group}>
                                <p className="text-sm font-extrabold">{label}</p>
                                <p className="text-xs text-pd-muted">
                                    {hint} · {form.photos[group].length}/10
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {form.photos[group].map((url) => (
                                        <span key={url} className="relative">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={url}
                                                alt={label}
                                                className="h-16 w-16 rounded-xl object-cover"
                                            />
                                            <button
                                                type="button"
                                                aria-label="Remove photo"
                                                onClick={() =>
                                                    setForm((prev) => ({
                                                        ...prev,
                                                        photos: {
                                                            ...prev.photos,
                                                            [group]: prev.photos[group].filter(
                                                                (u) => u !== url
                                                            ),
                                                        },
                                                    }))
                                                }
                                                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-pd-ink text-pd-ink-text"
                                            >
                                                <X size={13} />
                                            </button>
                                        </span>
                                    ))}
                                    <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-pd-line bg-pd-success-soft/40 text-[#087F5B]">
                                        <Camera size={22} />
                                        <span className="sr-only">Add {label}</span>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => {
                                                onUploadPhotos(group, e.target.files);
                                                e.target.value = "";
                                            }}
                                        />
                                    </label>
                                </div>
                                {uploadingGroup === group && (
                                    <p className="mt-1 text-[11px] font-semibold text-pd-faint">
                                        Uploading…
                                    </p>
                                )}
                            </div>
                        ))}

                        <div className="space-y-3 rounded-2xl bg-pd-surface-2 p-4">
                            <p className="text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                                Pickup area
                            </p>
                            <button
                                type="button"
                                onClick={onUseLocation}
                                className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-extrabold ${
                                    hasLocation
                                        ? "bg-pd-success-soft text-[#087F5B]"
                                        : "bg-[#087F5B] text-white"
                                }`}
                            >
                                {hasLocation ? (
                                    <CheckCircle2 size={18} />
                                ) : (
                                    <LocateFixed size={18} />
                                )}
                                {hasLocation
                                    ? "Location set — tap to update"
                                    : "Use my current location"}
                            </button>
                            {fieldErrors.pickup && (
                                <FieldError>{fieldErrors.pickup}</FieldError>
                            )}
                            <TextField label="Area label" value={form.pickupAreaLabel} onChange={(v) => set("pickupAreaLabel", v)} placeholder="e.g. Model Town, Khanpur" />
                            <TextField label="Area address" value={form.pickupAddress} onChange={(v) => set("pickupAddress", v)} placeholder="Neighbourhood-level address shown to customers" />
                            <details className="rounded-xl bg-pd-surface p-3">
                                <summary className="cursor-pointer text-xs font-extrabold text-pd-text-2">
                                    Enter coordinates manually
                                </summary>
                                <div className="mt-3 grid grid-cols-2 gap-3">
                                    <TextField label="Latitude *" type="number" inputMode="decimal" value={form.pickupLatitude} onChange={(v) => set("pickupLatitude", v)} placeholder="28.64" />
                                    <TextField label="Longitude *" type="number" inputMode="decimal" value={form.pickupLongitude} onChange={(v) => set("pickupLongitude", v)} placeholder="70.66" />
                                </div>
                            </details>
                            <TextField label="Exact pickup address (hidden until confirmed)" value={form.exactPickupAddress} onChange={(v) => set("exactPickupAddress", v)} placeholder="House / street — shared only after confirmation" />
                            <div className="grid grid-cols-2 gap-3">
                                <TextField label="Pickup contact name" value={form.pickupContactName} onChange={(v) => set("pickupContactName", v)} placeholder="Contact person" />
                                <TextField label="Pickup contact phone" type="tel" inputMode="tel" value={form.pickupContactPhone} onChange={(v) => set("pickupContactPhone", v)} placeholder="03xx-xxxxxxx" />
                            </div>
                        </div>

                        <div className="space-y-1.5 rounded-2xl bg-pd-surface-2 p-4">
                            <p className="text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                                Review
                            </p>
                            <p className="text-sm font-extrabold">
                                {form.brand || "Brand"}{" "}
                                {form.model || "Model"} ·{" "}
                                {form.year || "Year"}
                            </p>
                            <p className="text-xs font-semibold text-pd-muted">
                                {form.transmission === "AUTOMATIC"
                                    ? "Automatic"
                                    : "Manual"}{" "}
                                · {form.seats || "—"} seats
                                {form.hasAC ? " · AC" : ""} ·{" "}
                                {form.rentalModes.length
                                    ? form.rentalModes
                                          .map((m) =>
                                              m === "WITH_DRIVER"
                                                  ? "With Driver"
                                                  : "Self-Drive"
                                          )
                                          .join(", ")
                                    : "No rental mode selected"}
                            </p>
                            <p className="text-xs font-bold text-[#087F5B]">
                                {[
                                    form.daily !== "" &&
                                        `${money(Number(form.daily))}/day`,
                                    form.hourly !== "" &&
                                        `${money(Number(form.hourly))}/hr`,
                                    form.weekly !== "" &&
                                        `${money(Number(form.weekly))}/week`,
                                    form.monthly !== "" &&
                                        `${money(Number(form.monthly))}/month`,
                                ]
                                    .filter(Boolean)
                                    .join(" · ") || "No pricing set"}
                            </p>
                            <p className="text-[11px] font-semibold text-pd-faint">
                                Deposit{" "}
                                {money(Number(form.securityDeposit || 0))}
                                {form.pickupAreaLabel
                                    ? ` · Pickup: ${form.pickupAreaLabel}`
                                    : ""}{" "}
                                · Photos: {photoCount}
                            </p>
                        </div>
                    </>
                )}

                <div className="flex gap-2">
                    {formStep > 0 && (
                        <button
                            type="button"
                            onClick={() => setFormStep((step) => Math.max(0, step - 1))}
                            className="flex h-14 items-center justify-center rounded-2xl bg-pd-surface-3 px-6 text-base font-bold text-pd-text-2"
                        >
                            Back
                        </button>
                    )}
                    {formStep < 2 ? (
                        <button
                            type="button"
                            onClick={() => setFormStep((step) => Math.min(2, step + 1))}
                            className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-[#087F5B] text-base font-bold text-white"
                        >
                            Next
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled={saving}
                            onClick={onSave}
                            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#087F5B] text-base font-bold text-white disabled:opacity-40"
                        >
                            <CheckCircle2 size={18} />
                            {saving
                                ? "Saving…"
                                : editingId
                                  ? "Save changes"
                                  : "List this vehicle"}
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
}

function FieldError({ children }) {
    return (
        <p
            role="alert"
            className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-pd-danger"
        >
            <CircleAlert size={13} className="mt-0.5 shrink-0" />
            {children}
        </p>
    );
}

function Segmented({ value, onChange, options }) {
    return (
        <div
            role="radiogroup"
            className="mt-1.5 flex gap-1 rounded-2xl bg-pd-surface-3 p-1"
        >
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={value === option.value}
                    onClick={() => onChange(option.value)}
                    className={`h-11 flex-1 rounded-xl text-sm font-extrabold ${
                        value === option.value
                            ? "bg-[#087F5B] text-white shadow-sm"
                            : "text-pd-text-2"
                    }`}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

function TextField({
    label,
    value,
    onChange,
    placeholder,
    type = "text",
    inputMode,
    error,
}) {
    return (
        <label className="block">
            <span className="text-xs font-semibold text-pd-muted">{label}</span>
            <input
                type={type}
                inputMode={inputMode}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                aria-invalid={error ? true : undefined}
                className={`mt-1 h-12 w-full rounded-xl border px-3 text-sm font-semibold ${
                    error ? "border-pd-danger" : ""
                }`}
            />
            {error && <FieldError>{error}</FieldError>}
        </label>
    );
}
