// Chat deep links (T-16/T-17): one place builds the "open this
// conversation" URL used by the in-app chat alerts and by push
// notification tap routing. The order/booking detail pages honour
// ?chat=open (and, for passenger Buy & Deliver, ?conversationId=).

export function chatDetailsPath(role, orderType) {
    if (orderType === "RENTAL") {
        return role === "DRIVER"
            ? "/driver/rentals/bookings/details"
            : "/passenger/rentals/bookings/details";
    }
    return role === "DRIVER"
        ? "/driver/buy-deliver/details"
        : "/passenger/buy-deliver/details";
}

export function chatDeepLink(role, orderType, orderId, conversationId) {
    const params = new URLSearchParams({ id: String(orderId || ""), chat: "open" });
    if (conversationId) params.set("conversationId", String(conversationId));
    return `${chatDetailsPath(role, orderType)}?${params.toString()}`;
}
