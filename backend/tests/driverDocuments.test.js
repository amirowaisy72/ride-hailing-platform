// Driver document upload/list tests (plain node, no test framework, no DB).
//
// Covers the backend-only duplicate-documents fix: one live row per
// (driver, document type), 10 MB photo limit, JSON errors for rejected
// files, the driver-facing document list, and approve-time duplicate
// cleanup.
//
// Run:  node tests/driverDocuments.test.js
// Exit code 0 = all passed, 1 = at least one failure.

const assert = require("node:assert");
const Module = require("node:module");

const originalLoad = Module._load;
const stubs = new Map();
Module._load = function (request, parent, isMain) {
    for (const [suffix, exported] of stubs) {
        if (request === suffix || request.endsWith(suffix)) {
            return exported;
        }
    }
    return originalLoad.apply(this, arguments);
};

function setStub(suffix, exported) {
    stubs.set(suffix, exported);
}

function clearStubs() {
    stubs.clear();
}

function freshRequire(relativePath) {
    const resolved = require.resolve(relativePath);
    delete require.cache[resolved];
    return require(resolved);
}

function fakeRes() {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (body) => {
        res.body = body;
        return res;
    };
    return res;
}

function fakeRow(fields) {
    const row = {
        _id: fields._id || "doc-1",
        driverId: "driver-1",
        documentType: fields.documentType || "CNIC_FRONT",
        verificationStatus: fields.verificationStatus || "PENDING",
        rejectionReason:
            fields.rejectionReason !== undefined
                ? fields.rejectionReason
                : null,
        expiryDate:
            fields.expiryDate !== undefined ? fields.expiryDate : null,
        imageUrl: fields.imageUrl || "https://old.example/x.jpg",
        cloudinaryPublicId:
            fields.cloudinaryPublicId || "old-public-id",
        saveCalls: 0,
        save: async function () {
            this.saveCalls += 1;
            return this;
        },
    };
    return row;
}

const ALL_TYPES = [
    "CNIC_FRONT",
    "CNIC_BACK",
    "DRIVING_LICENSE",
    "VEHICLE_REGISTRATION",
    "INSURANCE",
    "VEHICLE_PHOTO",
    "PROFILE_PHOTO",
];

function makeDriverDocumentStub({ latest = null, listRows = [] } = {}) {
    const calls = { findOne: 0, create: 0, updateMany: 0, find: 0 };
    const created = [];
    const updatedMany = [];
    return {
        calls,
        created,
        updatedMany,
        schema: { path: () => ({ enumValues: ALL_TYPES }) },
        findOne: () => {
            calls.findOne += 1;
            return { sort: async () => latest };
        },
        findById: async () => latest,
        find: () => {
            calls.find += 1;
            return { select: () => ({ sort: async () => listRows }) };
        },
        create: async (doc) => {
            calls.create += 1;
            const row = fakeRow({ ...doc, _id: "doc-new" });
            created.push(row);
            return row;
        },
        updateMany: async (filter, update) => {
            calls.updateMany += 1;
            updatedMany.push({ filter, update });
            return { modifiedCount: 1 };
        },
    };
}

function makeUploadStubs({ latest = null, listRows = [] } = {}) {
    const driverDoc = makeDriverDocumentStub({ latest, listRows });
    const uploadCalls = [];
    const stubsForController = {
        driver: { findOne: async () => ({ _id: "driver-1" }) },
        driverDoc,
        uploadService: {
            uploadToCloudinary: async (buffer, driverId) => {
                uploadCalls.push({ buffer, driverId });
                return {
                    imageUrl: "https://new.example/y.jpg",
                    publicId: "new-public-id",
                };
            },
        },
    };
    return { ...stubsForController, uploadCalls };
}

function installUploadStubs(setup) {
    clearStubs();
    setStub("/models/Driver", setup.driver);
    setStub("/models/DriverDocument", setup.driverDoc);
    setStub(
        "/integrations/cloudinary/uploadService",
        setup.uploadService
    );
    return freshRequire("../src/controllers/driverDocumentController");
}

function baseReq(overrides = {}) {
    return {
        user: { _id: "user-1" },
        file: { buffer: Buffer.from("fake-image") },
        body: { documentType: "CNIC_FRONT" },
        ...overrides,
    };
}

let passed = 0;
async function test(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`FAIL - ${name}: ${error.message}`);
        process.exitCode = 1;
    }
}

