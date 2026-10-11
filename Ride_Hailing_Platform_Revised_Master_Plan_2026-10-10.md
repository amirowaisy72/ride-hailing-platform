# RIDE-HAILING PLATFORM
## Revised Master Technical Plan & Development Status
**Version:** 2.0 | **Baseline date:** 10 October 2026 | **Product:** Pakistan-first, inDrive-style passenger and driver platform

**Purpose.** This is the new single working reference for scope, architecture, completed work, verification, blockers, implementation sequence and release gates. It reconciles the supplied original 61-section plan with decisions and implementation evidence recorded during development. It is not a certification that the platform is production ready.

**Status key:** **IMPLEMENTED** = code/UI exists based on development history; **TESTED** = a specific test or walkthrough was reported PASS; **PARTIAL** = working slice exists but integration/robustness missing; **PLANNED** = not demonstrated; **BLOCKED** = must be fixed before next dependent feature or production activation. A PASS applies to the described checkpoint only, not the whole product.

## 1. Executive status at handoff

**Current phase:** Phase 9 — Financial Safety & Settlement Recovery, paused on user-requested break. **STOP / DO NOT EXECUTE:** automatic settlement processing, live/manual settlement batch endpoints, or production wallet mutations pending recovery fixes and finance release review.

**Verified checkpoints:** Admin driver listing and document-review UI reported PASS; vehicle registration → admin review → active selection reported PASS; Admin Overview/Passengers/Rides frontend build reported PASS; MongoDB isolated test connection verified; six wallet-top-up assertions passed; six commission-settlement assertions passed; combined 12/12 regression passed with exit code 0. These do not prove full end-to-end ride lifecycle, payment verification, security, or mobile release readiness.

**Critical paused change:** In `backend/src/services/commissionSettlementService.js`, a guard rejecting pre-existing non-SETTLED `RideSettlement` documents was replaced with a comment in Step 478; user said Done. That edit **is incomplete and unsafe as a final recovery implementation**: the code later still calls `RideSettlement.create()` for the same unique `rideId`. Before any settlement processor runs, confirm the current local file, restore a safe guard or finish transactional retry/reconciliation logic, and run dedicated regression. Do not assume the earlier guard was successfully restored.

**Known technical debt:** Mongoose `findOneAndUpdate(...,{new:true})` emits deprecation warnings (prefer `returnDocument:'after'` after regression); test cleanup and concurrency recovery need deeper failpoint tests; many admin data views are read-only; UI access and backend authorization are not by themselves adequate production hardening.

## 2. Product definition and non-negotiable business rules

- **Geography:** selected Pakistan cities/geofenced service areas, expanded administratively rather than hardcoded city name checks; PKR only for initial release.
- **Passenger payment:** cash paid directly to driver; **no passenger card checkout / passenger wallet** in the initial release.
- **Driver finance:** prepaid platform wallet, ledger-based, admin-controlled commission on valid completed trips; no debit twice for one ride; use MongoDB replica-set transactions, unique constraints, reconciliation and audit.
- **Vehicles (fixed canonical enum):** `BIKE`, `RICKSHAW`, `CAR_AC`, `CAR_NON_AC`. Retire original provisional `STANDARD` and `PREMIUM` examples unless explicitly reintroduced as new categories. Vehicle and driver require independent approval.
- **Ride pricing:** show route length/time and admin-configured price guidance; passenger negotiates and drivers bid; server validates authoritative fare/ownership/state.
- **Route:** multiple intermediate stops must be supported in the core target product, re-orderable with stop count, wait-time charges and total traversed-route distance/price configured by admin. **Not implemented yet.**
- **Admin-first control:** all changeable business policy should be persisted and auditable—city/service area, vehicle eligibility, fees, matching radii, bid expiry, cancellations, commissions, wallet thresholds, Cloudinary/payment/maps provider choices and integration feature flags; not every possible setting can safely be edited dynamically without redeployment.
- **Mobile target:** native-feeling Android/iOS apps via Capacitor, with real background GPS, native permission handling, push, camera, secure credential storage, deep links and offline/reconnection behavior. UI prototypes do not equal native release readiness.
- **Technology discipline:** JavaScript (not TypeScript), Next.js App Router, Tailwind, React Context; Express/Mongoose REST; separate Socket.IO service; MongoDB source of truth; Redis/BullMQ worker added where needed. No Redux/Zustand/TanStack Query by default.
- **Launch principle:** strong transaction correctness and legal/privacy/security protections before public deployment, while minimizing infrastructure spend.

