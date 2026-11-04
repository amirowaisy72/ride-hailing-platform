"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiRequest } from "@/lib/api";
import { applyForService } from "@/lib/driverServicesService";
import DriverSetupFlow from "@/components/driver/setup/DriverSetupFlow";
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

// The existing driver APIs expose approved required documents through
// `missingDocuments`, but do not expose a driver-facing list of pending or
// rejected document rows. This device's upload response is therefore only a
// fallback for unapproved uploads; on a new device, pending uploads cannot be
// distinguished from documents that were never sent. The documents endpoint
// also creates rows rather than replacing them, so a rejected re-upload may
// create another row until the backend adds a list/replace API.
export default function DriverSetupGate({ token, userId, driver }) {
    const docsKey = `safar-setup-docs-${userId}`;
    const [sentDocs, setSentDocs] = useState(() => readSet(docsKey));
    const [uploadingDoc, setUploadingDoc] = useState("");
    const [savingVehicle, setSavingVehicle] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [actionError, setActionError] = useState("");
    const [notice, setNotice] = useState("");

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
    for (const doc of SETUP_DOCS) {
        if (serverApprovedDocs.has(doc.type)) docs[doc.type] = "APPROVED";
        else if (status === "UNDER_REVIEW" || sentDocs.includes(doc.type)) docs[doc.type] = "UPLOADED";
        else docs[doc.type] = "NONE";
    }

    async function uploadDoc(type, file, expiryDate) {
        if (!file || uploadingDoc) return;

        setUploadingDoc(type);
        setActionError("");
        setNotice("");

        try {
            const formData = new FormData();
            formData.append("documentType", type);
            if (["DRIVING_LICENSE", "VEHICLE_REGISTRATION"].includes(type)) {
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
            await Promise.all([mutateStatus(), mutateSetup()]);
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
        return <main className="min-h-dvh bg-pd-bg" aria-busy="true" />;
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
