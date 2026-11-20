"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { apiRequest } from "@/lib/api";
import { applyForService } from "@/lib/driverServicesService";
import DriverSetupFlow from "@/components/driver/setup/DriverSetupFlow";
import SafarLoader from "@/components/SafarLoader";
import { SETUP_DOCS } from "@/components/driver/setup/setupConfig";
import {
    fetchDriverSetupDetails,
    fetchDriverStatus,
    getDriverSetupDetailsKey,
    getDriverStatusKey,
} from "@/components/driver/setup/setupData";

const readSet = (key) => {
    try {
        const value = JSON.parse(window.localStorage.getItem(key) || "[]");
        return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
    } catch {
        return [];
    }
};

const writeSet = (key, value) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Server state remains authoritative when browser storage is unavailable.
    }
};

const displayStatus = (status) =>
    String(status || "UNKNOWN").replaceAll("_", " ").toLowerCase();

// The driver-facing list GET /drivers/me/documents is the source of
// truth for what this driver has uploaded: one live row per document
// type, with verificationStatus PENDING / APPROVED / REJECTED. The
// device's localStorage list (safar-setup-docs-<userId>) is only an
// optimistic hint until that list loads, and the fallback if the
// request fails or the driver is offline — it must never, on its own,
// mark a document "Uploaded", and the driver's overall
// UNDER_REVIEW status must never mark every document uploaded: a
// driver can be under review while a document was never sent at all.
export default function DriverSetupGate({ token, userId, driver }) {
    const docsKey = `safar-setup-docs-${userId}`;
    const [sentDocs, setSentDocs] = useState(() => readSet(docsKey));
    const [serverDocs, setServerDocs] = useState(null);
    const mountedRef = useRef(true);
    const [uploadingDoc, setUploadingDoc] = useState("");
    const [savingVehicle, setSavingVehicle] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [actionError, setActionError] = useState("");
    const [notice, setNotice] = useState("");

    const fetchMyDocuments = useCallback(async () => {
        if (!token) return null;
        try {
            const result = await apiRequest("/drivers/me/documents", { token });
            const rows = Array.isArray(result?.documents) ? result.documents : [];
            if (mountedRef.current) setServerDocs(rows);
            return rows;
        } catch {
            // Offline / request failed: keep serverDocs null so the
            // localStorage hint below stays in effect. The error is
            // deliberately not surfaced — a failed documents read must
            // not block the setup flow.
            return null;
        }
    }, [token]);

    useEffect(() => {
        mountedRef.current = true;
        fetchMyDocuments();
        return () => {
            mountedRef.current = false;
        };
    }, [fetchMyDocuments]);

    const {
        data: statusData,
        error: statusError,
        isLoading: statusLoading,
        mutate: mutateStatus,
    } = useSWR(getDriverStatusKey(token), fetchDriverStatus, {
        revalidateOnFocus: true,
    });
    const {
        data: setupData,
        error: setupError,
        isLoading: setupLoading,
        mutate: mutateSetup,
    } = useSWR(getDriverSetupDetailsKey(token), fetchDriverSetupDetails, {
        revalidateOnFocus: true,
    });

    const serverDriver = statusData?.driver || driver;
    const status = serverDriver?.verificationStatus || "PENDING";
    const rejectionReason = serverDriver?.rejectionReason || "";
    const vehicle = setupData?.vehicleData?.vehicles?.[0] || null;
    const ride = setupData?.serviceData?.services?.find((item) => item.service === "RIDE");
    const requiredDocs = ride?.requiredDocuments || SETUP_DOCS.map((doc) => doc.type);
    const missingDocs = new Set(ride?.missingDocuments || requiredDocs);
    const serverApprovedDocs = new Set(
        requiredDocs.filter((type) => !missingDocs.has(type))
    );
    const error = actionError || statusError?.message || setupError?.message || "";

    const docs = {};
    if (serverDocs !== null) {
        // Server truth: latest row per document type (rows are
        // deduplicated server-side, but take the newest by createdAt
        // so any legacy duplicate can never resurrect an old status).
        const latestByType = new Map();
        [...serverDocs]
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .forEach((row) => {
                if (row?.documentType && !latestByType.has(row.documentType)) {
                    latestByType.set(row.documentType, row);
                }
            });
        for (const doc of SETUP_DOCS) {
            const row = latestByType.get(doc.type);
            if (!row) docs[doc.type] = "NONE";
            else if (row.verificationStatus === "APPROVED") docs[doc.type] = "APPROVED";
            else if (row.verificationStatus === "REJECTED") docs[doc.type] = "REJECTED";
            else docs[doc.type] = "UPLOADED";
        }
    } else {
        // Server list not loaded (yet, or the request failed): fall
        // back to today's localStorage behaviour as an optimistic
        // hint only. Once the list loads, the server rows above win.
        for (const doc of SETUP_DOCS) {
            if (serverApprovedDocs.has(doc.type)) docs[doc.type] = "APPROVED";
            else if (status === "UNDER_REVIEW" || sentDocs.includes(doc.type)) docs[doc.type] = "UPLOADED";
            else docs[doc.type] = "NONE";
        }
    }

    async function uploadDoc(type, file, expiryDate) {
        if (!file || uploadingDoc) return;

        setUploadingDoc(type);
        setActionError("");
        setNotice("");

        try {
            const formData = new FormData();
            formData.append("documentType", type);
            // Expiry is required only for the document types whose
            // setupConfig entry says so (DRIVING_LICENSE). Do NOT
            // hardcode the list here: VEHICLE_REGISTRATION no longer
            // needs an expiry, and the flow only shows a date picker
            // for needsExpiry types — a hardcoded check here would
            // demand a date the driver was never asked for.
            // NOTE: the backend must match — it still requires an
            // expiry for VEHICLE_REGISTRATION in
            // driverDocumentController.js (requiresExpiry). Remove
            // VEHICLE_REGISTRATION there or this upload gets a 400.
            const needsExpiry = SETUP_DOCS.find((doc) => doc.type === type)?.needsExpiry === true;
            if (needsExpiry) {
                if (!expiryDate) throw new Error("Please select document expiry date");
                formData.append("expiryDate", expiryDate);
            }
            formData.append("document", file);

            const result = await apiRequest("/drivers/me/documents", {
                method: "POST",
                token,
                body: formData,
            });
            const uploadedType = result.document?.documentType || type;
            const nextSent = Array.from(new Set([...sentDocs, uploadedType]));
            setSentDocs(nextSent);
            writeSet(docsKey, nextSent);
            await Promise.all([mutateStatus(), mutateSetup(), fetchMyDocuments()]);
        } catch (uploadError) {
            setActionError(uploadError.message);
        } finally {
            setUploadingDoc("");
        }
    }

    async function saveVehicle(form) {
        if (savingVehicle) return false;

        setSavingVehicle(true);
        setActionError("");
        setNotice("");

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

            try {
                await mutateSetup();
            } catch (refreshError) {
                setActionError(`Vehicle saved, but could not refresh the list: ${refreshError.message}`);
            }
            return true;
        } catch (saveError) {
            setActionError(saveError.message);
            return false;
        } finally {
            setSavingVehicle(false);
        }
    }

    async function refresh({ preserveError = false } = {}) {
        setRefreshing(true);
        if (!preserveError) setActionError("");
        setNotice("");

        try {
            const [latestStatus] = await Promise.all([
                mutateStatus(),
                mutateSetup(),
                fetchMyDocuments(),
            ]);
            return latestStatus?.driver || null;
        } catch (refreshError) {
            setActionError(refreshError.message);
            return null;
        } finally {
            setRefreshing(false);
        }
    }

    async function submit() {
        setSubmitting(true);
        setActionError("");
        setNotice("");

        let applicationMessage = "";
        let applicationError = "";
        try {
            const result = await applyForService("RIDE", {}, token);
            applicationMessage = result.message || "Your application was saved.";
        } catch (submitError) {
            applicationError = submitError.message;
        }

        const latestDriver = await refresh({ preserveError: Boolean(applicationError) });
        if (applicationError) {
            setActionError(applicationError);
        } else if (latestDriver) {
            setNotice(
                `${applicationMessage} Current driver status: ${displayStatus(latestDriver.verificationStatus)}.`
            );
        }

        setSubmitting(false);
    }

    async function refreshStatus() {
        await refresh();
    }

    if (statusLoading || setupLoading) {
        return <SafarLoader />;
    }

    return (
        <DriverSetupFlow
            docs={docs}
            vehicle={vehicle}
            status={status}
            rejectionReason={rejectionReason}
            uploadingDoc={uploadingDoc}
            savingVehicle={savingVehicle}
            submitting={submitting}
            refreshing={refreshing}
            error={error}
            notice={notice}
            onUploadDoc={uploadDoc}
            onSaveVehicle={saveVehicle}
            onSubmit={submit}
            onRefresh={refreshStatus}
        />
    );
}