## 3. Actual repository & environments

```text
G:\Web Apps\ride-hailing-platform\
  backend/                  Express/Mongoose REST service; local port 5000
  websocket-server/         Socket.IO authenticated events; local port 5001
  driver-passenger-frontend/ Next.js passenger + driver UI; local port 3000
  admin-dashboard/          Separate Next.js admin app; local port 3001
  worker/                   Scaffold/placeholder; BullMQ jobs not demonstrated
  shared/                   Scaffold/placeholder
```

**Windows PowerShell:** `npm.cmd` and `npx.cmd` used where policy blocks ordinary shims. Backend startup used `npx.cmd nodemon src/server.js`; admin dev on 3001. Exact deployed infrastructure has not been confirmed. Backend MongoDB Atlas replica-set transactions were reported supported.

**Known paths:** `backend/src/server.js`; `backend/src/services/{adminWalletTopUpService,commissionSettlementService,pendingSettlementService,driverWalletService,financialReconciliationService}.js`; `backend/scripts/{runFinancialTests,financialTestGuard,financialTopUpTests,financialCommissionTests}.js`; `admin-dashboard/src/app/dashboard/{drivers,vehicles,passengers,rides,wallets,settlements,commission}/page.js`; `driver-passenger-frontend/src/app/{passenger,driver}/...`. Actual filesystem architecture may be narrower than original aspirational folder tree.

## 4. Architecture: current and target

```text
Passenger/Driver Capacitor WebView (Next.js static-export target)
     | HTTPS REST              | authenticated Socket.IO
     v                         v
Express API (authority)   Separate Socket.IO service
     |       |                  | internally authenticated events
     |       +------------------+
     v
MongoDB Atlas replica set (users, rides, offers, docs, settings, finance)
     |
     +-- Cloudinary (authenticated driver docs / signed time-limited preview)
     +-- Maps / OSRM routing and location search
     +-- Email verification OTP
     +-- [Future] Redis + BullMQ worker, FCM/APNs, payments verification

Admin Next.js dashboard → authenticated REST APIs → backend.
```

Only backend/database transactions may determine authoritative ride assignment, wallet balances, commissions and status changes. Socket.IO transports notifications and movement updates; it is not a financial or ride truth source. Rate-limit, log and authenticate all boundaries.

## 5. Implemented product slices and evidence

| Domain | Status | What exists / evidence | Remaining or caveat |
|---|---|---|---|
| Auth, roles, OTP | IMPLEMENTED | Email/password, email OTP, login, JWT refresh rotation/logout, DRIVER/PASSENGER/ADMIN backend guards | OTP abuse/rate-limit/refresh concurrency and native secure storage verification |
| Passenger map booking | PARTIAL | Pickup/destination, location search, OSRM routing, estimated price, fare offer, driver bids/choice, ride states, map UI | Comprehensive lifecycle/race/GPS validation, offline recovery, multi-stops |
| Driver booking | PARTIAL | Driver map hub, GPS/online status, new requests, bidding, arrival/start/complete actions | Real-device background tracking, race tests, support/cancellation policy |
| Driver verification | TESTED (UI checkpoint) | Cloudinary-backed docs, admin signed image preview/review, four required docs before driver approval, admin list | Full audit, document lifecycle, enforcement for already-approved drivers |
| Vehicles | TESTED (workflow checkpoint) | Driver registration, My Vehicles, admin approve/reject, selected approved vehicle | Ownership rules, document–vehicle linkage, approval safeguards, revocation scenarios |
| Profiles/trips/receipts | PARTIAL | Driver/passenger account and histories, passenger receipt/review, driver earnings/wallet views, limited profile edit | Complete editable profiles, detailed receipt policy, passenger rating by driver |
| Real-time | PARTIAL | Dedicated Socket.IO JWT rooms, driver updates, offers, trip state events and REST recovery hooks | Reconnect/replay/idempotent event delivery, chat, push |
| Service areas/pricing | PARTIAL | Backend service areas and vehicle-pricing endpoints/model exist | Complete admin visual polygon editor/config UI, strict route checks, multi-stop tariff |
| Admin ops | TESTED (UI build) | Drivers/documents, Vehicles, Overview, Passengers, Rides, Wallets, Settlements, Commission pages | Many read-only; aggregate correctness, permissions, action logging and UI tests |
| Financial top-up | TESTED (isolated 6 tests) | Transactional service with idempotency, ledger and conditional balance update | Admin payment verification workflow, concurrency/failpoint tests, authorization/audit |
| Commission settlement | TESTED (isolated 6 tests), BLOCKED for runtime activation | Single-settlement tests, ledger, transaction, duplicate/concurrent invariants | Step 478 incomplete change; pending/failed retry model and reconciliation |
| Android/iOS | PLANNED/PARTIAL | Capacitor-oriented frontend/plugins groundwork | Native signed builds, permissions, GPS in background, push, store compliance |
| Worker/Redis/BullMQ | PLANNED | Directories only; original architecture designed | Real queues, retries, dead-letter, monitoring |
| Support, disputes, chat, push | PLANNED | None verified complete | Build and E2E validate |
| Production deploy | PLANNED | Local development + Atlas known | Infrastructure, CI/CD, backups, observability, incident handling |

