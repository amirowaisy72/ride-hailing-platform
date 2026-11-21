// Version of THIS codebase — the next release after Play 1.0.8
// (versionCode 10). Sent as X-App-Version-Code on every API request
// so the backend can enforce new-version-only rules without breaking
// older apps: a client that sends no version header is treated as
// an old client and keeps the old behaviour.
export const APP_VERSION_NAME = "1.0.9";
export const APP_VERSION_CODE = 11;
