"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import DriverSetupFlow from "@/components/driver/setup/DriverSetupFlow";
import { SETUP_DOCS } from "@/components/driver/setup/setupConfig";

const API_URL =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

const readSet = (key) => {
    try {
        return JSON.parse(window.localStorage.getItem(key) || "[]");
    } catch {
        return [];
    }
};

// Connects the guided setup UI to the existing driver APIs: document
// upload, vehicle registration and the status endpoints. No new
// endpoints or request shapes are used.
export default function DriverSetupGate({ token, userId, driver, onApproved }) {
    const docsKey = `safar-setup-docs-${userId}`;
    const submittedKey = `safar-setup-submitted-${userId}`;

    const [approvedDocs, setApprovedDocs] = useState([]);
    const [sentDocs, setSentDocs] = useState([]);
    const [vehicle, setVehicle] = useState(null);
    const [submitted, setSubmitted] = useState(false);
    const [status, setStatus] = useState(driver?.verificationStatus || "PENDING");
    const [rejectionReason, setRejectionReason] = useState(driver?.rejectionReason || "");
    const [loaded, setLoaded] = useState(false);
    const [uploadingDoc, setUploadingDoc] = useState("");
    const [savingVehicle, setSavingVehicle] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        const [statusData, vehicleData, serviceData] = await Promise.all([
            apiRequest("/drivers/me/status", { token }),
            apiRequest("/drivers/me/vehicles", { token }),
            apiRequest("/drivers/me/services", { token }),
        ]);

        const next = statusData.driver;
        setStatus(next?.verificationStatus || "PENDING");
        setRejectionReason(next?.rejectionReason || "");
        setVehicle((vehicleData.vehicles || [])[0] || null);

        const ride = (serviceData.services || []).find((item) => item.service === "RIDE");
        const missing = ride?.missingDocuments || SETUP_DOCS.map((doc) => doc.type);
        setApprovedDocs(SETUP_DOCS.map((doc) => doc.type).filter((type) => !missing.includes(type)));

        if (next?.verificationStatus === "APPROVED") onApproved?.(next);
    }, [token, onApproved]);

    useEffect(() => {
        setSentDocs(readSet(docsKey));
        setSubmitted(window.localStorage.getItem(submittedKey) === "1");

        let cancelled = false;
        load()
            .catch((err) => !cancelled && setError(err.message))
            .finally(() => !cancelled && setLoaded(true));

        return () => {
            cancelled = true;
        };
    }, [docsKey, submittedKey, load]);

    const underReview = status === "UNDER_REVIEW";
    const docs = {};
    for (const doc of SETUP_DOCS) {
        if (approvedDocs.includes(doc.type)) docs[doc.type] = "APPROVED";
        else if (sentDocs.includes(doc.type) || underReview) docs[doc.type] = "UPLOADED";
        else docs[doc.type] = "NONE";
    }

    async function uploadDoc(type, file, expiryDate) {
        if (!file || uploadingDoc) return;

        setUploadingDoc(type);
        setError("");

        try {
            const formData = new FormData();
            formData.append("documentType", type);
            if (["DRIVING_LICENSE", "VEHICLE_REGISTRATION"].includes(type)) {
                if (!expiryDate) throw new Error("Please select document expiry date");
                formData.append("expiryDate", expiryDate);
            }
            formData.append("document", file);

            const response = await fetch(`${API_URL}/drivers/me/documents`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || "Document upload failed");
            }

            const nextSent = Array.from(new Set([...sentDocs, type]));
            setSentDocs(nextSent);
            window.localStorage.setItem(docsKey, JSON.stringify(nextSent));
        } catch (err) {
            setError(err.message);
        } finally {
            setUploadingDoc("");
        }
    }

    async function saveVehicle(form) {
        if (savingVehicle) return;

        setSavingVehicle(true);
        setError("");

        try {
            await apiRequest("/drivers/me/vehicles", {
                method: "POST",
                token,
                body: JSON.stringify({
                    vehicleType: form.vehicleType,
                    registrationNumber: form.registrationNumber,
                    make: form.make.trim(),
                    model: form.model.trim(),
                    color: form.color.trim(),
                    ...(form.modelYear ? { modelYear: Number(form.modelYear) } : {}),
                }),
            });
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingVehicle(false);
        }
    }

    function submit() {
        setSubmitting(true);
        window.localStorage.setItem(submittedKey, "1");
        setSubmitted(true);
        setSubmitting(false);
    }

    async function refresh() {
        setRefreshing(true);
        setError("");
        try {
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setRefreshing(false);
        }
    }

    if (!loaded) {
        return <main className="min-h-dvh bg-pd-bg" aria-busy="true" />;
    }

    return (
        <DriverSetupFlow
            docs={docs}
            vehicle={vehicle}
            status={status}
            rejectionReason={rejectionReason}
            submitted={submitted && status !== "REJECTED"}
            uploadingDoc={uploadingDoc}
            savingVehicle={savingVehicle}
            submitting={submitting}
            refreshing={refreshing}
            error={error}
            onUploadDoc={uploadDoc}
            onSaveVehicle={saveVehicle}
            onSubmit={submit}
            onRefresh={refresh}
        />
    );
}