## 6. Definitive ride and identity journeys

### Passenger lifecycle
Register → verify email → sign in → check service area → select pickup / zero or more intermediate stops / destination → calculate full-route time and distance → choose one of four vehicle types → see admin-derived suggestion → submit offer → discover eligible nearby drivers → receive validated bids → inspect driver rating/vehicle → atomically select one → ETA/live map updates → driver arrival → start → finish → direct cash payment → passenger rating, history and receipt. **Multi-stops and several reliability stages remain target requirements, not completed implementation.**

### Driver lifecycle
Register/verify → profile → upload required CNIC front/back, driving licence and registration documents → admin review → add vehicle → admin approval → select approved vehicle → ensure minimum wallet balance → online GPS → bid or accept → travel/arrive/start/complete → fare collected in cash → commission transaction settles from wallet → earnings, ledger and disputes. Prevent online status when driver or active vehicle loses approval.

### Admin lifecycle
Sign in with ADMIN role → operational counters → approve/reject documents and drivers → verify vehicles → view passengers/rides → configure geofences, fares, thresholds, commissions and other policies → verify an externally paid top-up before **idempotent** credit → monitor settlement and reconciliation → handle disputes, policy overrides and audited actions.

## 7. Ride, vehicle and finance state contracts

**Ride states in current schema:** `REQUESTED`, `SEARCHING`, `BIDDING`, `DRIVER_SELECTED`, `DRIVER_EN_ROUTE`, `DRIVER_ARRIVED`, `TRIP_STARTED`, `TRIP_COMPLETED`, with `CANCELLED`, `EXPIRED`, `REASSIGNING`. State transitions must be actor-validated and atomic. Avoid inventing alternate `COMPLETED` status strings.

**Driver verification:** PENDING / UNDER_REVIEW / APPROVED / REJECTED (and suspension if modeled). Vehicle has independent PENDING / APPROVED / REJECTED; driver may select only eligible approved vehicle while offline.

**Wallet model observed:** unique `driverId`; integer PKR `balance`, `totalTopUps`, `totalCommission`; `WalletTransaction` type `TOP_UP`, `COMMISSION_DEBIT`, `REFUND`, `ADMIN_ADJUSTMENT`, unique `idempotencyKey`; partial unique index for `rideId + COMMISSION_DEBIT`. Commission settings GLOBAL percentage + `minimumWalletBalance` + `isActive`. Ride settlement unique rideId and PENDING / SETTLED / FAILED.

**Finance invariant:** Never change a driver's balance without a corresponding verified and durable ledger entry, and vice versa; no double credit or double commission debit; failure must roll back or enter a recoverable, audited state. Commission amount integer PKR based on fare and basis points; clearly define rounding, refunds, negative adjustments, zero commission and changed policy at completion time.

**Critical retry defect (paused):** existing `processPendingSettlements` selects completed rides with `PENDING|FAILED` and attempts <5, calls `settleRideCommission`, catches exceptions and increments attempts/marks FAILED. However, old commission service refuses existing non-SETTLED `RideSettlement`; subsequent Step 478 removed that refusal without updating create-only write. This mismatch must be repaired with transactional semantics before executing the pending processor. A failure record may not exist for most failed transactions because the failed transaction rolls back; document the canonical retry state, stop policy and operator reconciliation.

