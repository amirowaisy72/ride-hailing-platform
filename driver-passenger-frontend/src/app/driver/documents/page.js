"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft, Camera, UploadCloud, FileCheck2,
    CheckCircle2, AlertCircle, ShieldCheck,
} from "lucide-react";

import AuthGuard from "@/components/AuthGuard";
import {
    consumeRestoredPhotos, isPickerCancelled, pickGalleryPhotos,
    takeCameraPhoto, useIsNative,
} from "@/lib/nativePhoto";
import { useAuth } from "@/context/AuthContext";
import MobileBottomNav from "@/components/MobileBottomNav";
import DriverRegistrationWizard from "@/components/driver/DriverRegistrationWizard";

const DOCUMENTS = [
    { type: "CNIC_FRONT", title: "CNIC Front", icon: "🪪" },
    { type: "CNIC_BACK", title: "CNIC Back", icon: "🪪" },
    {
        type: "PROFILE_PHOTO",
        title: "Profile Photo",
        icon: "🧑",
        required: true,
        hint: "Required — a clear photo of your face. You cannot continue without it.",
    },
    { type: "DRIVING_LICENSE", title: "Driving License", icon: "🚘" },
    {
        type: "VEHICLE_REGISTRATION",
        title: "Vehicle Registration",
        icon: "📄",
    },
    {
        type: "VEHICLE_PHOTO",
        title: "Vehicle Photo — Number Plate Must Be Visible",
        icon: "🚗",
        required: true,
        hint: "Required — photograph your whole vehicle so the number plate is clearly readable in the photo. A photo where the plate cannot be read will be rejected.",
    },
];

const API_URL =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

export default function DriverDocumentsPage() {
    // DRIVER + PASSENGER: a PENDING driver is still in PASSENGER mode
    // (they can only switch to DRIVER mode after approval), and the
    // "Manage Driver Documents" link is shown on their passenger
    // account. Guarding this page DRIVER-only bounced every pending
    // driver straight to /login, so no one could upload documents.
    // The backend upload endpoint itself only requires a Driver
    // record, not DRIVER mode or approval, so this is safe.
    return (
        <AuthGuard roles={["DRIVER", "PASSENGER"]}>
            <DocumentUploadScreen />
        </AuthGuard>
    );
}

