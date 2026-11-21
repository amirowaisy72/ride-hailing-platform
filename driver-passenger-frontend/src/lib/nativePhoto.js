// Native photo picking for the installed (Capacitor Android) app.
//
// Why this exists — Safar upload-reload bug (reported 2026-11-22):
// document and photo uploads used a plain HTML <input type="file">.
// Tapping it opens the Android system photo picker as a separate
// activity; Android can destroy the app's WebView activity while the
// picker is open, the WebView reloads to the Safar splash screen, and
// the chosen File — held only in React state — is lost. Every upload
// failed on the first try and only succeeded after repeated retries.
//
// The Capacitor Camera plugin fixes this two ways:
//  1. Its calls go through the Capacitor bridge, which saves pending
//     plugin calls across activity recreation, so the picked photo is
//     still delivered when the activity is rebuilt.
//  2. If the OS kills the whole app process while the picker/camera
//     is open, the result is delivered after relaunch through the App
//     plugin's `appRestoredResult` event. The plugin copies picked
//     photos into the app cache, so the file is still there after a
//     restart — see installPhotoRestoreListener() and the pending-pick
//     record below. Pick screens consume a restored photo on mount via
//     consumeRestoredPhotos().
//
// On a plain web browser (not the installed app) everything falls back
// to the normal <input type="file"> — the callers keep their hidden
// input and only use this helper when useIsNative() is true.
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

const PENDING_PICK_KEY = "safar-pending-photo-pick";
const RESTORED_PHOTO_KEY = "safar-restored-photo";
// A pick that started more than a day ago is stale — never deliver it.
const PICK_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export function isNative() {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
}

// False on the first render (matches the prerender), true after mount
// on the installed app. Never call Capacitor at render time — the
// prerender has no window and the value would mismatch on hydration.
export function useIsNative() {
    const [native, setNative] = useState(false);
    useEffect(() => {
        setNative(isNative());
    }, []);
    return native;
}

export function isPickerCancelled(err) {
    return (
        !!err &&
        (err.cancelled === true || /cancel/i.test(String(err.message || err)))
    );
}

function cancelledError() {
    const err = new Error("Photo picking cancelled.");
    err.cancelled = true;
    return err;
}

function readJson(key) {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeJson(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage full/blocked — the pick still works, only the
        // killed-process resume is lost.
    }
}

function removeKey(key) {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // Ignore.
    }
}

// Written BEFORE the native picker/camera opens, so that if the OS
// kills the app while it is open we still know which upload slot the
// photo belongs to when the result comes back via appRestoredResult.
function setPendingPick(context) {
    writeJson(PENDING_PICK_KEY, { ...context, startedAt: Date.now() });
}

function clearPendingPick() {
    removeKey(PENDING_PICK_KEY);
}

function readPendingPick() {
    const record = readJson(PENDING_PICK_KEY);
    if (!record || Date.now() - (record.startedAt || 0) > PICK_TTL_MS) {
        return null;
    }
    return record;
}

const MIME_BY_FORMAT = {
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
};

const EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
};

function mimeFromFormat(format) {
    return MIME_BY_FORMAT[String(format || "").toLowerCase()] || "";
}

async function mediaToFile(media, index) {
    const format = media?.metadata?.format || media?.format || "";
    const size = media?.metadata?.size;
    if (size && size > MAX_PHOTO_BYTES) {
        throw new Error("Maximum file size is 10 MB.");
    }
    // webPath is a localhost URL served by Capacitor's file server;
    // uri (file://) goes through convertFileSrc to the same server.
    const url =
        media?.webPath ||
        (media?.uri ? Capacitor.convertFileSrc(media.uri) : "");
    if (!url) {
        throw new Error("Could not read the selected photo — please try again.");
    }
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error("Could not read the selected photo — please try again.");
    }
    const blob = await res.blob();
    const type = blob.type || mimeFromFormat(format) || "image/jpeg";
    if (blob.size > MAX_PHOTO_BYTES) {
        throw new Error("Maximum file size is 10 MB.");
    }
    const ext = EXT_BY_MIME[type] || "jpg";
    return new File([blob], `photo-${Date.now()}-${index}.${ext}`, { type });
}

// takePhoto returns one MediaResult; chooseFromGallery returns
// { results: [...] }; the deprecated getPhoto/pickImages return a
// Photo / { photos: [...] }. Normalise them all to an array.
function normalizeResults(data) {
    if (!data) return [];
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.photos)) return data.photos;
    return [data];
}

async function mediaResultsToFiles(results) {
    const files = [];
    for (let i = 0; i < results.length; i++) {
        files.push(await mediaToFile(results[i], i));
    }
    return files;
}