## 8. API contract: real paths over original draft

API prefix is `/api/v1`. Prefer existing implemented routes; the original plan included proposed endpoints that are not authoritative.

**Examples confirmed in development:** `POST/GET /drivers/me/vehicles`, `PATCH /drivers/me/vehicles/active`; `GET /admin/vehicles`, `PATCH /admin/vehicles/:vehicleId/review`; `GET /admin/drivers`, `GET /admin/drivers/:id/documents`, `GET /admin/drivers/documents/:documentId/view`, `PATCH /admin/drivers/documents/:documentId/review`, `PATCH /admin/drivers/:id/status`; `GET /admin/operations/overview`, `GET /admin/operations/passengers`, `GET /admin/operations/rides`; `GET/PUT /admin/commission` (as previously built); `GET /rides/history`, `GET /rides/:id/receipt`, `POST /rides/:id/review`; GET driver wallet/earnings/history endpoints. Financial administrative mutation endpoints exist but should remain unexercised until safeguards and verified payments are ready.

Actual endpoint payloads must be verified against current route/controller code before documenting as stable public/mobile contracts. Use semantic versioning and a generated OpenAPI contract eventually. Note original `/users/me`, `/wallet/*`, `/offers/:id/*` examples may differ from implemented routes such as `/account/me`, `/drivers/me/wallet` and nested rides offers.

## 9. Maps, pricing and multi-stop route (revised priority)

- Retain low-cost map strategy but isolate provider behavior for fallback and future pricing changes. OSRM routing used in current UI/backend integration; do not assume unlimited public routing capacity in production.
- Treat coordinates as `[longitude,latitude]` GeoJSON, validate locations server-side, defend against impossible routes, area exits and GPS spoofing.
- **Multi-stop target architecture:** persist ordered `stops[]` with stable IDs and locations; enable passenger reorder before request; route service calculates pickup→stops→destination segments; quote from total traveled route distance + base + vehicle/km/min tariffs + stop fees/wait allowance; enforce admin-defined maximum stops and per-stop dwell rules. Lock/renegotiate fare if stops are edited after acceptance.
- Bidding must be bound to a quote/route revision so stale driver offers cannot be accepted after price/stops change.
- Preserve completed trip route snapshot in receipt and settlement inputs.
- Admin: geofence polygon map edit and validation; tariff per city/vehicle; min/max negotiable bid; price suggestions; provider selection and graceful degradation.

## 10. Admin-first settings inventory

| Settings domain | Desired admin controls | Current evidence |
|---|---|---|
| Commission and minimum wallet | GLOBAL rate, threshold, audit/effective date | Commission UI/backend present; advanced lifecycle missing |
| Fleet eligibility | Four canonical vehicle categories; driver/vehicle approval and revocation | Core approval/UI present |
| Geography | Cities, GeoJSON polygons, active/inactive, boundary rules | Backend area routes; full dashboard/editor pending |
| Pricing | Base fare, per-km/per-minute, min offer, vehicle coefficients, wait/stop fee, surge policy | VehiclePricing model/backend; full UI/stop pricing pending |
| Matching | Search radius tiers, expiry, max offers, prioritization/availability | Logic partially present; controls and race tests pending |
| Ride governance | Cancellation/no-show, request expiration, detour/wait limits | Planned |
| Payments/wallet | Provider methods, manual payment review, receipt upload, minimum wallet, top-up limits | Backend top-up service, read-only wallet UI; payment verification pending |
| Integrations | Maps, Cloudinary, notifications, SMTP/payment provider flags; encrypted credentials | Some integrations exist; safe self-service settings pending |
| Operations | Support roles, disputes, suspensions, safety, moderation, audit, alert thresholds | Planned |

Never expose provider secrets or encryption keys to browser. Integrations requiring deployment/runtime initialization may need staged rollout even when editable in admin.

## 11. Security, privacy, safety, and compliance release criteria

