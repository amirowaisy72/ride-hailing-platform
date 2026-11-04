"use client";

import { useState } from "react";
import DriverSetupFlow from "@/components/driver/setup/DriverSetupFlow";

const INITIAL_DOCS = {
    CNIC_FRONT: "UPLOADED",
    CNIC_BACK: "UPLOADED",
    DRIVING_LICENSE: "UPLOADED",
    VEHICLE_REGISTRATION: "UPLOADED",
};

const INITIAL_VEHICLE = {
    vehicleType: "CAR_AC",
    registrationNumber: "LEA-1234",
    make: "Honda",
    model: "City",
    modelYear: "2020",
    color: "Red",
};

export default function DriverSetupDemo() {
    const [docs, setDocs] = useState(INITIAL_DOCS);
    const [vehicle, setVehicle] = useState(INITIAL_VEHICLE);
    const [status, setStatus] = useState("REJECTED");

    return (
        <>
            <div className="bg-pd-accent-soft px-4 py-2 text-center text-sm font-bold text-pd-accent-text">
                Interactive setup preview · demo data only · no account or backend changes
            </div>
            <DriverSetupFlow
                docs={docs}
                vehicle={vehicle}
                status={status}
                rejectionReason="The vehicle registration photo is unclear. Please upload a clear photo."
                onUploadDoc={(type) => setDocs((current) => ({ ...current, [type]: "UPLOADED" }))}
                onSaveVehicle={async (form) => {
                    setVehicle(form);
                    return true;
                }}
                onSubmit={async () => {
                    setStatus("UNDER_REVIEW");
                }}
                onRefresh={() => {}}
            />
        </>
    );
}
