"use client";

import { MessageCircle, Phone } from "lucide-react";

// Single source for Safar support contact details, shown on both the
// passenger and driver account screens so users can reach support
// directly instead of only filing a complaint.
export const SUPPORT_CALL_NUMBER = "03160609994";
export const SUPPORT_WHATSAPP_NUMBER = "03100668952";

export default function SupportContact() {
    return (
        <div className="space-y-3 border-b py-4">
            <p className="text-sm font-semibold">Contact Support</p>

            <a
                href="tel:+923160609994"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087F5B] font-bold text-white"
            >
                <Phone size={18} />
                Call Support: {SUPPORT_CALL_NUMBER}
            </a>

            <a
                href="https://wa.me/923100668952"
                target="_blank"
                rel="noreferrer"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#087F5B] font-bold text-[#087F5B]"
            >
                <MessageCircle size={18} />
                WhatsApp: {SUPPORT_WHATSAPP_NUMBER}
            </a>
        </div>
    );
}