Role/ownership isolation; verified OTP/rate limiting; password hashing, short-lived access + rotated refresh tokens; secure native storage and session revocation; TLS and restrictive CORS; CSRF strategy when cookies introduced; API input schemas; file MIME/content validation and malware controls; signed time-limited CNIC preview; strict admin audit trail with immutable event references; privacy retention/deletion and data access policies; restricted credential separation for production/test; encrypted secrets; admin MFA, least privilege and break-glass procedures.

**Ride safety:** prevent driver double booking through atomic reservation, stale offer acceptance, spoofed coordinates and impossible journey; route lifecycle invariants; ability to suspend drivers and stop active bookings safely; driver/passenger reporting and emergency support flows; legal/regulatory checks by operating city and local counsel.

**Finance:** platform customer deposits or prepaid balances may trigger licensing/compliance obligations; clarify ledger accounting and manual bank/JazzCash/Easypaisa reconciliation before launch. Store proof and approval trail; never automatically credit based on an unverified screenshot. No real-money tests until explicit go-live acceptance.

## 12. Testing ledger and acceptance criteria

**Observed PASS (10 Oct 2026):**
- Wallet top-up tests 6/6: first credit PKR 250, same-key retry, same-key conflicting amount rejection, invalid amount, missing driver, single ledger entry.
- Commission tests 6/6: 10% of PKR 1000, duplicate settlement, insufficient balance, cancelled ride, simultaneous calls yielding one settlement/debit, ride/ledger consistency.
- Combined command `node scripts/runFinancialTests.js --run-topup --run-commission` returned 12/12 PASS, exit 0 against a database named `ride_hailing_financial_test`.
- UI/checkpoints for drivers/docs, vehicles, admin ops reported PASS.

**Unverified for release:** full E2E ride with two real devices and competing drivers, cross-device GPS/offline/background service, socket reorder/loss, recovery after crash between DB operations, retries of FAILED/PENDING settlement with existing document, idempotency across network retry and worker crash, top-up concurrent same/different keys, refund reversals, admin audit, strong test-isolation authorization, backups/restore, penetration tests, accessibility and native builds.

**Known warning:** `new` option deprecated in Mongoose on `findOneAndUpdate`; change to `returnDocument: 'after'` only with regression.

**Test isolation caution:** DB-name checks are not sufficient. Prefer truly separate Atlas test cluster and credentials incapable of modifying production. Current test harness inserts/deletes fixtures; do not run on production. On test failure, check for stranded fixtures without dropping collections.

## 13. Development phases: original-to-current execution roadmap

| Phase | Deliverable | Status | Exit gate |
|---|---|---|---|
| 1 | Repo structure and local backend/DB | IMPLEMENTED | Local start + Atlas transaction capability |
| 2 | User roles, authentication, OTP | IMPLEMENTED / PARTIAL QA | Auth/RBAC integration and abuse tests |
| 3 | Driver onboarding, Cloudinary docs and review | TESTED UI / PARTIAL QA | Actual ownership, revocation and doc auditing |
| 4 | Map, geofence, pricing, basic booking | PARTIAL | Verified real route/bid/area E2E |
| 5 | Driver matching, offers, sockets and ride states | PARTIAL | Concurrent bookings/reconnect E2E |
| 6 | Passenger/driver profiles, receipts, ratings, trip history | PARTIAL | Complete workflows and permission tests |
| 7 | Driver vehicles + admin verification | TESTED workflow | Fleet ownership/rejection/revocation tests |
| 8 | Admin operational pages and commission controls | TESTED UI build | Correct datasets, admin audit and role tests |
| **9** | **Transactional finance / retries / reconciliation** | **IN PROGRESS — PAUSED** | Recovery fixed, failpoints and full finance suite PASS |
| 10 | Multi-stop route + wait pricing + bid revision | PLANNED — core requirement | All route permutations/receipts correct |
| 11 | Complete admin settings + service-area editor | PLANNED/PARTIAL | UI-to-policy enforcement, encrypted/audited changes |
| 12 | Chat, push, support, disputes & safety | PLANNED | Android/iOS notification and support E2E |
| 13 | Worker, retries, monitoring, infrastructure | PLANNED | Queue recovery/dead letters/backups/alerts |
| 14 | Capacitor Android and iOS production behaviors | PLANNED/PARTIAL | Real-device permissions/background GPS/store builds |
| 15 | Full QA, security and controlled deployment | PLANNED | Release checklist signed off; no critical issues |

