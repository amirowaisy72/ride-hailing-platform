// Phase 3 (A12) — tutorial-guide progress, per user, on-device.
//
// For each service guide we track:
//   completions — how many times the user finished that service's
//                 real flow (ride booked, request created, ...).
//   guideViews  — how many times the guide itself was shown.
//
// Maturity rule (Amir's requirement): the guide offers itself
// automatically only while the user is still new to the service —
// once the real flow has been completed TWICE the guide stops
// auto-appearing. A manual "Guide" replay button stays available
// forever. Records live in localStorage keyed by user id so two
// people sharing one phone keep separate progress; guests fall
// under a shared "guest" bucket.

const MATURITY_COMPLETIONS = 2;

function storageKey(userId) {
    return `safar-guides-v1:${userId || "guest"}`;
}

function readAll(userId) {
    try {
        const raw = window.localStorage.getItem(storageKey(userId));
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeAll(userId, data) {
    try {
        window.localStorage.setItem(storageKey(userId), JSON.stringify(data));
    } catch { /* storage full/blocked — guides degrade to session-only */ }
}

export function getGuideProgress(userId, serviceId) {
    const all = readAll(userId);
    const entry = all[serviceId] || {};
    return {
        completions: Number(entry.completions) || 0,
        guideViews: Number(entry.guideViews) || 0,
    };
}

/** True while the guide should still offer itself automatically. */
export function isGuideImmature(userId, serviceId) {
    return getGuideProgress(userId, serviceId).completions < MATURITY_COMPLETIONS;
}

export function recordGuideView(userId, serviceId) {
    const all = readAll(userId);
    const entry = all[serviceId] || {};
    entry.guideViews = (Number(entry.guideViews) || 0) + 1;
    all[serviceId] = entry;
    writeAll(userId, all);
}

/** Call at the success point of a service's real flow. */
export function recordFlowCompletion(userId, serviceId) {
    const all = readAll(userId);
    const entry = all[serviceId] || {};
    entry.completions = (Number(entry.completions) || 0) + 1;
    all[serviceId] = entry;
    writeAll(userId, all);
}

export { MATURITY_COMPLETIONS };
