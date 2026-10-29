"use client";

import { useState } from "react";
import Link from "next/link";
import {
    ArrowLeft, UploadCloud, FileCheck2,
    CheckCircle2, AlertCircle, ShieldCheck,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import MobileBottomNav from "@/components/MobileBottomNav";

const DOCUMENTS = [
    { type: "CNIC_FRONT", title: "CNIC Front", icon: "🪪" },
    { type: "CNIC_BACK", title: "CNIC Back", icon: "🪪" },
    { type: "PROFILE_PHOTO", title: "Profile Photo", icon: "🧑" },
    { type: "DRIVING_LICENSE", title: "Driving License", icon: "🚘" },
    {
        type: "VEHICLE_REGISTRATION",
        title: "Vehicle Registration",
        icon: "📄",
    },
];

const API_URL =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

export default function DriverDocumentsPage() {
    return (
        <AuthGuard role="PASSENGER">
            <DocumentUploadScreen />
        </AuthGuard>
    );
}

function DocumentUploadScreen() {
    const { token } = useAuth();

    const [files, setFiles] = useState({});
    const [expiryDates, setExpiryDates] = useState({});
    const [uploaded, setUploaded] = useState({});
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    function selectFile(type, file) {
        if (!file) return;

        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            setError("Only JPG, PNG and WebP images are supported.");
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            setError("Maximum file size is 5 MB.");
            return;
        }

        setFiles((previous) => ({
            ...previous,
            [type]: file,
        }));

        setError("");
    }

    async function uploadDocument(type) {
        const file = files[type];

        if (!file || !token || busy) return;

        setBusy(type);
        setError("");
        setMessage("");

        try {
            const formData = new FormData();
            formData.append("documentType", type);

            if (["DRIVING_LICENSE", "VEHICLE_REGISTRATION"].includes(type)) {
                const expiryDate = expiryDates[type];

                if (!expiryDate) {
                    throw new Error("Please select document expiry date");
                }

                formData.append("expiryDate", expiryDate);
            }

            formData.append("document", file);
            const response = await fetch(
                `${API_URL}/drivers/me/documents`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    body: formData,
                }
            );

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || "Document upload failed");
            }

            setUploaded((previous) => ({
                ...previous,
                [type]: result.document,
            }));

            setFiles((previous) => ({
                ...previous,
                [type]: null,
            }));

            setMessage(`${type.replaceAll("_", " ")} uploaded successfully.`);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy("");
        }
    }

    return (
        <main className="driver-subpage min-h-dvh bg-[#F7F9F8] pb-28 text-slate-900">
            <MobileBottomNav role="DRIVER" />

            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto max-w-xl">
                    <Link
                        href="/driver/account"
                        className="inline-flex items-center gap-2 text-sm font-semibold"
                    >
                        <ArrowLeft size={19} />
                        Back to Account
                    </Link>

                    <h1 className="mt-7 text-3xl font-extrabold">
                        Driver Documents
                    </h1>

                    <p className="mt-2 text-sm text-white/75">
                        Upload documents for administrator verification.
                    </p>
                </div>
            </header>

            <div className="relative z-10 mx-auto mt-4 max-w-xl space-y-5 px-4 pb-6">
                <section className="rounded-[24px] bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-3">
                        <ShieldCheck size={26} className="text-[#087F5B]" />
                        <div>
                            <h2 className="font-extrabold">
                                Identity Verification
                            </h2>
                            <p className="mt-1 text-xs text-slate-500">
                                Every service — Rides, Parcels and Buy &amp;
                                Deliver — has its own document requirements.
                                Check My Services to see exactly what each of
                                your services still needs.
                            </p>
                        </div>
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
                        className="rounded-xl bg-emerald-50 p-4 text-sm text-[#087F5B]"
                    >
                        <CheckCircle2 size={16} className="mr-2 inline" />
                        {message}
                    </p>
                )}

                {DOCUMENTS.map((doc) => (
                    <section
                        key={doc.type}
                        className="rounded-[24px] bg-white p-5 shadow-sm"
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-3xl">{doc.icon}</span>

                            <div className="flex-1">
                                <h3 className="font-extrabold">{doc.title}</h3>
                                <p className="mt-1 text-xs text-slate-500">
                                    JPG, PNG or WebP
                                </p>
                            </div>

                            {uploaded[doc.type] && (
                                <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                                    Uploaded
                                </span>
                            )}
                        </div>

                        <label className="mt-4 block cursor-pointer rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 p-5 text-center">
                            <UploadCloud
                                size={26}
                                className="mx-auto text-[#087F5B]"
                            />

                            <p className="mt-2 text-sm font-semibold">
                                {files[doc.type]?.name || "Choose Document Image"}
                            </p>

                            <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="hidden"
                                onChange={(event) =>
                                    selectFile(doc.type, event.target.files?.[0])
                                }
                            />
                        </label>

                        {["DRIVING_LICENSE", "VEHICLE_REGISTRATION"].includes(doc.type) && (
                            <label className="mt-4 block">
                                <span className="text-sm font-semibold">
                                    Document Expiry Date
                                </span>
                                <input
                                    type="date"
                                    required
                                    min={new Date(Date.now() + 86400000)
                                        .toLocaleDateString("en-CA")}
                                    value={expiryDates[doc.type] || ""}
                                    onChange={(e) =>
                                        setExpiryDates((previous) => ({
                                            ...previous,
                                            [doc.type]: e.target.value,
                                        }))
                                    }
                                    className="mt-2 h-12 w-full rounded-xl border px-4"
                                />
                            </label>
                        )}

                        <button
                            type="button"
                            disabled={!files[doc.type] || Boolean(busy)}
                            onClick={() => uploadDocument(doc.type)}
                            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                        >
                            <FileCheck2 size={18} />
                            {busy === doc.type
                                ? "Uploading..."
                                : "Upload Document"}
                        </button>

                        {uploaded[doc.type] && (
                            <p className="mt-3 text-xs text-amber-700">
                                Submitted for admin verification.
                            </p>
                        )}
                    </section>
                ))}

                <p className="rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                    Use genuine documents only. Uploading does not mean
                    approval — your administrator must review each document.
                    Do not use someone else's documents.
                </p>
            </div>
        </main>
    );
}
