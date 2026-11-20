const User = require("../models/User");
const Driver = require("../models/Driver");
const DriverDocument = require("../models/DriverDocument");
const Vehicle = require("../models/Vehicle");
const Ride = require("../models/Ride");
const PushDevice = require("../models/PushDevice");
const RentalPartner = require("../models/RentalPartner");

// Safar To-Do #18 — Dashboard User Lookup by Email.
// READ-ONLY admin endpoint: GET /admin/operations/users/lookup?email=...
// Lets an admin settle whether an account really exists for a given
// email (e.g. a brand-new email that gets an OTP but Verify answers
// 409 "Email already registered" while the availability check says
// AVAILABLE and dashboard searches find nothing).
//
// Deliberately NOT filtered by role or status: it must find users of
// EVERY role (PASSENGER / DRIVER / ADMIN) and EVERY status — including
// SUSPENDED. The Custom Notifications user search deliberately excludes
// suspended users (adminNotificationController: status $ne SUSPENDED);
// this endpoint must NOT share that gap.
//
// NEVER returns passwordHash, tokens, or the googleUid value — only a
// googleLinked boolean. The response is built field-by-field; the user
// document is never spread into it.

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function lookupUserByEmail(req, res) {
    try {
        const email = String(req.query.email || "").trim().toLowerCase();

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required.",
            });
        }

        // Case-insensitive EXACT match (anchored regex on the escaped
        // input). A plain equality lookup would miss legacy rows stored
        // with mixed case; an unanchored regex would match substrings.
        const user = await User.findOne({
            email: { $regex: `^${escapeRegex(email)}$`, $options: "i" },
        })
            .select(
                "+googleUid firstName lastName email phone role status " +
                    "activeMode emailVerified createdAt invitedBy"
            )
            .populate("invitedBy", "firstName lastName email")
            .lean();

        if (!user) {
            return res.status(200).json({
                success: true,
                found: false,
                email,
                message: "No user found with this email.",
            });
        }

        const userId = user._id;

        const [driver, pushDeviceCount, rentalPartner, passengerRides] =
            await Promise.all([
                Driver.findOne({ userId })
                    .select(
                        "verificationStatus services isOnline isAvailable " +
                            "currentVehicleId createdAt"
                    )
                    .lean(),
                PushDevice.countDocuments({ userId }),
                RentalPartner.findOne({ userId })
                    .select(
                        "businessName applicationStatus providesChauffeur " +
                            "chauffeurVerificationStatus createdAt"
                    )
                    .lean(),
                Ride.aggregate([
                    { $match: { passengerId: userId } },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            completed: {
                                $sum: {
                                    $cond: [
                                        { $eq: ["$status", "TRIP_COMPLETED"] },
                                        1,
                                        0,
                                    ],
                                },
                            },
                        },
                    },
                ]),
            ]);

        const passengerRideCounts = passengerRides[0] || {
            total: 0,
            completed: 0,
        };

        // Driver-linked detail only exists when the user has a Driver
        // profile; otherwise these stay null / empty.
        let driverDetail = null;
        let vehicles = [];
        let driverRideCounts = null;

        if (driver) {
            const [documentGroups, driverVehicles, driverRides] =
                await Promise.all([
                    DriverDocument.aggregate([
                        { $match: { driverId: driver._id } },
                        {
                            $group: {
                                _id: "$verificationStatus",
                                count: { $sum: 1 },
                            },
                        },
                    ]),
                    Vehicle.find({ driverId: driver._id })
                        .select(
                            "registrationNumber vehicleType make model " +
                                "color modelYear verificationStatus " +
                                "isActive createdAt"
                        )
                        .sort({ createdAt: -1 })
                        .lean(),
                    Ride.aggregate([
                        { $match: { driverId: driver._id } },
                        {
                            $group: {
                                _id: null,
                                total: { $sum: 1 },
                                completed: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $eq: [
                                                    "$status",
                                                    "TRIP_COMPLETED",
                                                ],
                                            },
                                            1,
                                            0,
                                        ],
                                    },
                                },
                            },
                        },
                    ]),
                ]);

            const documentsByStatus = {
                PENDING: 0,
                APPROVED: 0,
                REJECTED: 0,
            };
            let documentsTotal = 0;
            for (const row of documentGroups) {
                if (row._id in documentsByStatus) {
                    documentsByStatus[row._id] = row.count;
                }
                documentsTotal += row.count;
            }

            driverDetail = {
                id: driver._id,
                verificationStatus: driver.verificationStatus,
                serviceEligibility: {
                    RIDE: driver.services?.RIDE?.status || "NOT_APPLIED",
                    PARCEL:
                        driver.services?.PARCEL?.status || "NOT_APPLIED",
                    BUY_DELIVER:
                        driver.services?.BUY_DELIVER?.status ||
                        "NOT_APPLIED",
                },
                isOnline: driver.isOnline,
                isAvailable: driver.isAvailable,
                currentVehicleId: driver.currentVehicleId,
                documents: {
                    total: documentsTotal,
                    byStatus: documentsByStatus,
                },
                createdAt: driver.createdAt,
            };
            vehicles = driverVehicles;
            const counts = driverRides[0] || { total: 0, completed: 0 };
            driverRideCounts = {
                total: counts.total,
                completed: counts.completed,
            };
        }

        return res.status(200).json({
            success: true,
            found: true,
            user: {
                id: user._id,
                name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phone: user.phone || null,
                role: user.role,
                status: user.status,
                activeMode: user.activeMode,
                emailVerified: user.emailVerified,
                // Boolean ONLY — the googleUid value itself is never sent.
                googleLinked: Boolean(user.googleUid),
                invitedBy: user.invitedBy
                    ? {
                          id: user.invitedBy._id,
                          name: `${user.invitedBy.firstName || ""} ${user.invitedBy.lastName || ""}`.trim(),
                          email: user.invitedBy.email,
                      }
                    : null,
                createdAt: user.createdAt,
            },
            driver: driverDetail,
            vehicles,
            rides: {
                asPassenger: {
                    total: passengerRideCounts.total,
                    completed: passengerRideCounts.completed,
                },
                asDriver: driverRideCounts,
            },
            pushDevices: pushDeviceCount,
            rentalPartner: rentalPartner
                ? {
                      id: rentalPartner._id,
                      businessName: rentalPartner.businessName,
                      applicationStatus: rentalPartner.applicationStatus,
                      providesChauffeur: rentalPartner.providesChauffeur,
                      chauffeurVerificationStatus:
                          rentalPartner.chauffeurVerificationStatus,
                      createdAt: rentalPartner.createdAt,
                  }
                : null,
        });
    } catch (error) {
        console.error("lookupUserByEmail error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to look up user.",
        });
    }
}

module.exports = { lookupUserByEmail };
