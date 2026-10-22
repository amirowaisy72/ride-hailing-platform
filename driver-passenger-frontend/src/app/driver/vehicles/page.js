"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft, Plus, CarFront, Bike, CheckCircle2,
    Clock3, XCircle, RefreshCw, ShieldCheck,
    Save, AlertCircle, ArrowRight, Settings2,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";
import { selectVehicle } from "@/lib/vehicleService";

const vehicleTypes = [
    { id: "BIKE", label: "Motorcycle", emoji: "🏍️" },
    { id: "RICKSHAW", label: "Rickshaw", emoji: "🛺" },
    { id: "CAR_NON_AC", label: "Car Non-AC", emoji: "🚗" },
    { id: "CAR_AC", label: "Car AC", emoji: "🚘" },
];

const emptyForm = {
    vehicleType: "BIKE",
    registrationNumber: "",
    make: "",
    model: "",
    color: "",
    modelYear: "",
};

const statusStyles = {
    PENDING: "bg-amber-50 text-amber-700",
    UNDER_REVIEW: "bg-blue-50 text-blue-700",
    APPROVED: "bg-emerald-50 text-[#087F5B]",
    REJECTED: "bg-red-50 text-red-600",
};

export default function DriverVehiclesPage() {
    return (
        <AuthGuard role="DRIVER">
            <VehicleScreen />
        </AuthGuard>
    );
}