// Pick photos from the gallery through the native plugin.
// Returns File[] (empty only if the user picks nothing — the plugin
// rejects on cancel). Throws on cancel (err.cancelled === true) and
// on any real failure.
export async function pickGalleryPhotos({ limit = 1, pending } = {}) {
    const { Camera, MediaTypeSelection } = await import("@capacitor/camera");
    setPendingPick(pending || {});
    try {
        const out = await Camera.chooseFromGallery({
            mediaType: MediaTypeSelection.Photo,
            allowMultipleSelection: limit > 1,
            limit: limit > 1 ? limit : 0,
            quality: 85,
            correctOrientation: true,
            editable: "no",
            includeMetadata: true,
        });
        clearPendingPick();
        const files = await mediaResultsToFiles(out?.results || []);
        return files.slice(0, limit);
    } catch (err) {
        clearPendingPick();
        if (isPickerCancelled(err)) throw cancelledError();
        throw err;
    }
}

// Take a new photo with the camera through the native plugin.
// Returns one File. Throws on cancel (err.cancelled === true).
export async function takeCameraPhoto({ pending } = {}) {
    const { Camera } = await import("@capacitor/camera");
    setPendingPick(pending || {});
    try {
        const out = await Camera.takePhoto({
            quality: 85,
            correctOrientation: true,
            saveToGallery: false,
            editable: "no",
            includeMetadata: true,
        });
        clearPendingPick();
        const [file] = await mediaResultsToFiles([out]);
        return file;
    } catch (err) {
        clearPendingPick();
        if (isPickerCancelled(err)) throw cancelledError();
        throw err;
    }
}

// --- Killed-process resume (layer 2) ---------------------------------
// If the OS terminates the app while the picker/camera is open, the
// in-flight plugin promise is gone. Capacitor stores the delivered
// result and replays it as an `appRestoredResult` event once a
// listener subscribes after relaunch. We record the raw result here
// (small JSON — the photo bytes stay in the app cache) and the pick
// screen that owns the slot converts it to Files on mount.
let restoreListenerInstalled = false;

export async function installPhotoRestoreListener() {
    if (restoreListenerInstalled || typeof window === "undefined") return;
    if (!isNative()) return;
    restoreListenerInstalled = true;
    try {
        const { App } = await import("@capacitor/app");
        await App.addListener("appRestoredResult", (event) => {
            void handleRestoredResult(event);
        });
    } catch {
        restoreListenerInstalled = false;
    }
}

async function handleRestoredResult(event) {
    try {
        if (!event || event.pluginId !== "Camera" || !event.success) return;
        if (
            !["takePhoto", "chooseFromGallery", "getPhoto", "pickImages"].includes(
                event.methodName
            )
        ) {
            return;
        }
        const pending = readPendingPick();
        if (!pending?.flow || !pending?.key) return;
        const results = normalizeResults(event.data);
        if (!results.length) return;
        writeJson(RESTORED_PHOTO_KEY, {
            flow: pending.flow,
            key: pending.key,
            results,
            savedAt: Date.now(),
        });
        clearPendingPick();
    } catch {
        // A failed restore must never break the app.
    }
}

// Called by a pick screen on mount. Returns the restored Files for
// this exact (flow, key) slot, or null. Safe to call on every mount:
// it returns immediately when no pick was in flight for this slot.
export async function consumeRestoredPhotos(flow, key) {
    if (typeof window === "undefined" || !flow || !key) return null;
    const pending = readPendingPick();
    const hasPendingForSlot =
        pending && pending.flow === flow && pending.key === key;
    const record = readJson(RESTORED_PHOTO_KEY);
    if (!hasPendingForSlot) {
        // The listener may already have stored the result before this
        // screen mounted — deliver it without waiting.
        if (!record || record.flow !== flow || record.key !== key) return null;
        return finishConsume(record);
    }
    // A pick was in flight when the app died: give the stored
    // restored result a moment to arrive after subscribing.
    await installPhotoRestoreListener();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const fresh = readJson(RESTORED_PHOTO_KEY);
    if (!fresh || fresh.flow !== flow || fresh.key !== key) return null;
    return finishConsume(fresh);
}

async function finishConsume(record) {
    removeKey(RESTORED_PHOTO_KEY);
    clearPendingPick();
    if (Date.now() - (record.savedAt || 0) > PICK_TTL_MS) return null;
    try {
        const files = await mediaResultsToFiles(record.results || []);
        return files.length ? files : null;
    } catch {
        return null;
    }
}

// Install as early as the bundle loads on native, so a result
// delivered on relaunch is captured even before any screen mounts.
if (typeof window !== "undefined") {
    void installPhotoRestoreListener();
}
