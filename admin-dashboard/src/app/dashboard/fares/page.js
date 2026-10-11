
"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { authenticatedAdminRequest } from "@/lib/adminSession";

const TYPES = [
    { id: "BIKE", name: "🏍️ Motorcycle" },
    { id: "RICKSHAW", name: "🛺 Rickshaw" },
    { id: "CAR_NON_AC", name: "🚗 Car Non-AC" },
    { id: "CAR_AC", name: "🚘 Car AC" },
];

const emptyPricing = () => ({
    baseFare: "",
    perKmRate: "",
    minimumFare: "",
    isActive: true,
});

export default function FareSettingsPage() {
    const [pricing, setPricing] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const loadPricing = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const data = await authenticatedAdminRequest("/vehicle-pricing");
            const values = {};

            for (const type of TYPES) {
                const saved = (data.pricing || []).find(
                    (item) => item.vehicleType === type.id
                );
                values[type.id] = saved
                    ? {
                        baseFare: String(saved.baseFare),
                        perKmRate: String(saved.perKmRate),
                        minimumFare: String(saved.minimumFare),
                        isActive: saved.isActive,
                    }
                    : emptyPricing();
            }

            setPricing(values);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPricing();
    }, [loadPricing]);

    function update(type, field, value) {
        setPricing((previous) => ({
            ...previous,
            [type]: {
                ...previous[type],
                [field]: value,
            },
        }));
    }

    async function save(type) {
        const values = pricing[type];
        if (!values || saving) return;

        const payload = {
            baseFare: Number(values.baseFare),
            perKmRate: Number(values.perKmRate),
            minimumFare: Number(values.minimumFare),
            isActive: values.isActive,
        };

        if (
            ["baseFare", "perKmRate", "minimumFare"].some(
                (field) =>
                    values[field] === "" ||
                    !Number.isFinite(payload[field]) ||
                    payload[field] < 0
            )
        ) {
            setError("Enter valid non-negative pricing values.");
            return;
        }

        setSaving(type);
        setError("");
        setMessage("");

        try {
            await authenticatedAdminRequest(
                `/vehicle-pricing/${type}`,
                {
                    method: "PUT",
                    body: JSON.stringify(payload),
                }
            );

            setMessage(`${type.replaceAll("_", " ")} pricing saved.`);
            await loadPricing();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving("");
        }
    }

    return (
        <AdminShell title="Fare Settings">
            <div className="space-y-6">
                <section className="rounded-3xl bg-white p-6 shadow-sm">
                    <p className="text-xs font-bold uppercase text-[#087F5B]">
                        Pricing Configuration
                    </p>
                    <h2 className="mt-2 text-2xl font-extrabold">
                        Vehicle Fare Settings
                    </h2>
                    <p className="mt-2 text-sm text-slate-500">
                        Configure base fare, per-kilometre rate and minimum fare.
                        All amounts are in PKR.
                    </p>
                </section>

                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
                        {error}
                    </p>
                )}

                {message && (
                    <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-[#087F5B]">
                        {message}
                    </p>
                )}

                {loading ? (
                    <p>Loading pricing...</p>
                ) : (
                    <div className="grid gap-5 lg:grid-cols-2">
                        {TYPES.map((type) => {
                            const values = pricing[type.id] || emptyPricing();

                            return (
                                <section
                                    key={type.id}
                                    className="rounded-3xl bg-white p-6 shadow-sm"
                                >
                                    <h3 className="mb-5 text-xl font-extrabold">
                                        {type.name}
                                    </h3>

                                    <div className="space-y-4">
                                        {[
                                            ["baseFare", "Base Fare (PKR)"],
                                            ["perKmRate", "Per KM Rate (PKR)"],
                                            ["minimumFare", "Minimum Fare (PKR)"],
                                        ].map(([field, label]) => (
                                            <label key={field} className="block">
                                                <span className="mb-2 block text-sm font-bold">
                                                    {label}
                                                </span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={values[field]}
                                                    onChange={(event) =>
                                                        update(type.id, field, event.target.value)
                                                    }
                                                    className="h-12 w-full rounded-xl border px-4 outline-none focus:border-[#087F5B]"
                                                />
                                            </label>
                                        ))}

                                        <label className="flex items-center gap-3 text-sm font-semibold">
                                            <input
                                                type="checkbox"
                                                checked={values.isActive}
                                                onChange={(event) =>
                                                    update(type.id, "isActive", event.target.checked)
                                                }
                                                className="h-5 w-5 accent-[#087F5B]"
                                            />
                                            Vehicle Pricing Active
                                        </label>

                                        <button
                                            type="button"
                                            disabled={Boolean(saving)}
                                            onClick={() => save(type.id)}
                                            className="h-12 w-full rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-50"
                                        >
                                            {saving === type.id ? "Saving..." : "Save Pricing"}
                                        </button>
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>
        </AdminShell>
    );
}
