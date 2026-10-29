"use client";

import { useCallback, useEffect, useState } from "react";
import {
    CalendarDays,
    CarFront,
    CheckCircle2,
    CircleAlert,
    FileCheck2,
    LocateFixed,
    Pencil,
    Plus,
    Camera,
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
    PENDING: { label: "In moderation", pill: "bg-amber-50 text-amber-700" },
    APPROVED: { label: "Live", pill: "bg-emerald-50 text-[#087F5B]" },
    REJECTED: { label: "Rejected", pill: "bg-red-50 text-red-600" },
    SUSPENDED: { label: "Suspended", pill: "bg-red-50 text-red-600" },
};

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

export default function RentalFleetManager({ token, notify }) {
    const [agreement, setAgreement] = useState(undefined);
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState("");
    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [blockedDraft, setBlockedDraft] = useState({});
    const [newBlockedDate, setNewBlockedDate] = useState({});
    const [uploadingGroup, setUploadingGroup] = useState("");
    const [confirmDeleteId, setConfirmDeleteId] = useState("");

    const set = (field, value) =>
        setForm((prev) => ({ ...prev, [field]: value }));

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

    const agreementAccepted = agreement?.accepted === true;

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
        setForm(EMPTY_FORM);
        setFormOpen(true);
    }

    function openEdit(vehicle) {
        setEditingId(vehicle.id);
        setForm(vehicleToForm(vehicle));
        setFormOpen(true);
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
        if (!form.brand.trim() || !form.model.trim()) {
            notify({ kind: "error", text: "Brand and model are required." });
            return;
        }
        if (!editingId && !form.registrationNumber.trim()) {
            notify({
                kind: "error",
                text: "Registration number is required.",
            });
            return;
        }
        if (
            !Number.isFinite(Number(form.pickupLatitude)) ||
            !Number.isFinite(Number(form.pickupLongitude))
        ) {
            notify({
                kind: "error",
                text: "Pickup area needs a latitude and longitude — use the current-location button.",
            });
            return;
        }
        if (
            [form.hourly, form.daily, form.weekly, form.monthly].every(
                (v) => v === "" || v == null
            )
        ) {
            notify({
                kind: "error",
                text: "Set at least one price (hourly, daily, weekly or monthly).",
            });
            return;
        }
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
                notify({
                    kind: "success",
                    text: "Vehicle listed — it is now in moderation.",
                });
            }
            setFormOpen(false);
            setEditingId(null);
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
                className="h-56 animate-pulse rounded-[24px] bg-white shadow-sm"
                aria-busy="true"
            />
        );
    }

    return (
        <div className="space-y-5">
            {agreement !== undefined && !agreementAccepted && (
                <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 shadow-sm">
                    <h3 className="flex items-center gap-2 text-base font-extrabold text-amber-900">
                        <FileCheck2 size={19} /> Rental Partner Agreement
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-amber-800">
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
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
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
                    className="flex items-start gap-2 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-600"
                >
                    <CircleAlert size={17} className="mt-0.5 shrink-0" />
                    {error}
                </p>
            )}

            <section>
                <div className="flex items-center justify-between px-1">
                    <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">
                        <CarFront size={14} /> My vehicles ({vehicles.length})
                    </h3>
                    <button
                        type="button"
                        disabled={!agreementAccepted}
                        onClick={openCreate}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#087F5B] px-3.5 py-2.5 text-xs font-extrabold text-white disabled:opacity-40"
                    >
                        <Plus size={15} /> Add vehicle
                    </button>
                </div>
                {!agreementAccepted && (
                    <p className="mt-2 px-1 text-xs font-semibold text-slate-400">
                        Accept the agreement above to list vehicles.
                    </p>
                )}

                <div className="mt-3 space-y-3">
                    {vehicles.length === 0 && !formOpen && (
                        <div className="rounded-[24px] bg-white p-6 text-center shadow-sm">
                            <CarFront size={30} className="mx-auto text-[#087F5B]" />
                            <p className="mt-2 text-sm font-bold">
                                No vehicles listed yet
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                                Add your first car — listings pass a quick
                                moderation check before they go live.
                            </p>
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
                        return (
                            <article
                                key={vehicle.id}
                                className="overflow-hidden rounded-[24px] bg-white shadow-sm"
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
                                        <span className="flex h-20 w-24 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-[#087F5B]">
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
                                        <p className="mt-0.5 text-xs font-semibold text-slate-500">
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
                                        <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                                            Deposit {money(vehicle.securityDeposit)}
                                            {vehicle.pickupAreaLabel
                                                ? ` · Pickup: ${vehicle.pickupAreaLabel}`
                                                : ""}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
                                    <span className="text-xs font-bold text-slate-600">
                                        {vehicle.isActive
                                            ? "Accepting bookings"
                                            : "Paused"}
                                    </span>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={vehicle.isActive}
                                        aria-label={`Toggle bookings for ${vehicle.brand} ${vehicle.model}`}
                                        disabled={busy === `active:${vehicle.id}`}
                                        onClick={() => void toggleActive(vehicle)}
                                        className={`relative ml-auto h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                                            vehicle.isActive
                                                ? "bg-[#087F5B]"
                                                : "bg-slate-300"
                                        }`}
                                    >
                                        <span
                                            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                                                vehicle.isActive
                                                    ? "left-[22px]"
                                                    : "left-0.5"
                                            }`}
                                        />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => openEdit(vehicle)}
                                        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-xs font-extrabold text-slate-700"
                                    >
                                        <Pencil size={13} /> Edit
                                    </button>
                                    {confirmDeleteId === vehicle.id ? (
                                        <>
                                            <button
                                                type="button"
                                                disabled={busy === `delete:${vehicle.id}`}
                                                onClick={() => void removeVehicle(vehicle)}
                                                className="inline-flex h-9 items-center rounded-xl bg-red-500 px-3 text-xs font-extrabold text-white disabled:opacity-40"
                                            >
                                                Confirm delete
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setConfirmDeleteId("")}
                                                className="inline-flex h-9 items-center rounded-xl bg-slate-100 px-3 text-xs font-extrabold text-slate-600"
                                            >
                                                Keep
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDeleteId(vehicle.id)}
                                            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-red-50 px-3 text-xs font-extrabold text-red-600"
                                        >
                                            <Trash2 size={13} /> Delete
                                        </button>
                                    )}
                                </div>

                                <div className="border-t border-slate-100 px-4 py-3">
                                    <p className="flex items-center gap-1.5 text-xs font-extrabold text-slate-600">
                                        <CalendarDays size={14} className="text-[#087F5B]" />
                                        Blocked dates — vehicle unavailable
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {blocked.length === 0 && (
                                            <span className="text-[11px] font-semibold text-slate-400">
                                                None — available every day.
                                            </span>
                                        )}
                                        {blocked.map((date) => (
                                            <span
                                                key={date}
                                                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700"
                                            >
                                                {date}
                                                <button
                                                    type="button"
                                                    aria-label={`Unblock ${date}`}
                                                    onClick={() =>
                                                        setBlockedDraft((prev) => ({
                                                            ...prev,
                                                            [vehicle.id]: blocked.filter(
                                                                (d) => d !== date
                                                            ),
                                                        }))
                                                    }
                                                    className="text-slate-400"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                    <div className="mt-2 flex gap-2">
                                        <input
                                            type="date"
                                            value={newBlockedDate[vehicle.id] || ""}
                                            onChange={(e) =>
                                                setNewBlockedDate((prev) => ({
                                                    ...prev,
                                                    [vehicle.id]: e.target.value,
                                                }))
                                            }
                                            className="h-10 min-w-0 flex-1 rounded-xl border px-3 text-xs font-semibold"
                                        />
                                        <button
                                            type="button"
                                            disabled={!newBlockedDate[vehicle.id]}
                                            onClick={() => {
                                                const date = newBlockedDate[vehicle.id];
                                                if (!date || blocked.includes(date)) return;
                                                setBlockedDraft((prev) => ({
                                                    ...prev,
                                                    [vehicle.id]: [...blocked, date].sort(),
                                                }));
                                                setNewBlockedDate((prev) => ({
                                                    ...prev,
                                                    [vehicle.id]: "",
                                                }));
                                            }}
                                            className="h-10 shrink-0 rounded-xl bg-slate-100 px-3 text-xs font-extrabold text-slate-700 disabled:opacity-40"
                                        >
                                            Block date
                                        </button>
                                        {blockedDirty && (
                                            <button
                                                type="button"
                                                disabled={busy === `blocked:${vehicle.id}`}
                                                onClick={() => void saveBlockedDates(vehicle)}
                                                className="h-10 shrink-0 rounded-xl bg-[#087F5B] px-3 text-xs font-extrabold text-white disabled:opacity-40"
                                            >
                                                Save
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            </section>

            {formOpen && (
                <section className="rounded-[24px] bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <h3 className="text-base font-extrabold">
                            {editingId ? "Edit vehicle" : "Add a vehicle"}
                        </h3>
                        <button
                            type="button"
                            aria-label="Close vehicle form"
                            onClick={() => {
                                setFormOpen(false);
                                setEditingId(null);
                            }}
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    {editingId && (
                        <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 font-semibold text-amber-800">
                            Saving an edit sends the listing back through
                            moderation. Registration number and pickup contact
                            are never shown back — re-enter them only if they
                            changed.
                        </p>
                    )}

                    <div className="mt-4 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <TextField label="Brand *" value={form.brand} onChange={(v) => set("brand", v)} placeholder="Toyota" />
                            <TextField label="Model *" value={form.model} onChange={(v) => set("model", v)} placeholder="Corolla" />
                            <TextField label="Year *" type="number" value={form.year} onChange={(v) => set("year", v)} placeholder="2021" />
                            <TextField
                                label={editingId ? "Registration no. (if changed)" : "Registration no. *"}
                                value={form.registrationNumber}
                                onChange={(v) => set("registrationNumber", v)}
                                placeholder="LEA-21-1234"
                            />
                            <label className="block">
                                <span className="text-xs font-semibold text-slate-500">Transmission</span>
                                <select
                                    value={form.transmission}
                                    onChange={(e) => set("transmission", e.target.value)}
                                    className="mt-1 h-11 w-full rounded-xl border px-3 text-sm font-semibold"
                                >
                                    <option value="MANUAL">Manual</option>
                                    <option value="AUTOMATIC">Automatic</option>
                                </select>
                            </label>
                            <TextField label="Seats" type="number" value={form.seats} onChange={(v) => set("seats", v)} placeholder="4" />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {[
                                { value: "WITH_DRIVER", label: "With Driver" },
                                { value: "SELF_DRIVE", label: "Self-Drive" },
                            ].map((mode) => {
                                const active = form.rentalModes.includes(mode.value);
                                return (
                                    <button
                                        key={mode.value}
                                        type="button"
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
                                        className={`rounded-full px-3.5 py-2 text-xs font-extrabold ${
                                            active
                                                ? "bg-[#087F5B] text-white"
                                                : "bg-slate-100 text-slate-600"
                                        }`}
                                    >
                                        {mode.label}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                onClick={() => set("hasAC", !form.hasAC)}
                                className={`rounded-full px-3.5 py-2 text-xs font-extrabold ${
                                    form.hasAC
                                        ? "bg-[#087F5B] text-white"
                                        : "bg-slate-100 text-slate-600"
                                }`}
                            >
                                Air conditioning
                            </button>
                        </div>

                        <div>
                            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                                Pricing (PKR) — blank = not offered
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                                <TextField label="Per hour" type="number" value={form.hourly} onChange={(v) => set("hourly", v)} placeholder="Not offered" />
                                <TextField label="Per day" type="number" value={form.daily} onChange={(v) => set("daily", v)} placeholder="e.g. 8000" />
                                <TextField label="Per week" type="number" value={form.weekly} onChange={(v) => set("weekly", v)} placeholder="Not offered" />
                                <TextField label="Per month" type="number" value={form.monthly} onChange={(v) => set("monthly", v)} placeholder="Not offered" />
                                <TextField label="Mileage limit km/day" type="number" value={form.mileageLimitKmPerDay} onChange={(v) => set("mileageLimitKmPerDay", v)} placeholder="Unlimited" />
                                <TextField label="Extra km fee (PKR)" type="number" value={form.extraKmFee} onChange={(v) => set("extraKmFee", v)} placeholder="0" />
                                <TextField label="Overtime / hour (PKR)" type="number" value={form.overtimeFeePerHour} onChange={(v) => set("overtimeFeePerHour", v)} placeholder="0" />
                                <TextField label="Security deposit (PKR)" type="number" value={form.securityDeposit} onChange={(v) => set("securityDeposit", v)} placeholder="0" />
                            </div>
                        </div>

                        {[
                            ["exterior", "Exterior photos"],
                            ["interior", "Interior photos"],
                            ["condition", "Condition photos"],
                        ].map(([group, label]) => (
                            <div key={group}>
                                <p className="text-xs font-semibold text-slate-500">{label}</p>
                                <div className="mt-1.5 flex flex-wrap gap-2">
                                    {form.photos[group].map((url) => (
                                        <span key={url} className="relative">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={url}
                                                alt={label}
                                                className="h-14 w-14 rounded-xl object-cover"
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
                                                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white"
                                            >
                                                <X size={11} />
                                            </button>
                                        </span>
                                    ))}
                                    <label className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 text-[#087F5B]">
                                        <Camera size={18} />
                                        <input
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => {
                                                void uploadPhotos(group, e.target.files);
                                                e.target.value = "";
                                            }}
                                        />
                                    </label>
                                </div>
                                {uploadingGroup === group && (
                                    <p className="mt-1 text-[11px] font-semibold text-slate-400">
                                        Uploading…
                                    </p>
                                )}
                            </div>
                        ))}

                        <div className="space-y-2">
                            <TextField label="Fuel policy" value={form.fuelPolicy} onChange={(v) => set("fuelPolicy", v)} placeholder="e.g. Return with same fuel level" />
                            <TextField label="Tolls note" value={form.tollsNote} onChange={(v) => set("tollsNote", v)} placeholder="e.g. Tolls paid by customer" />
                            <TextField label="Insurance note" value={form.insuranceNote} onChange={(v) => set("insuranceNote", v)} placeholder="Insurance details (optional)" />
                            <label className="block">
                                <span className="text-xs font-semibold text-slate-500">Cancellation policy</span>
                                <select
                                    value={form.cancellationPolicy}
                                    onChange={(e) => set("cancellationPolicy", e.target.value)}
                                    className="mt-1 h-11 w-full rounded-xl border px-3 text-sm font-semibold"
                                >
                                    <option value="FLEXIBLE">Flexible</option>
                                    <option value="MODERATE">Moderate</option>
                                    <option value="STRICT">Strict</option>
                                </select>
                            </label>
                        </div>

                        <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
                            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                                Pickup area
                            </p>
                            <TextField label="Area label" value={form.pickupAreaLabel} onChange={(v) => set("pickupAreaLabel", v)} placeholder="e.g. Model Town, Khanpur" />
                            <TextField label="Area address" value={form.pickupAddress} onChange={(v) => set("pickupAddress", v)} placeholder="Neighbourhood-level address shown to customers" />
                            <div className="grid grid-cols-2 gap-2">
                                <TextField label="Latitude *" type="number" value={form.pickupLatitude} onChange={(v) => set("pickupLatitude", v)} placeholder="28.64" />
                                <TextField label="Longitude *" type="number" value={form.pickupLongitude} onChange={(v) => set("pickupLongitude", v)} placeholder="70.66" />
                            </div>
                            <button
                                type="button"
                                onClick={useCurrentLocation}
                                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-extrabold text-[#087F5B] shadow-sm"
                            >
                                <LocateFixed size={14} /> Use my current location
                            </button>
                            <TextField label="Exact pickup address (hidden until confirmed)" value={form.exactPickupAddress} onChange={(v) => set("exactPickupAddress", v)} placeholder="House / street — shared only after confirmation" />
                            <div className="grid grid-cols-2 gap-2">
                                <TextField label="Pickup contact name" value={form.pickupContactName} onChange={(v) => set("pickupContactName", v)} placeholder="Contact person" />
                                <TextField label="Pickup contact phone" value={form.pickupContactPhone} onChange={(v) => set("pickupContactPhone", v)} placeholder="03xx-xxxxxxx" />
                            </div>
                        </div>

                        <button
                            type="button"
                            disabled={busy === "save"}
                            onClick={() => void saveVehicle()}
                            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                        >
                            <CheckCircle2 size={18} />
                            {busy === "save"
                                ? "Saving…"
                                : editingId
                                  ? "Save changes"
                                  : "List this vehicle"}
                        </button>
                    </div>
                </section>
            )}
        </div>
    );
}

function TextField({ label, value, onChange, placeholder, type = "text" }) {
    return (
        <label className="block">
            <span className="text-xs font-semibold text-slate-500">{label}</span>
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="mt-1 h-11 w-full rounded-xl border px-3 text-sm font-semibold"
            />
        </label>
    );
}