(async () => {
    // 1. Fresh upload creates one row and returns the same shape.
    await test("fresh upload creates one PENDING row", async () => {
        const setup = makeUploadStubs({ latest: null });
        const { uploadDocument } = installUploadStubs(setup);
        const res = fakeRes();
        await uploadDocument(baseReq(), res);
        assert.strictEqual(res.statusCode, 201);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.document.documentType, "CNIC_FRONT");
        assert.strictEqual(res.body.document.verificationStatus, "PENDING");
        assert.strictEqual(setup.driverDoc.calls.create, 1);
        assert.strictEqual(setup.uploadCalls.length, 1);
    });

    // 2. Re-upload while PENDING updates the same row, no new row.
    await test("re-upload while PENDING updates the same row", async () => {
        const pending = fakeRow({ _id: "doc-pending" });
        const setup = makeUploadStubs({ latest: pending });
        const { uploadDocument } = installUploadStubs(setup);
        const res = fakeRes();
        await uploadDocument(baseReq(), res);
        assert.strictEqual(res.statusCode, 201);
        assert.strictEqual(res.body.document.id, "doc-pending");
        assert.strictEqual(setup.driverDoc.calls.create, 0);
        assert.strictEqual(pending.saveCalls, 1);
        assert.strictEqual(pending.imageUrl, "https://new.example/y.jpg");
        assert.strictEqual(pending.cloudinaryPublicId, "new-public-id");
        assert.strictEqual(pending.verificationStatus, "PENDING");
    });

    // 3. Re-upload after REJECTED refreshes the same row to PENDING.
    await test("re-upload after REJECTED refreshes the same row", async () => {
        const rejected = fakeRow({
            _id: "doc-rejected",
            verificationStatus: "REJECTED",
            rejectionReason: "Wrong Document",
        });
        const setup = makeUploadStubs({ latest: rejected });
        const { uploadDocument } = installUploadStubs(setup);
        const res = fakeRes();
        await uploadDocument(baseReq(), res);
        assert.strictEqual(res.statusCode, 201);
        assert.strictEqual(res.body.document.id, "doc-rejected");
        assert.strictEqual(setup.driverDoc.calls.create, 0);
        assert.strictEqual(rejected.saveCalls, 1);
        assert.strictEqual(rejected.verificationStatus, "PENDING");
        assert.strictEqual(rejected.rejectionReason, null);
    });

    // 4. Re-upload of an approved, unexpired document is blocked.
    await test("approved unexpired document cannot be re-uploaded", async () => {
        const approved = fakeRow({ verificationStatus: "APPROVED" });
        const setup = makeUploadStubs({ latest: approved });
        const { uploadDocument } = installUploadStubs(setup);
        const res = fakeRes();
        await uploadDocument(baseReq(), res);
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.success, false);
        assert.match(res.body.message, /already approved/);
        assert.strictEqual(setup.driverDoc.calls.create, 0);
        assert.strictEqual(approved.saveCalls, 0);
        assert.strictEqual(setup.uploadCalls.length, 0);
    });

    // 5. Approved-but-expired licence can be replaced in place.
    await test("approved expired licence is replaced in place", async () => {
        const expired = fakeRow({
            verificationStatus: "APPROVED",
            documentType: "DRIVING_LICENSE",
            expiryDate: new Date("2020-01-01"),
        });
        const setup = makeUploadStubs({ latest: expired });
        const { uploadDocument } = installUploadStubs(setup);
        const res = fakeRes();
        await uploadDocument(
            baseReq({
                body: {
                    documentType: "DRIVING_LICENSE",
                    expiryDate: "2030-01-01",
                },
            }),
            res
        );
        assert.strictEqual(res.statusCode, 201);
        assert.strictEqual(setup.driverDoc.calls.create, 0);
        assert.strictEqual(expired.saveCalls, 1);
        assert.strictEqual(expired.verificationStatus, "PENDING");
        assert.strictEqual(
            expired.expiryDate.toISOString().slice(0, 10),
            "2030-01-01"
        );
    });

    // 6. Missing file / bad type / missing expiry still 400.
    await test("missing file is a 400", async () => {
        const setup = makeUploadStubs({ latest: null });
        const { uploadDocument } = installUploadStubs(setup);
        const res = fakeRes();
        await uploadDocument(baseReq({ file: undefined }), res);
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.body.message, /Document image required/);
    });

    await test("invalid document type is a 400", async () => {
        const setup = makeUploadStubs({ latest: null });
        const { uploadDocument } = installUploadStubs(setup);
        const res = fakeRes();
        await uploadDocument(
            baseReq({ body: { documentType: "PASSPORT" } }),
            res
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.body.message, /Invalid document type/);
    });

    await test("licence without expiry is a 400", async () => {
        const setup = makeUploadStubs({ latest: null });
        const { uploadDocument } = installUploadStubs(setup);
        const res = fakeRes();
        await uploadDocument(
            baseReq({ body: { documentType: "DRIVING_LICENSE" } }),
            res
        );
        assert.strictEqual(res.statusCode, 400);
        assert.match(res.body.message, /expiry date required/);
    });

    // 7. Driver-facing list returns the driver's own rows.
    await test("getMyDocuments lists the driver's own rows", async () => {
        const rows = [
            fakeRow({ _id: "doc-a", documentType: "CNIC_FRONT" }),
            fakeRow({
                _id: "doc-b",
                documentType: "CNIC_BACK",
                verificationStatus: "APPROVED",
            }),
        ];
        const setup = makeUploadStubs({ listRows: rows });
        const { getMyDocuments } = installUploadStubs(setup);
        const res = fakeRes();
        await getMyDocuments({ user: { _id: "user-1" } }, res);
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.documents.length, 2);
        assert.strictEqual(res.body.documents[0].documentType, "CNIC_FRONT");
    });

    await test("getMyDocuments 404s without a driver profile", async () => {
        clearStubs();
        setStub("/models/Driver", { findOne: async () => null });
        setStub("/models/DriverDocument", makeDriverDocumentStub({}));
        setStub("/integrations/cloudinary/uploadService", {
            uploadToCloudinary: async () => ({}),
        });
        const { getMyDocuments } = freshRequire(
            "../src/controllers/driverDocumentController"
        );
        const res = fakeRes();
        await getMyDocuments({ user: { _id: "user-1" } }, res);
        assert.strictEqual(res.statusCode, 404);
        assert.strictEqual(res.body.success, false);
    });

    // 8. Route: GET list registered; multer failures become JSON.
    await test("route maps multer errors to clean JSON", async () => {
        clearStubs();
        let capturedOptions = null;
        let currentUploadError = null;
        let nextCalled = 0;
        const fakeUploadFn = (req, res, cb) => cb(currentUploadError);
        const multerStub = (options) => {
            capturedOptions = options;
            return { single: () => fakeUploadFn };
        };
        multerStub.memoryStorage = () => ({});
        class FakeMulterError extends Error {
            constructor(code) {
                super(code);
                this.code = code;
            }
        }
        multerStub.MulterError = FakeMulterError;
        const recorded = { get: [], post: [] };
        setStub("express", {
            Router: () => ({
                get: (path, ...handlers) =>
                    recorded.get.push({ path, handlers }),
                post: (path, ...handlers) =>
                    recorded.post.push({ path, handlers }),
            }),
        });
        setStub("multer", multerStub);
        setStub("/middleware/authMiddleware", {
            protect: (req, res, next) => next(),
        });
        setStub("/middleware/roleMiddleware", {
            authorize: () => (req, res, next) => next(),
        });
        const controllerStub = {
            uploadDocument: () => {},
            getMyDocuments: () => {},
        };
        setStub("/controllers/driverDocumentController", controllerStub);
        freshRequire("../src/routes/driverDocumentRoutes");

        // 10 MB limit reaches multer through the real middleware file.
        assert.strictEqual(capturedOptions.limits.fileSize, 10 * 1024 * 1024);
        assert.strictEqual(capturedOptions.limits.files, 1);
        let filterResult = null;
        capturedOptions.fileFilter(
            null,
            { mimetype: "image/jpeg" },
            (error, ok) => {
                filterResult = { error, ok };
            }
        );
        assert.strictEqual(filterResult.error, null);
        assert.strictEqual(filterResult.ok, true);
        let filterError = null;
        capturedOptions.fileFilter(
            null,
            { mimetype: "application/pdf" },
            (error) => {
                filterError = error;
            }
        );
        assert.ok(filterError instanceof Error);

        // GET / serves the driver list.
        assert.strictEqual(recorded.get.length, 1);
        assert.strictEqual(recorded.get[0].path, "/");
        assert.strictEqual(
            recorded.get[0].handlers.at(-1),
            controllerStub.getMyDocuments
        );

        // POST / has the error wrapper before the controller.
        assert.strictEqual(recorded.post.length, 1);
        const postHandlers = recorded.post[0].handlers;
        assert.strictEqual(
            postHandlers.at(-1),
            controllerStub.uploadDocument
        );
        const handleUploadErrors = postHandlers.at(-2);

        const oversize = new FakeMulterError("LIMIT_FILE_SIZE");
        currentUploadError = oversize;
        const res413 = fakeRes();
        await new Promise((resolve) => {
            handleUploadErrors({}, res413, () => {
                nextCalled += 1;
                resolve();
            });
            setImmediate(resolve);
        });
        assert.strictEqual(res413.statusCode, 413);
        assert.strictEqual(res413.body.success, false);
        assert.match(res413.body.message, /10 MB/);

        currentUploadError = new Error(
            "Only JPG, PNG and WEBP images allowed"
        );
        const res400 = fakeRes();
        handleUploadErrors({}, res400, () => {
            nextCalled += 1;
        });
        assert.strictEqual(res400.statusCode, 400);
        assert.match(res400.body.message, /Only JPG, PNG and WEBP/);

        currentUploadError = null;
        handleUploadErrors({}, fakeRes(), () => {
            nextCalled += 1;
        });
        assert.strictEqual(nextCalled, 1);
    });

    // 9. Admin approve marks other PENDING rows of the same type as duplicates.
    await test("admin approve clears other PENDING rows of the same type", async () => {
        clearStubs();
        const underReview = fakeRow({
            _id: "doc-review",
            documentType: "CNIC_FRONT",
            verificationStatus: "PENDING",
        });
        const driverDoc = makeDriverDocumentStub({ latest: underReview });
        setStub("mongoose", { isValidObjectId: () => true });
        setStub("/models/Driver", { findOne: async () => ({}) });
        setStub("/models/DriverDocument", driverDoc);
        setStub("/models/RentalPartner", {});
        setStub("/models/RentalPartnerDocument", {});
        setStub("/models/UserAppVersion", {});
        setStub("/models/Vehicle", { updateMany: async () => ({}) });
        setStub("/models/Ride", {});
        setStub("/models/PushDevice", {});
        setStub("/models/IntegrationSetting", {});
        setStub("/models/LastAdminNotification", {});
        setStub("/services/pushService", {
            sendPushToUser: async () => {},
        });
        setStub("/services/eligibilityService", {
            autoApproveEligibleServices: async () => {},
        });
        setStub("/integrations/cloudinary/cloudinary", {});
        const { reviewDriverDocument } = freshRequire(
            "../src/controllers/adminDriverController"
        );
        const res = fakeRes();
        await reviewDriverDocument(
            {
                params: { documentId: "doc-review" },
                body: { status: "APPROVED" },
            },
            res
        );
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(underReview.verificationStatus, "APPROVED");
        assert.strictEqual(driverDoc.calls.updateMany, 1);
        const cleanup = driverDoc.updatedMany[0];
        assert.strictEqual(cleanup.filter.driverId, "driver-1");
        assert.strictEqual(cleanup.filter.documentType, "CNIC_FRONT");
        assert.strictEqual(cleanup.filter.verificationStatus, "PENDING");
        assert.deepStrictEqual(cleanup.filter._id, {
            $ne: "doc-review",
        });
        assert.strictEqual(
            cleanup.update.$set.verificationStatus,
            "REJECTED"
        );
        assert.match(cleanup.update.$set.rejectionReason, /Duplicate/);
    });

    await test("admin reject does not touch other rows", async () => {
        clearStubs();
        const underReview = fakeRow({
            _id: "doc-review",
            documentType: "CNIC_FRONT",
            verificationStatus: "PENDING",
        });
        const driverDoc = makeDriverDocumentStub({ latest: underReview });
        setStub("mongoose", { isValidObjectId: () => true });
        setStub("/models/Driver", { findOne: async () => ({}) });
        setStub("/models/DriverDocument", driverDoc);
        setStub("/models/RentalPartner", {});
        setStub("/models/RentalPartnerDocument", {});
        setStub("/models/UserAppVersion", {});
        setStub("/models/Vehicle", { updateMany: async () => ({}) });
        setStub("/models/Ride", {});
        setStub("/models/PushDevice", {});
        setStub("/models/IntegrationSetting", {});
        setStub("/models/LastAdminNotification", {});
        setStub("/services/pushService", {
            sendPushToUser: async () => {},
        });
        setStub("/services/eligibilityService", {
            autoApproveEligibleServices: async () => {},
        });
        setStub("/integrations/cloudinary/cloudinary", {});
        const { reviewDriverDocument } = freshRequire(
            "../src/controllers/adminDriverController"
        );
        const res = fakeRes();
        await reviewDriverDocument(
            {
                params: { documentId: "doc-review" },
                body: {
                    status: "REJECTED",
                    rejectionReason: "Wrong Document",
                },
            },
            res
        );
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(underReview.verificationStatus, "REJECTED");
        assert.strictEqual(driverDoc.calls.updateMany, 0);
    });

    console.log(`\n${passed} tests passed`);
})();
