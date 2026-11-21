"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    AlertCircle, Camera, Car, CheckCircle2, FileCheck2,
    ShieldCheck, UploadCloud, User,
} from "lucide-react";
import SafarLoader from "@/components/SafarLoader";
import {
    consumeRestoredPhotos, isPickerCancelled, pickGalleryPhotos,
    takeCameraPhoto, useIsNative,
} from "@/lib/nativePhoto";
import {
    fetchMyDocuments,
    latestDocumentByType,
    RETROACTIVE_PHOTO_TYPES,
    uploadDriverDocument,
    validateDocumentImage,
} from "@/components/driver/setup/setupData";

const PHOTO_META = {
    VEHICLE_PHOTO: {
        title: "Vehicle Photo — Number Plate Must Be Visible",
        hint: "Photograph your whole vehicle so the number plate is clearly readable in the photo. A photo where the plate cannot be read will be rejected.",
        Icon: Car,
    },
    PROFILE_PHOTO: {
        title: "Profile Photo",
        hint: "A clear photo of your face.",
        Icon: User,
    },
};

// Retroactive photo gate (Safar To-Do #16): Safar now asks EVERY
// driver for a vehicle photo and a profile photo — including drivers
// approved before the rule existed. An approved driver missing either
// one sees this screen instead of the driver section until both are
// uploaded and not rejected. FAIL OPEN: if the documents list cannot
// load, the driver is let through — a network error must never lock a
// driver out of the app.
export default function MissingPhotosGate({ token, onDone }) {
    const [loading, setLoading] = useState(true);
    const [uploaded, setUploaded] = useState(new Map());
    const [files, setFiles] = useState({});
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const doneRef = useRef(false);
    const mountedRef = useRef(true);
    const native = useIsNative();
    const inputRefs = useRef({});
    const restoreCheckedRef = useRef(false);

    const finish = useCallback(() => {
        if (doneRef.current) return;
        doneRef.current = true;
        onDone();
    }, [onDone]);

    // Returns true when both photos are satisfied on the server.
    // On a fetch failure returns true as well (fail open) — the
    // caller then shows the driver section.
    const refresh = useCallback(async () => {
        try {
            const rows = await fetchMyDocuments(token);
            if (!mountedRef.current) return true;
            const byType = latestDocumentByType(rows);
            setUploaded(byType);
            return RETROACTIVE_PHOTO_TYPES.every(
                (type) =>
                    byType.get(type) &&
                    byType.get(type).verificationStatus !== "REJECTED"
            );
        } catch {
            return true;
        }
    }, [token]);

    useEffect(() => {
        mountedRef.current = true;
        (async () => {
            const satisfied = await refresh();
            if (!mountedRef.current) return;
            setLoading(false);
            if (satisfied) finish();
        })();
        return () => {
            mountedRef.current = false;
        };
    }, [refresh, finish]);

    const isSatisfied = (type) =>
        Boolean(uploaded.get(type)) &&
        uploaded.get(type).verificationStatus !== "REJECTED";
    const missing = RETROACTIVE_PHOTO_TYPES.filter(
        (type) => !isSatisfied(type)
    );

    function selectFile(type, file) {
        if (!file) return;
        const validationError = validateDocumentImage(file);
        if (validationError) {
            setError(validationError);
            return;
        }
        setFiles((previous) => ({ ...previous, [type]: file }));
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
            for (const type of RETROACTIVE_PHOTO_TYPES) {
                const files = await consumeRestoredPhotos("gate", type).catch(
                    () => null
                );
                if (!alive || !files?.length) continue;
                selectFile(type, files[0]);
                setMessage(
                    "Your photo from before the restart was recovered — tap Upload Photo."
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
                pending: { flow: "gate", key: type },
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
                pending: { flow: "gate", key: type },
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
            const document = await uploadDriverDocument(token, type, file);
            if (!mountedRef.current) return;
            setUploaded((previous) => {
                const next = new Map(previous);
                next.set(type, document);
                return next;
            });
            setFiles((previous) => ({ ...previous, [type]: null }));
            setMessage(`${type.replaceAll("_", " ")} uploaded successfully.`);
        } catch (err) {
            if (mountedRef.current) setError(err.message);
        } finally {
            if (mountedRef.current) setBusy("");
        }
    }

    async function handleContinue() {
        if (missing.length > 0) return;
        setBusy("continue");
        setError("");
        const satisfied = await refresh();
        if (!mountedRef.current) return;
        setBusy("");
        if (satisfied) {
            finish();
        } else {
            setError(
                "The photos are still missing on the server. Please upload them again."
            );
        }
    }

    if (loading) {
        return <SafarLoader />;
    }

    return (
        <main className="driver-subpage min-h-dvh bg-pd-bg pb-28 text-pd-text">
            <header className="bg-[#087F5B] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
                <div className="mx-auto max-w-xl">
                    <h1 className="mt-7 text-3xl font-extrabold">
                        Documents Missing
                    </h1>
                    <p className="mt-2 text-sm text-white/75">
                        Safar now asks every driver for these photos —
                        including drivers approved earlier. Upload them to
                        keep driving.
                    </p>
                </div>
            </header>

            <div className="relative z-10 mx-auto mt-4 max-w-xl space-y-5 px-4 pb-6">
                <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                    <div className="flex items-center gap-3">
                        <ShieldCheck size={26} className="text-[#087F5B]" />
                        <div>
                            <h2 className="font-extrabold">
                                Same rule for every driver
                            </h2>
                            <p className="mt-1 text-xs text-pd-muted">
                                Uploading does not mean approval — your
                                administrator must review each photo.
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

                {missing.map((type) => {
                    const { title, hint, Icon } = PHOTO_META[type];
                    const rejected =
                        uploaded.get(type)?.verificationStatus === "REJECTED";
                    return (
                        <section
                            key={type}
                            className="rounded-[24px] bg-pd-surface p-5 shadow-sm"
                        >
                            <div className="flex items-center gap-3">
                                <Icon size={30} className="text-[#087F5B]" />
                                <div className="flex-1">
                                    <h3 className="font-extrabold">{title}</h3>
                                    <p className="mt-1 text-xs text-pd-muted">
                                        JPG, PNG or WebP · Required
                                    </p>
                                    <p className="mt-1 text-xs font-semibold text-pd-text">
                                        {hint}
                                    </p>
                                </div>
                                {rejected && (
                                    <span className="rounded-lg bg-pd-warning-soft px-3 py-2 text-xs font-bold text-pd-warning">
                                        Rejected — upload again
                                    </span>
                                )}
                            </div>

                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => void handleChoosePhoto(type)}
                                onKeyDown={(event) => {
                                    if (
                                        event.key === "Enter" ||
                                        event.key === " "
                                    ) {
                                        event.preventDefault();
                                        void handleChoosePhoto(type);
                                    }
                                }}
                                className="mt-4 block cursor-pointer rounded-xl border-2 border-dashed border-emerald-200 bg-pd-success-soft/40 p-5 text-center"
                            >
                                <UploadCloud
                                    size={26}
                                    className="mx-auto text-[#087F5B]"
                                />
                                <p className="mt-2 text-sm font-semibold">
                                    {files[type]?.name || "Choose Photo"}
                                </p>
                            </div>
                            <input
                                ref={(el) => {
                                    if (el) inputRefs.current[type] = el;
                                }}
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="hidden"
                                onChange={(event) =>
                                    selectFile(
                                        type,
                                        event.target.files?.[0]
                                    )
                                }
                            />
                            {native && (
                                <button
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() => void handleTakePhoto(type)}
                                    className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-pd-surface text-sm font-bold text-[#087F5B] disabled:opacity-40"
                                >
                                    <Camera size={18} />
                                    Take a photo
                                </button>
                            )}

                            <button
                                type="button"
                                disabled={!files[type] || Boolean(busy)}
                                onClick={() => uploadDocument(type)}
                                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                            >
                                <FileCheck2 size={18} />
                                {busy === type ? "Uploading..." : "Upload Photo"}
                            </button>
                        </section>
                    );
                })}

                <section className="rounded-[24px] bg-pd-surface p-5 shadow-sm">
                    <h2 className="font-extrabold">Continue</h2>
                    {missing.length > 0 ? (
                        <p className="mt-2 text-sm text-pd-muted">
                            Upload these before you can continue:{" "}
                            {missing
                                .map((type) => PHOTO_META[type].title)
                                .join(" and ")}
                            .
                        </p>
                    ) : (
                        <p className="mt-2 text-sm text-pd-muted">
                            Vehicle photo and profile photo uploaded. Continue
                            to the driver section.
                        </p>
                    )}
                    <button
                        type="button"
                        disabled={missing.length > 0 || Boolean(busy)}
                        onClick={handleContinue}
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white disabled:opacity-40"
                    >
                        {busy === "continue" ? "Checking..." : "Continue"}
                    </button>
                </section>
            </div>
        </main>
    );
}
