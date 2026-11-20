// Version of THIS codebase — the next release after Play 1.0.7
// (versionCode 9). Sent as X-App-Version-Code on every API request
// so the backend can enforce new-version-only rules without breaking
// older apps: a client that sends no version header is treated as
// an old client and keeps the old behaviour.
export const APP_VERSION_NAME = "1.0.8";
export const APP_VERSION_CODE = 10;