function DocumentUploadScreen() {
    const { token, user } = useAuth();
    const router = useRouter();
    // Onboarding mode (?onboarding=1) shows the shared registration
    // wizard stepper and the gated Continue button. Read from the URL
    // directly (no useSearchParams) so no Suspense boundary is needed.
    const [onboarding, setOnboarding] = useState(false);
    useEffect(() => {
        setOnboarding(
            new URLSearchParams(window.location.search).get("onboarding") === "1"
        );
    }, []);
    // Back goes to the account page of the mode the user is actually
    // in — /driver/account is DRIVER-guarded and would bounce a
    // passenger-mode pending driver to /login again.
    const backHref =
        user?.activeMode === "DRIVER" ? "/driver/account" : "/passenger/account";

    const [files, setFiles] = useState({});
    const [expiryDates, setExpiryDates] = useState({});
    const [uploaded, setUploaded] = useState({});
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const native = useIsNative();
    const inputRefs = useRef({});
    const restoreCheckedRef = useRef(false);

    // Load the server's record on open, so a document that is already
    // uploaded (or approved) shows as such instead of "not uploaded
    // yet". Before this, `uploaded` started empty on every visit and
    // was only set by an upload in the same page session, so reopening
    // the page always looked like nothing had been uploaded. Uses the
    // backend GET /drivers/me/documents added in commit e5423af2.
    useEffect(() => {
        if (!token) return;
        (async () => {
            try {
                const response = await fetch(
                    `${API_URL}/drivers/me/documents`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                const result = await response.json();
                if (!response.ok || !result.success) return;
                const byType = {};
                for (const doc of result.documents || []) {
                    if (!byType[doc.documentType]) {
                        byType[doc.documentType] = doc;
                    }
                }
                setUploaded(byType);
            } catch {
                // Leave the page usable if the list cannot load;
                // uploading still works.
            }
        })();
    }, [token]);

    function selectFile(type, file) {
        if (!file) return;

        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            setError("Only JPG, PNG and WebP images are supported.");
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            setError("Maximum file size is 10 MB.");
            return;
        }

        setFiles((previous) => ({
            ...previous,
            [type]: file,
        }));

        setError("");
    }

    // If the app was killed while the picker/camera was open, the photo
    // comes back through appRestoredResult — recover it as the selected
    // file instead of making the driver pick it again.
    useEffect(() => {
        if (!native || restoreCheckedRef.current) return;
        restoreCheckedRef.current = true;
        let alive = true;
        (async () => {
            for (const doc of DOCUMENTS) {
                const files = await consumeRestoredPhotos(
                    "documents",
                    doc.type
                ).catch(() => null);
                if (!alive || !files?.length) continue;
                selectFile(doc.type, files[0]);
                setMessage(
                    "Your photo from before the restart was recovered — tap Upload Document."
                );
            }
        })();
        return () => {
            alive = false;
        };
    }, [native]);

    // On the installed app the photo comes from the native Camera
    // plugin (gallery or camera), which survives the picker activity
    // restart that used to lose the file. On the web the hidden file
    // input is used, exactly as before.
    async function handleChoosePhoto(type) {
        if (busy) return;
        if (!native) {
            inputRefs.current[type]?.click();
            return;
        }
        try {
            const [file] = await pickGalleryPhotos({
                limit: 1,
                pending: { flow: "documents", key: type },
            });
            if (file) selectFile(type, file);
        } catch (err) {
            if (isPickerCancelled(err)) return;
            setError(
                err?.message ||
                    "Could not open the photo picker — try choosing a file instead."
            );
            inputRefs.current[type]?.click();
        }
    }

    async function handleTakePhoto(type) {
        if (busy) return;
        try {
            const file = await takeCameraPhoto({
                pending: { flow: "documents", key: type },
            });
            if (file) selectFile(type, file);
        } catch (err) {
            if (isPickerCancelled(err)) return;
            setError(
                err?.message ||
                    "Could not open the camera — try choosing a photo instead."
            );
            inputRefs.current[type]?.click();
        }
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

            if (["DRIVING_LICENSE"].includes(type)) {
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

    // Continue is blocked until the two mandatory uploads are in
    // (uploaded and not rejected): Vehicle Photo (number plate
    // visible) and Profile Photo. Other documents stay uploadable in
    // any order; admin approval still enforces the full set.
    const isSatisfied = (type) =>
        Boolean(uploaded[type]) &&
        uploaded[type].verificationStatus !== "REJECTED";
    const mandatoryMissing = ["VEHICLE_PHOTO", "PROFILE_PHOTO"].filter(
        (type) => !isSatisfied(type)
    );

    function handleContinue() {
        if (mandatoryMissing.length > 0) return;
        router.push(
            onboarding ? "/driver/vehicles?onboarding=1" : "/driver/vehicles"
        );
    }

    return (
        <main className="driver-subpage min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <MobileBottomNav role={user?.activeMode || "PASSENGER"} />

            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto max-w-xl">
                    <Link
                        href={backHref}
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
                {onboarding && <DriverRegistrationWizard currentStep={1} />}

                <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                    <div className="flex items-center gap-3">
                        <ShieldCheck size={26} className="text-[#087F5B]" />
                        <div>
                            <h2 className="font-extrabold">
                                Identity Verification
                            </h2>
                            <p className="mt-1 text-xs text-pd-muted">
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
                        className="rounded-xl bg-pd-danger-soft p-4 text-sm text-pd-danger"
                    >
                        <AlertCircle size={16} className="mr-2 inline" />
                        {error}
                    </p>
                )}

                {message && (
                    <p
                        role="status"
                        className="rounded-xl bg-pd-success-soft p-4 text-sm text-[#087F5B]"
                    >
                        <CheckCircle2 size={16} className="mr-2 inline" />
                        {message}
                    </p>
                )}

                {DOCUMENTS.map((doc) => (
                    <section
                        key={doc.type}
                        className="rounded-[24px] bg-pd-surface p-5 shadow-sm"
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-3xl">{doc.icon}</span>

                            <div className="flex-1">
                                <h3 className="font-extrabold">{doc.title}</h3>
                                <p className="mt-1 text-xs text-pd-muted">
                                    JPG, PNG or WebP
                                    {doc.required ? " · Required" : ""}
                                </p>
                                {doc.hint && (
                                    <p className="mt-1 text-xs font-semibold text-pd-text">
                                        {doc.hint}
                                    </p>
                                )}
                            </div>

                            {uploaded[doc.type] && (
                                <span className="rounded-lg bg-pd-warning-soft px-3 py-2 text-xs font-bold text-pd-warning">
                                    {uploaded[doc.type].verificationStatus ===
                                    "APPROVED"
                                        ? "Approved"
                                        : uploaded[doc.type]
                                              .verificationStatus ===
                                          "REJECTED"
                                        ? "Rejected — upload again"
                                        : "Uploaded"}
                                </span>
                            )}
                        </div>

                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => void handleChoosePhoto(doc.type)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    void handleChoosePhoto(doc.type);
                                }
                            }}
                            className="mt-4 block cursor-pointer rounded-xl border-2 border-dashed border-emerald-200 bg-pd-success-soft/40 p-5 text-center"
                        >
                            <UploadCloud
                                size={26}
                                className="mx-auto text-[#087F5B]"
                            />

                            <p className="mt-2 text-sm font-semibold">
                                {files[doc.type]?.name || "Choose Document Image"}
                            </p>
                        </div>
                        <input
                            ref={(el) => {
                                if (el) inputRefs.current[doc.type] = el;
                            }}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(event) =>
                                selectFile(doc.type, event.target.files?.[0])
                            }
                        />
                        {native && (
                            <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => void handleTakePhoto(doc.type)}
                                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-pd-surface text-sm font-bold text-[#087F5B] disabled:opacity-40"
                            >
                                <Camera size={18} />
                                Take a photo
                            </button>
                        )}

                        {["DRIVING_LICENSE"].includes(doc.type) && (
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
                            <p className="mt-3 text-xs text-pd-warning">
                                {uploaded[doc.type].verificationStatus ===
                                "APPROVED"
                                    ? "Approved by admin."
                                    : uploaded[doc.type].verificationStatus ===
                                      "REJECTED"
                                    ? "Rejected by admin — please upload again."
                                    : "Submitted for admin verification."}
                            </p>
                        )}
                    </section>
                ))}

                <p className="rounded-xl bg-pd-warning-soft p-4 text-xs leading-5 text-pd-warning">
                    Use genuine documents only. Uploading does not mean
                    approval — your administrator must review each document.
                    Do not use someone else's documents.
                </p>

                <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                    <h2 className="font-extrabold">Continue to Vehicle</h2>
                    {mandatoryMissing.length > 0 ? (
                        <p className="mt-2 text-sm text-pd-muted">
                            Upload these before you can continue:{" "}
                            {mandatoryMissing
                                .map((type) =>
                                    DOCUMENTS.find((d) => d.type === type)?.title || type
                                )
                                .join(" and ")}
                            .
                        </p>
                    ) : (
                        <p className="mt-2 text-sm text-pd-muted">
                            Vehicle photo and profile photo uploaded. Continue
                            to add your vehicle.
                        </p>
                    )}
                    <button
                        type="button"
                        disabled={mandatoryMissing.length > 0}
                        onClick={handleContinue}
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                    >
                        Continue
                    </button>
                </section>
            </div>
        </main>
    );
}