function VehicleScreen() {
    const { token } = useAuth();

    const [vehicles, setVehicles] = useState([]);
    const [driver, setDriver] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [showForm, setShowForm] = useState(false);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activating, setActivating] = useState(null);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const loadData = useCallback(async () => {
        if (!token) return;

        setLoading(true);
        setError("");

        try {
            const [vehicleData, driverData] = await Promise.all([
                apiRequest("/drivers/me/vehicles", { token }),
                apiRequest("/drivers/me/status", { token }),
            ]);

            setVehicles(vehicleData.vehicles || []);
            setDriver(driverData.driver || null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    function updateField(field, value) {
        setForm((previous) => ({
            ...previous,
            [field]: value,
        }));
    }

    async function registerVehicle(event) {
        event.preventDefault();

        if (saving) return;

        const registrationNumber = form.registrationNumber
            .trim()
            .toUpperCase();

        if (!/^[A-Z0-9 -]{4,20}$/.test(registrationNumber)) {
            setError("Enter a valid vehicle registration number.");
            return;
        }

        if (
            form.modelYear &&
            (!Number.isSafeInteger(Number(form.modelYear)) ||
                Number(form.modelYear) < 1950 ||
                Number(form.modelYear) > new Date().getFullYear() + 1)
        ) {
            setError("Enter a valid model year.");
            return;
        }

        setSaving(true);
        setError("");
        setMessage("");

        try {
            await apiRequest("/drivers/me/vehicles", {
                method: "POST",
                token,
                body: JSON.stringify({
                    vehicleType: form.vehicleType,
                    registrationNumber,
                    make: form.make.trim(),
                    model: form.model.trim(),
                    color: form.color.trim(),
                    ...(form.modelYear
                        ? { modelYear: Number(form.modelYear) }
                        : {}),
                }),
            });

            setForm({ ...emptyForm });
            setShowForm(false);
            setMessage(
                "Vehicle registered! Waiting for admin approval."
            );

            await loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    async function activateVehicle(vehicle) {
        if (activating || driver?.isOnline) return;

        setActivating(vehicle._id);
        setError("");
        setMessage("");

        try {
            await selectVehicle(vehicle._id, token);
            setMessage("Active vehicle updated successfully.");
            await loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setActivating(null);
        }
    }

    const currentVehicleId =
        typeof driver?.currentVehicleId === "object"
            ? String(driver.currentVehicleId?._id || "")
            : String(driver?.currentVehicleId || "");

    return (
        <main className="driver-subpage min-h-dvh bg-[#F7F9F8] pb-[calc(100px+env(safe-area-inset-bottom))] text-slate-900">
            <MobileBottomNav role="DRIVER" />

            <header className="bg-[#087F5B] px-5 pb-24 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto flex max-w-xl items-center gap-4">
                    <Link
                        href="/driver"
                        aria-label="Back to driver dashboard"
                        className="rounded-xl bg-white/15 p-3"
                    >
                        <ArrowLeft size={20} />
                    </Link>

                    <h1 className="text-lg font-bold">My Vehicles</h1>
                </div>

                <div className="mx-auto mt-8 max-w-xl">
                    <p className="text-sm text-white/70">
                        Driver Fleet Management
                    </p>
                    <h2 className="mt-1 text-3xl font-extrabold">
                        Manage Vehicles
                    </h2>
                </div>
            </header>

            <div className="relative z-10 mx-auto mt-5 max-w-xl space-y-5 px-4">
                <section className="rounded-[26px] bg-white p-5 shadow-lg shadow-slate-900/5">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h3 className="text-xl font-extrabold">
                                Registered Vehicles
                            </h3>
                            <p className="mt-1 text-sm text-slate-500">
                                {vehicles.length} vehicles on your account
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                setShowForm((value) => !value);
                                setError("");
                            }}
                            className="flex items-center gap-2 rounded-xl bg-[#087F5B] px-4 py-3 text-sm font-bold text-white"
                        >
                            <Plus size={18} />
                            Add Vehicle
                        </button>
                    </div>
                </section>

                {error && (
                    <p
                        role="alert"
                        className="rounded-xl bg-red-50 p-4 text-sm text-red-600"
                    >
                        <AlertCircle size={16} className="mr-2 inline" />
                        {error}
                    </p>
                )}

                {message && (
                    <p
                        role="status"
                        className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-[#087F5B]"
                    >
                        <CheckCircle2 size={17} className="mr-2 inline" />
                        {message}
                    </p>
                )}

                {showForm && (
                    <form
                        onSubmit={registerVehicle}
                        className="space-y-5 rounded-[26px] bg-white p-5 shadow-sm"
                    >
                        <h3 className="text-xl font-extrabold">
                            Register New Vehicle
                        </h3>

                        <div>
                            <label className="mb-3 block text-sm font-bold">
                                Vehicle Category
                            </label>

                            <div className="grid grid-cols-2 gap-3">
                                {vehicleTypes.map((type) => (
                                    <button
                                        type="button"
                                        key={type.id}
                                        onClick={() =>
                                            updateField("vehicleType", type.id)
                                        }
                                        className={`rounded-2xl border-2 p-4 text-left ${form.vehicleType === type.id
                                            ? "border-[#087F5B] bg-emerald-50"
                                            : "border-slate-200"
                                            }`}
                                    >
                                        <span className="text-2xl">{type.emoji}</span>
                                        <p className="mt-2 text-sm font-bold">
                                            {type.label}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {[
                            {
                                field: "registrationNumber",
                                label: "Registration Number",
                                placeholder: "ABC-1234",
                                required: true,
                            },
                            {
                                field: "make",
                                label: "Vehicle Make",
                                placeholder: "Honda / Suzuki / Toyota",
                                required: true,
                            },
                            {
                                field: "model",
                                label: "Vehicle Model",
                                placeholder: "CD 70 / Alto / Corolla",
                                required: true,
                            },
                            {
                                field: "color",
                                label: "Vehicle Color",
                                placeholder: "White / Black / Silver",
                                required: true,
                            },
                            {
                                field: "modelYear",
                                label: "Model Year",
                                placeholder: "2024",
                                required: false,
                            },
                        ].map((input) => (
                            <div key={input.field}>
                                <label
                                    htmlFor={input.field}
                                    className="mb-2 block text-sm font-bold"
                                >
                                    {input.label}
                                </label>

                                <input
                                    id={input.field}
                                    type={
                                        input.field === "modelYear"
                                            ? "number"
                                            : "text"
                                    }
                                    required={input.required}
                                    maxLength={
                                        input.field === "registrationNumber"
                                            ? 20
                                            : 80
                                    }
                                    min={
                                        input.field === "modelYear"
                                            ? 1950
                                            : undefined
                                    }
                                    max={
                                        input.field === "modelYear"
                                            ? new Date().getFullYear() + 1
                                            : undefined
                                    }
                                    value={form[input.field]}
                                    onChange={(event) =>
                                        updateField(input.field, event.target.value)
                                    }
                                    placeholder={input.placeholder}
                                    className="h-13 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#087F5B]"
                                />
                            </div>
                        ))}

                        <div className="rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                            <ShieldCheck size={17} className="mb-2" />
                            Vehicle admin approval ke baad hi active ho sakega.
                            Required driver documents ki verification bhi zaroori hai.
                        </div>

                        <button
                            type="submit"
                            disabled={saving}
                            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-50"
                        >
                            <Save size={18} />
                            {saving
                                ? "Registering..."
                                : "Submit for Verification"}
                        </button>
                    </form>
                )}

                <section className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-extrabold">
                            Your Vehicles
                        </h3>

                        <button
                            type="button"
                            onClick={loadData}
                            disabled={loading}
                            className="flex items-center gap-2 text-sm font-bold text-[#087F5B]"
                        >
                            <RefreshCw
                                size={17}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>

                    {loading ? (
                        <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500">
                            Loading vehicles...
                        </div>
                    ) : vehicles.length === 0 ? (
                        <div className="rounded-2xl bg-white p-9 text-center">
                            <CarFront
                                size={38}
                                className="mx-auto text-[#087F5B]"
                            />

                            <p className="mt-4 font-bold">
                                No vehicles registered
                            </p>

                            <p className="mt-2 text-sm text-slate-500">
                                Add your first vehicle to begin verification.
                            </p>
                        </div>
                    ) : (
                        vehicles.map((vehicle) => {
                            const isCurrent =
                                currentVehicleId === String(vehicle._id);

                            const canActivate =
                                vehicle.verificationStatus === "APPROVED" &&
                                vehicle.isActive &&
                                !driver?.isOnline;

                            const type = vehicleTypes.find(
                                (item) => item.id === vehicle.vehicleType
                            );

                            return (
                                <article
                                    key={vehicle._id}
                                    className="rounded-[24px] bg-white p-5 shadow-sm"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">
                                            {type?.emoji || "🚗"}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <h4 className="font-extrabold">
                                                {vehicle.make} {vehicle.model}
                                            </h4>

                                            <p className="mt-1 text-sm text-slate-500">
                                                {vehicle.registrationNumber}
                                            </p>

                                            <p className="mt-1 text-xs text-slate-500">
                                                {type?.label || vehicle.vehicleType}
                                                {vehicle.color
                                                    ? ` · ${vehicle.color}`
                                                    : ""}
                                                {vehicle.modelYear
                                                    ? ` · ${vehicle.modelYear}`
                                                    : ""}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <span
                                            className={`rounded-lg px-3 py-2 text-xs font-bold ${statusStyles[vehicle.verificationStatus] ||
                                                "bg-slate-100 text-slate-600"
                                                }`}
                                        >
                                            {vehicle.verificationStatus}
                                        </span>

                                        {isCurrent && (
                                            <span className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-[#087F5B]">
                                                Active Vehicle
                                            </span>
                                        )}
                                    </div>

                                    {vehicle.verificationStatus === "APPROVED" &&
                                        !isCurrent && (
                                            <button
                                                type="button"
                                                disabled={!canActivate || Boolean(activating)}
                                                onClick={() => activateVehicle(vehicle)}
                                                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] px-4 py-3 font-bold text-white disabled:opacity-50"
                                            >
                                                {activating === vehicle._id
                                                    ? "Activating..."
                                                    : driver?.isOnline
                                                        ? "Go Offline to Change Vehicle"
                                                        : "Set as Active Vehicle"}
                                                <ArrowRight size={17} />
                                            </button>
                                        )}

                                    {vehicle.verificationStatus === "PENDING" && (
                                        <p className="mt-4 flex items-center gap-2 text-xs text-amber-700">
                                            <Clock3 size={16} />
                                            Waiting for administrator approval
                                        </p>
                                    )}

                                    {vehicle.verificationStatus === "REJECTED" && (
                                        <p className="mt-4 flex items-center gap-2 text-xs text-red-600">
                                            <XCircle size={16} />
                                            Vehicle rejected. Contact support for review.
                                        </p>
                                    )}
                                </article>
                            );
                        })
                    )}
                </section>
            </div>
        </main>
    );
}
