// Shared constants for the guided driver setup. The document list and
// expiry rules mirror what the backend already requires for motor
// services (CNIC front/back, driving license, vehicle registration).

export const SETUP_DOCS = [
    { type: "CNIC_FRONT", title: "CNIC Front", hint: "The front of your ID card", icon: "IdCard", needsExpiry: false },
    { type: "CNIC_BACK", title: "CNIC Back", hint: "The back of your ID card", icon: "IdCard", needsExpiry: false },
    { type: "DRIVING_LICENSE", title: "Driving License", hint: "Your valid driving license", icon: "Car", needsExpiry: true },
    { type: "VEHICLE_REGISTRATION", title: "Vehicle Registration", hint: "Your vehicle registration book or card", icon: "FileText", needsExpiry: true },
];

export const SETUP_STEPS = [
    { id: "documents", label: "Documents", title: "Upload your documents" },
    { id: "vehicle", label: "Vehicle", title: "Add your vehicle" },
    { id: "review", label: "Review", title: "Review and submit" },
    { id: "approval", label: "Approval", title: "We are checking" },
];

export const DOC_STATUS_TEXT = {
    NONE: "Not uploaded yet",
    UPLOADED: "Uploaded — being checked",
    APPROVED: "Approved",
    REJECTED: "Not accepted — upload again",
};

export const VEHICLE_CHOICES = [
    { id: "BIKE", label: "Motorcycle", sub: "Bike", sprite: "/vehicles/bike-top.png" },
    { id: "RICKSHAW", label: "Rickshaw", sub: "Auto rickshaw", sprite: "/vehicles/rickshaw-top.png" },
    { id: "CAR_NON_AC", label: "Car", sub: "Without AC", sprite: "/vehicles/car-top.png" },
    { id: "CAR_AC", label: "Car with AC", sub: "Air conditioned", sprite: "/vehicles/car-top.png" },
];

export const COLOR_CHOICES = [
    { name: "White", hex: "#F4F5F2" },
    { name: "Black", hex: "#26282D" },
    { name: "Silver", hex: "#B9BEC4" },
    { name: "Grey", hex: "#8A8F96" },
    { name: "Red", hex: "#C8312E" },
    { name: "Blue", hex: "#2C5FB8" },
    { name: "Green", hex: "#1E7A4C" },
    { name: "Yellow", hex: "#E2B528" },
];

export const EMPTY_VEHICLE_FORM = {
    vehicleType: "",
    registrationNumber: "",
    make: "",
    model: "",
    color: "",
    modelYear: "",
};

// Same rules the existing My Vehicles screen applies before it posts.
export function validateVehicleForm(form) {
    if (!form.vehicleType) return "Choose what you drive.";

    const registrationNumber = form.registrationNumber.trim().toUpperCase();
    if (!/^[A-Z0-9 -]{4,20}$/.test(registrationNumber)) {
        return "Enter a valid vehicle registration number.";
    }

    if (
        form.modelYear &&
        (!Number.isSafeInteger(Number(form.modelYear)) ||
            Number(form.modelYear) < 1950 ||
            Number(form.modelYear) > new Date().getFullYear() + 1)
    ) {
        return "Enter a valid model year.";
    }

    return "";
}