## 14. Resume instructions after break: precise and safe

1. **Freeze finance processor.** Do not run `/api/v1/admin/settlements/process` or schedule pending settlement jobs. Keep admin wallets read-only for now.
2. Open `backend/src/services/commissionSettlementService.js`. Identify the code after `if (existing?.status === 'SETTLED')`. **The earlier Step 478 deleted the rejection branch, without implementing an update/upsert branch**; assess the exact saved code before any further change. Restore a safe fail-closed guard if necessary while designing retry.
3. Reconcile `pendingSettlementService.js` with service behavior and `RideSettlement` unique `rideId` (existing PENDING/FAILED records; no-record retries; duplicate SETTLED; max attempts). Define a monotonic state machine and scoped atomic transaction with conflict retry semantics. Avoid silently converting FAILED to SETTLED without ledger verification.
4. Add isolated recovery tests: existing FAILED doc + no ledger; existing PENDING doc; existing SETTLED doc; wallet already debited + missing settlement (inconsistent anomaly, operator hold); retry crash; concurrent batch workers; insufficient wallet; max attempts; reconciliation flag/alert.
5. Re-run original 12/12 test suite plus new recovery tests, then separate deployment/ops and E2E tests. Only after independent verification decide on batch processor activation.

**Recommended next response in coding chat:** One complete `FIND → REPLACE` step for the verified local file, not an unreviewed instruction to remove a safety guard. One to three nearby edits per turn; estimate remaining phase effort; require PASS before moving phase.

**Effort estimate:** recovery implementation + tests: ~2–4 focused batches plus QA; broader product work spans multiple substantial phases. This estimate is approximate, not a delivery commitment.

## 15. Planned final release checklist

- [ ] All four vehicle categories supported under admin policy with full approval lifecycle
- [ ] Driver and passenger account/profile workflows complete and secure
- [ ] Live ride request, driver bidding, selection and double-booking protection validated
- [ ] Multiple re-orderable stops, transparent stop/wait fare adjustments and stored quote revisions
- [ ] Active service-area polygon validation on pickup, stops and destination
- [ ] Reliable foreground/background GPS on physical Android and iOS devices
- [ ] Push notifications, chat, contact/support and incident-response process
- [ ] Cash-handled receipts, cancellations, ratings (both directions), history and dispute evidence
- [ ] Admin editable fare, radius, expiry, commission, wallets, areas, integration settings
- [ ] Verified wallet top-up payment approvals with immutable audit and bank/provider reconciliation
- [ ] Settlement retries, concurrency, idempotency, reconciliation and alerts validated
- [ ] MongoDB migration/index checks, backups/restores and queue recovery
- [ ] TLS/CORS/RBAC/MFA/secrets/security testing/abuse prevention and local compliance
- [ ] CI build/test gates, crash reporting, logging, monitoring and incident playbooks
- [ ] Android/iOS signed store-build testing and staged controlled launch

**Release rule:** Mark an item complete only with explicit reproducible acceptance evidence. A compile/build PASS is not an end-to-end or production approval.

## 16. Original 61-section plan — traceability crosswalk

This table preserves the original headings, makes revision status explicit, and prevents unnoticed scope loss. **Mapped/partial** does not mean tested.

