import {
    Banknote, Camera, CarFront, CheckCircle2, ClipboardCheck, Flag, Hourglass,
    KeyRound, MapPin, Navigation, Package, PackageCheck, ShoppingBag, ShoppingCart,
    Store, Truck, UserCheck,
} from "lucide-react";

/**
 * Plain-language journey for every driver service. One source of truth for
 * the guide ("how it works") and for the one-step-per-screen job flows.
 * Presentation only: statuses and APIs are the existing ones.
 */
export const JOURNEYS = {
    RIDE: {
        label: "Rides", full: "Passenger Rides", Icon: CarFront,
        blurb: "Carry passengers and earn on every trip.",
        turnOn: "Switch Rides on from My Services. You can switch it off any time.",
        receive: "A big card appears with the pickup, destination and fare. Press Accept or Decline.",
        finish: "Drive to the destination and press Complete trip. The fare is added to your earnings.",
        jobHref: "/driver",
        jobNoun: "ride",
    },
    PARCEL: {
        label: "Parcels", full: "Parcel Delivery", Icon: Package,
        blurb: "Carry parcels from one place to another.",
        turnOn: "Switch Parcels on from My Services. Your vehicle and papers must be approved.",
        receive: "Open Parcel requests. Each card shows where from, where to and the fare. Press Accept.",
        finish: "Pick up with the sender's code, deliver with the receiver's code. Then you are paid.",
        jobHref: "/driver/parcels",
        jobNoun: "delivery",
    },
    BUY_DELIVER: {
        label: "Buy & Deliver", full: "Buy & Deliver", Icon: ShoppingBag,
        blurb: "Shop for a customer and bring it to their door.",
        turnOn: "Switch Buy & Deliver on. You must accept the shopping policy once.",
        receive: "Open Buy & Deliver requests. Send your delivery fee. The customer picks you.",
        finish: "Buy, send the bill, deliver, and collect the shopping money back. It is not your earnings.",
        jobHref: "/driver/tasks",
        jobNoun: "shopping order",
    },
    RENTAL: {
        label: "Rentals", full: "Rental Business", Icon: Store,
        blurb: "Rent out your car to customers.",
        turnOn: "Apply once as a rental partner, add your car, then switch it available.",
        receive: "A booking request arrives. Look at the dates and the fee. Press Accept.",
        finish: "Hand over the car with the pickup code. When it returns, check it and confirm.",
        jobHref: "/driver/rentals",
        jobNoun: "booking",
    },
};

export const SERVICE_KEYS = ["RIDE", "PARCEL", "BUY_DELIVER", "RENTAL"];

const STEPS = {
    PARCEL: {
        DRIVER_ASSIGNED: [1, Truck, "Go to the pickup", "Press the button when you start driving to the sender."],
        DRIVER_EN_ROUTE: [2, Navigation, "Drive to the pickup", "Follow the map. Press the button when you reach the sender."],
        ARRIVED_AT_PICKUP: [3, KeyRound, "Collect the parcel", "Ask the sender for the 6-digit code and type it in."],
        PICKED_UP: [4, PackageCheck, "Parcel is with you", "Press the button to start driving to the receiver."],
        OUT_FOR_DELIVERY: [5, Flag, "Deliver the parcel", "Hand it over. Ask the receiver for the 6-digit code and type it in."],
        total: 5,
    },
    BUY_DELIVER: {
        DRIVER_SELECTED: [1, ShoppingCart, "Go to the shop", "Press the button when you reach the shop and start shopping."],
        SHOPPING: [2, ShoppingBag, "Buy the items", "Buy what the customer asked for. Then send the total price."],
        AWAITING_APPROVAL: [3, Hourglass, "Wait for the customer", "The customer must say OK to the price before you pay."],
        PURCHASE_APPROVED: [4, Camera, "Pay and confirm", "Pay the shop, take a photo of the receipt, and confirm."],
        PURCHASED: [5, Truck, "Go to the customer", "Press the button to start delivering."],
        OUT_FOR_DELIVERY: [5, Navigation, "Drive to the customer", "Follow the map. Press the button when you arrive."],
        ARRIVED: [6, Banknote, "Hand over and collect money", "Give the items. Ask for the code and collect the shopping money."],
        total: 6,
    },
    RENTAL: {
        REQUESTED: [1, ClipboardCheck, "New booking request", "Check the dates and fee. Accept or reject."],
        PROVIDER_ACCEPTED: [2, Hourglass, "Waiting for payment", "The customer is paying. You do not need to do anything yet."],
        PAYMENT_PENDING: [2, Hourglass, "Waiting for payment", "The customer is paying. You do not need to do anything yet."],
        CONFIRMED: [3, KeyRound, "Hand over the car", "Check the customer. Ask for their pickup code and type it in."],
        PICKUP_VERIFIED: [4, Truck, "Start the rental", "Take a photo of the car, then press the button to start."],
        RENTAL_ACTIVE: [4, Navigation, "Rental is running", "The customer has your car. Nothing to do until it comes back."],
        RETURN_PENDING: [5, UserCheck, "Check the returned car", "Look at the car, take photos and confirm the return."],
        total: 5,
    },
};

export function describeJobStep(service, status) {
    const table = STEPS[service];
    const row = table?.[status];
    if (!row) return null;
    const [step, Icon, title, hint] = row;
    return { step, total: table.total, Icon, title, hint };
}

export const END_STATES = {
    PARCEL: { done: ["DELIVERED"], stopped: ["CANCELLED", "FAILED"] },
    BUY_DELIVER: { done: ["DELIVERED", "COMPLETED"], stopped: ["CANCELLED", "DISPUTED"] },
    RENTAL: { done: ["COMPLETED"], stopped: ["CANCELLED", "NO_SHOW", "DISPUTED"] },
};

export { CheckCircle2, MapPin };