| Original # | Original section | Revised status | What changed / acceptance note |
|---:|---|---|---|
| 1 | Project Overview | IMPLEMENTED / REVISED | Pakistan cash/PKR/driver commission retained; production readiness unproven. |
| 2 | Main Technology Stack | IMPLEMENTED / REVISED | JS/Next/Express/Mongoose/Socket unchanged; Capacitor native and worker pending. |
| 3 | High-Level Architecture | IMPLEMENTED / REVISED | Six apps/directories exist; worker/shared are scaffolds. |
| 4 | Driver/Passenger Frontend | IMPLEMENTED / REVISED | One passenger/driver frontend implemented. |
| 5 | Frontend Folder Structure | PARTIAL / REVISED | Actual App Router routes differ from original proposed tree; account/trips/receipts/vehicles. |
| 6 | React Context Architecture | PARTIAL / REVISED | Auth Context is present; proposed full context list not verified. |
| 7 | Admin Dashboard | PARTIAL — UI TESTED | Admin pages and login exist; many modules still pending. |
| 8 | Backend | IMPLEMENTED / REVISED | REST/backend/models/services implemented broadly. |
| 9 | WebSocket Server | PARTIAL / REVISED | Authenticated Socket.IO events available; chat and resilience pending. |
| 10 | Worker | PLANNED | Redis/BullMQ implementation not demonstrated. |
| 11 | Redis | PLANNED | Temporary caching/rate-limiting via Redis not demonstrated. |
| 12 | Authentication | IMPLEMENTED / QA PENDING | Email/password, OTP, JWT refresh; security QA pending. |
| 13 | Email OTP | PARTIAL / REVISED | OTP exists; exact expiration/throttling/storage checks pending. |
| 14 | User Roles | IMPLEMENTED / QA PENDING | PASSENGER/DRIVER/ADMIN in place; future granular roles planned. |
| 15 | Passenger Features | PARTIAL / REVISED | Passenger ride, offers, receipt and rating UI; multi-stop/chat/support pending. |
| 16 | Driver Features | PARTIAL / REVISED | Driver workflow/wallet views; payment credit UI, rating passenger, safety pending. |
| 17 | Driver Verification | TESTED UI / PARTIAL HARDENING | Four required documents and admin signed preview; audits/revocation pending. |
| 18 | Vehicle | TESTED UI / PARTIAL HARDENING | Canonical BIKE/RICKSHAW/CAR_AC/CAR_NON_AC; admin workflow tested. |
| 19 | Ride System | IMPLEMENTED / QA PENDING | State enum matches implemented Ride; state race E2E pending. |
| 20 | Ride Request | PARTIAL / REVISED | Pickup/destination fare offer; stop list missing. |
| 21 | Driver Bidding | IMPLEMENTED / QA PENDING | Bid and selection implemented; strict E2E pending. |
| 22 | Driver Matching | PARTIAL / REVISED | Eligibility and nearby matching slice; more concurrency policy needed. |
| 23 | Location | PARTIAL / REVISED | GPS+Socket slices; real-device background update pending. |
| 24 | Maps | PARTIAL / REVISED | OSRM routing, autocomplete; provider reliability and policy pending. |
| 25 | Service Area / City System | PARTIAL / REVISED | Backend area routes present; admin map editor pending. |
| 26 | Out-of-Area Protection | PARTIAL / REVISED | Check server enforcement for all itinerary points. |
| 27 | Service Area Rules | PARTIAL / REVISED | Admin configurable boundary rules not complete. |
| 28 | Wallet System | PARTIAL — FINANCE GATE | Wallet and commission accounting implemented; runtime blocked for recovery. |
| 29 | Wallet Top-Up | PARTIAL — FINANCE GATE | Transactional manual credit service; verified payment approval flow missing. |
| 30 | Wallet Rules | PARTIAL — FINANCE GATE | GLOBAL wallet threshold model; strict enforcement audit needed. |
| 31 | Commission | PARTIAL — FINANCE GATE | Commission settings UI and service; retry blocker. |
| 32 | Important Wallet Protection | PARTIAL — FINANCE GATE | Unique keys/atomic transactions tested 12/12; more failure tests. |
| 33 | Passenger Payment | IMPLEMENTED / REVISED | Cash-only retained. |
| 34 | Ratings | PARTIAL / REVISED | Passenger→driver rating/review present; driver→passenger not verified. |
| 35 | Chat | PLANNED | Chat not yet verified implemented. |
| 36 | Push Notifications | PLANNED | Native pushes not verified implemented. |
| 37 | REST API Structure | PARTIAL / REVISED | Original API was a proposal; actual nested routes differ. |
| 38 | WebSocket Events | PARTIAL / REVISED | Real-time event names should be audited against current Socket.IO code. |
| 39 | MongoDB Collections | PARTIAL / REVISED | Core documents/models exist, but original full collection set incomplete. |
| 40 | Important MongoDB Models | PARTIAL / REVISED | User/Driver models live; actual schema may differ from original concept. |
| 41 | Ride | IMPLEMENTED / REVISED | Ride fields include settlement status/attempts/settledAt; no stops. |
| 42 | Ride Offer | IMPLEMENTED / REVISED | Offer flow exists. |
| 43 | Wallet | IMPLEMENTED / QA PENDING | DriverWallet/WalletTransaction/RideSettlement replace original generic wallet schema. |
| 44 | Service Area | PLANNED / REVISED | GeoJSON model + admin UI coverage not proven complete. |
| 45 | Admin Dashboard Features | PARTIAL — UI TESTED | Overview/read-only modules exist; support/disputes/settings pending. |
| 46 | Admin Dashboard - Service Area | PARTIAL / REVISED | Area backend but full dashboard polygon editor not verified. |
| 47 | Admin Configuration | PARTIAL / REVISED | Commission UI; comprehensive settings catalog pending. |
| 48 | Cloudinary | PARTIAL / REVISED | Authenticated Cloudinary document preview implemented; more media workflows pending. |
| 49 | Security | PARTIAL / REVISED | Auth/RBAC present; production security controls and audit remain. |
| 50 | Backend Business Logic | PARTIAL / REVISED | Some services extracted; controller/repository separation mixed. |
| 51 | Background Jobs | PLANNED | Worker/Redis/BullMQ queue execution not verified. |
| 52 | Driver Location Strategy | PARTIAL / REVISED | Foreground GPS/Socket exist; background/location lifecycle pending. |
| 53 | Prevent Double Booking | PARTIAL / REVISED | Atomic double booking requires specific stress tests. |
| 54 | Ride State Security | PARTIAL / REVISED | Controlled ride endpoints implemented; actor/state robustness pending. |
| 55 | Mobile/Capacitor Strategy | PARTIAL / REVISED | Capacitor-oriented implementation; native signed releases unverified. |
| 56 | Low-Cost Initial Infrastructure | PARTIAL / REVISED | Cost-conscious local setup; no verified production deployment. |
| 57 | Development Order | PARTIAL / REVISED | Original 30-step sequence superseded by phased roadmap. |
| 58 | MVP Scope | PARTIAL / REVISED | MVP expanded: multi-stops are now core, not defer-to-later. |
| 59 | Features to Add Later | PLANNED / REVISED | Revised later-scope: multiple stops moved to core; retain optional auth/payments. |
| 60 | Final Architecture | IMPLEMENTED / REVISED | High-level graph retained; Redis/worker/push are future state. |
| 61 | Core Principle | IMPLEMENTED / REVISED | Low-cost principle retained with stronger QA/secure operations. |

## 17. Out-of-scope / later feature boundaries

**Remain later unless approved:** phone/SMS OTP, Google or Apple login, online passenger payments or a passenger wallet, multiple countries/currencies, enterprise subscriptions/corporate accounts, referral system, complex surge/incentives and scheduled rides.

**Explicitly moved INTO the core target:** multi-stop journeys, reordering, admin-driven stop limits, total route pricing and wait fees. **Must not** be dismissed as a future optional add-on simply because the original #59 listed multiple stops under Later.

**Release decision required:** whether chat, full native push and full support/disputes are mandatory for first controlled MVP or can be staged behind a safety-compliant pilot. They were part of original MVP and remain incomplete; any deferral must be explicit rather than silently dropped.

## 18. Document governance and change log

**Authoritative sources:** supplied original Ride-Hailing Application — Complete Technical Plan (61 sections); development exchange through 10 Oct 2026; pasted live code for ride/finance/driver/vehicle/admin components; reported PASS outputs. No direct full-repository inspection or independent server execution was performed while writing this master plan. Therefore all implementation assessments are **development-history based**, not a fresh source-control audit.

**Revision 2.0 (10 Oct 2026):** Added canonical four vehicle types; actual apps, admin pages and read-only operation APIs; driver/vehicle document review; cash/prepaid wallet detail; 12/12 isolated financial test evidence; financial recovery blocker and pause checkpoint; multi-stop promoted to core; admin-first settings inventory; phased release gates; original 61-section crosswalk.

**Change control:** Every later phase should record: issue/requirement, exact files/routes touched, DB schema migration, acceptance command/results, security impact, deployed environment, rollback method and next owner. Do not relabel **TESTED** without an actual test result.

**Handoff summary:** Next actionable engineering work = finish/fail-close settlement recovery correctly, test it in isolated finance DB, verify reconciliation, then proceed to stop-aware pricing and full admin configuration. Do not enable production finance batch processing prematurely.

