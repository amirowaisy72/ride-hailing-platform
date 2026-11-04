"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { BRAND } from "@/config/brand";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import "@/lib/firebase";
import { ArrowRight, Car, Check, Lock, Mail, Phone, User, UserRound } from "lucide-react";
import AuthField from "@/components/auth/AuthField";
import {
    AuthHeader,
    FormError,
    GoogleButton,
    OrDivider,
    PasswordToggle,
    PrimaryButton,
} from "@/components/auth/AuthParts";

const STEPS = ["role", "name", "email", "password", "phone", "review"];

const ROLE_OPTIONS = [
    {
        value: "PASSENGER",
        title: "Passenger",
        description: "Book rides and choose your own fare.",
        icon: UserRound,
    },
    {
        value: "DRIVER",
        title: "Driver",
        description: "Drive with Safar and earn on your schedule.",
        icon: Car,
    },
];

const FIELD_MESSAGES = {
    firstName: { valueMissing: "Please enter your first name." },
    lastName: { valueMissing: "Please enter your last name." },
    email: {
        valueMissing: "Please enter your email address.",
        typeMismatch: "Please enter a valid email address.",
    },
    password: {
        valueMissing: "Please create a password.",
        tooShort: "Your password must be at least 8 characters.",
    },
    phone: {},
};

function messageFor(input) {
    const messages = FIELD_MESSAGES[input.name] || {};
    const { validity } = input;
    if (validity.valueMissing && messages.valueMissing) return messages.valueMissing;
    if (validity.typeMismatch && messages.typeMismatch) return messages.typeMismatch;
    if (validity.tooShort && messages.tooShort) return messages.tooShort;
    return input.validationMessage || "Please check this field.";
}

export default function SignupPage() {
    const router = useRouter();
    const { login } = useAuth();
    const { t } = useLanguage();
    const [form, setForm] = useState({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        password: "",
    });
    const [role, setRole] = useState(null);
    const [stepIndex, setStepIndex] = useState(0);
    const [direction, setDirection] = useState("forward");
    const [fieldErrors, setFieldErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [signupStep, setSignupStep] = useState("");
    const stepRef = useRef(null);

    const currentStep = STEPS[stepIndex];
    const isReview = currentStep === "review";

    function updateField(key, value) {
        setForm((prev) => ({ ...prev, [key]: value }));
        if (fieldErrors[key]) {
            setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
        }
    }

    function goTo(index) {
        setDirection(index > stepIndex ? "forward" : "back");
        setError("");
        setFieldErrors({});
        setStepIndex(index);
    }

    function validateStep() {
        if (currentStep === "role") {
            if (!role) {
                setFieldErrors({ role: "Please choose how you want to join." });
                return false;
            }
            return true;
        }

        const inputs = stepRef.current?.querySelectorAll("input[name]") ?? [];
        const errors = {};
        let firstInvalid = null;

        inputs.forEach((input) => {
            if (!input.checkValidity()) {
                errors[input.name] = messageFor(input);
                firstInvalid ??= input;
            }
        });

        if (currentStep === "phone") {
            const cleanPhone = (form.phone || "").replace(/[\s-]/g, "").trim();
            if (cleanPhone && !/^\+?\d{10,15}$/.test(cleanPhone)) {
                errors.phone = "Please enter a valid phone number.";
                firstInvalid ??= stepRef.current?.querySelector("input[name='phone']");
            }
        }

        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            firstInvalid?.focus();
            return false;
        }

        return true;
    }

    function goNext() {
        if (!validateStep()) return;
        goTo(Math.min(stepIndex + 1, STEPS.length - 1));
    }

    function goBack() {
        if (stepIndex === 0) {
            router.push("/login");
            return;
        }
        goTo(stepIndex - 1);
    }

    function chooseRole(value) {
        setRole(value);
        setFieldErrors({});
        setDirection("forward");
        setTimeout(() => setStepIndex((i) => (i === 0 ? 1 : i)), 220);
    }

    function skipPhone() {
        updateField("phone", "");
        goTo(stepIndex + 1);
    }

    function handleFormSubmit(e) {
        e.preventDefault();
        if (isReview) {
            submit(e);
            return;
        }
        goNext();
    }

    async function submit(e) {
        e.preventDefault();
        if (loading) return;
        setLoading(true);
        setError("");

        try {
            const email = form.email.trim().toLowerCase();
            const cleanPhone = (form.phone || "").replace(/[\s-]/g, "").trim();

            if (cleanPhone && !/^\+?\d{10,15}$/.test(cleanPhone)) {
                throw new Error("Please enter a valid phone number.");
            }

            const withTimeout = (promise, step) =>
                Promise.race([
                    promise,
                    new Promise((_, reject) =>
                        setTimeout(
                            () => reject(new Error(`${step} failed: Server did not respond within 20 seconds.`)),
                            20000
                        )
                    ),
                ]);

            const selectedRole = role || "PASSENGER";

            setSignupStep("Checking email...");

            await withTimeout(
                apiRequest("/auth/register", {
                    method: "POST",
                    body: JSON.stringify({
                        ...form,
                        email,
                        role: selectedRole,
                    }),
                }),
                "Email Check"
            );

            setSignupStep("Sending OTP...");

            await withTimeout(
                apiRequest("/auth/signup/send-otp", {
                    method: "POST",
                    body: JSON.stringify({ email }),
                }),
                "OTP Sending"
            );

            sessionStorage.setItem(
                "safar-pending-signup",
                JSON.stringify({ ...form, email, role: selectedRole })
            );

            router.push(`/verify-otp?email=${encodeURIComponent(email)}`);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleGoogleSignup() {
        if (loading) return;

        setError("");
        setLoading(true);
        setSignupStep("Signing in with Google...");

        try {
            await FirebaseAuthentication.signInWithGoogle();

            const { token: idToken } =
                await FirebaseAuthentication.getIdToken();

            if (!idToken) {
                throw new Error("Google ID token missing");
            }

            const data = await apiRequest("/auth/google", {
                method: "POST",
                body: JSON.stringify({ idToken }),
            });

            if (!data.accessToken || !data.refreshToken) {
                throw new Error("Invalid authentication response");
            }

            const profile = await apiRequest("/auth/me", {
                token: data.accessToken,
            });

            await login(
                data.accessToken,
                profile.user,
                data.refreshToken
            );

            router.replace(
                profile.user.activeMode === "DRIVER"
                    ? "/driver"
                    : "/passenger"
            );
        } catch (err) {
            setError(err.message || "Google Sign-In failed");
        } finally {
            setLoading(false);
            setSignupStep("");
        }
    }

    const totalSteps = STEPS.length;
    const stepNumber = stepIndex + 1;

    return (
        <main className="flex h-dvh flex-col overflow-hidden bg-pd-bg text-pd-text">
            <div className="mx-auto flex h-full w-full max-w-md flex-col">
                <AuthHeader
                    onBack={goBack}
                    backLabel={stepIndex === 0 ? "Back to sign in" : "Previous step"}
                    backDisabled={loading}
                />

                <div className="flex flex-col gap-2.5 px-6 pt-6">
                    <div
                        className="flex gap-1.5"
                        role="progressbar"
                        aria-label="Sign up progress"
                        aria-valuemin={1}
                        aria-valuemax={totalSteps}
                        aria-valuenow={stepNumber}
                        aria-valuetext={`Step ${stepNumber} of ${totalSteps}`}
                    >
                        {STEPS.map((step, i) => (
                            <span
                                key={step}
                                className="h-1.5 flex-1 overflow-hidden rounded-full bg-pd-surface-3"
                            >
                                <span
                                    className={`block h-full rounded-full bg-pd-accent transition-transform duration-500 ease-out ${
                                        i <= stepIndex ? "translate-x-0" : "-translate-x-full"
                                    }`}
                                    style={{ transformOrigin: "left" }}
                                />
                            </span>
                        ))}
                    </div>
                    <p className="text-xs font-semibold tracking-wide text-pd-muted">
                        Step {stepNumber} of {totalSteps}
                    </p>
                </div>

                <form
                    onSubmit={handleFormSubmit}
                    noValidate
                    className="flex min-h-0 flex-1 flex-col"
                >
                    <section
                        key={currentStep}
                        ref={stepRef}
                        className={`${direction === "back" ? "pd-step-back" : "pd-step-forward"} flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-6 pb-4 pt-8 pd-no-scrollbar`}
                    >
                        {currentStep === "role" && (
                            <>
                                <RoleStep
                                    role={role}
                                    onChoose={chooseRole}
                                    error={fieldErrors.role}
                                    startJourney={t("auth.startJourney", { brand: BRAND.name })}
                                />
                                <div className="flex flex-col gap-4">
                                    <OrDivider />
                                    <GoogleButton onClick={handleGoogleSignup} disabled={loading}>
                                        {loading && signupStep ? signupStep : t("auth.continueWithGoogle")}
                                    </GoogleButton>
                                </div>
                            </>
                        )}

                        {currentStep === "name" && (
                            <>
                                <StepHeading
                                    title="What is your name?"
                                    subtitle="This is how drivers and passengers will see you."
                                />
                                <div className="flex flex-col gap-5">
                                    <AuthField
                                        id="signup-first-name"
                                        name="firstName"
                                        label={t("auth.firstName")}
                                        icon={User}
                                        type="text"
                                        autoComplete="given-name"
                                        autoCapitalize="words"
                                        required
                                        maxLength={80}
                                        autoFocus
                                        value={form.firstName}
                                        onChange={(e) => updateField("firstName", e.target.value)}
                                        error={fieldErrors.firstName}
                                    />
                                    <AuthField
                                        id="signup-last-name"
                                        name="lastName"
                                        label={t("auth.lastName")}
                                        icon={User}
                                        type="text"
                                        autoComplete="family-name"
                                        autoCapitalize="words"
                                        required
                                        maxLength={80}
                                        value={form.lastName}
                                        onChange={(e) => updateField("lastName", e.target.value)}
                                        error={fieldErrors.lastName}
                                    />
                                </div>
                            </>
                        )}

                        {currentStep === "email" && (
                            <>
                                <StepHeading
                                    title="What is your email address?"
                                    subtitle="We will send a verification code to this email."
                                />
                                <AuthField
                                    id="signup-email"
                                    name="email"
                                    label={t("auth.emailAddress")}
                                    icon={Mail}
                                    type="email"
                                    inputMode="email"
                                    autoComplete="email"
                                    required
                                    maxLength={80}
                                    autoFocus
                                    size="lg"
                                    placeholder={t("auth.enterEmail")}
                                    value={form.email}
                                    onChange={(e) => updateField("email", e.target.value)}
                                    error={fieldErrors.email}
                                />
                            </>
                        )}

                        {currentStep === "password" && (
                            <>
                                <StepHeading
                                    title="Create a password"
                                    subtitle="Use something strong that you do not use anywhere else."
                                />
                                <div className="flex flex-col gap-4">
                                    <AuthField
                                        id="signup-password"
                                        name="password"
                                        label={t("auth.password")}
                                        icon={Lock}
                                        type={showPassword ? "text" : "password"}
                                        autoComplete="new-password"
                                        required
                                        minLength={8}
                                        maxLength={128}
                                        autoFocus
                                        size="lg"
                                        value={form.password}
                                        onChange={(e) => updateField("password", e.target.value)}
                                        error={fieldErrors.password}
                                        trailing={
                                            <PasswordToggle
                                                visible={showPassword}
                                                onToggle={() => setShowPassword((v) => !v)}
                                            />
                                        }
                                    />
                                    <PasswordRule met={form.password.length >= 8} />
                                </div>
                            </>
                        )}

                        {currentStep === "phone" && (
                            <>
                                <StepHeading
                                    title="What is your phone number?"
                                    subtitle="Optional. It helps drivers and passengers reach you during a ride."
                                />
                                <AuthField
                                    id="signup-phone"
                                    name="phone"
                                    label="Phone Number (optional)"
                                    icon={Phone}
                                    type="tel"
                                    inputMode="tel"
                                    autoComplete="tel"
                                    maxLength={20}
                                    autoFocus
                                    size="lg"
                                    placeholder="+92 300 1234567"
                                    value={form.phone}
                                    onChange={(e) => updateField("phone", e.target.value)}
                                    error={fieldErrors.phone}
                                />
                            </>
                        )}

                        {isReview && (
                            <ReviewStep
                                role={role}
                                form={form}
                                onEdit={(step) => goTo(STEPS.indexOf(step))}
                                disabled={loading}
                            />
                        )}
                    </section>

                    <footer className="flex flex-col gap-4 px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-3">
                        <FormError>{error}</FormError>

                        {isReview ? (
                            <PrimaryButton
                                type="submit"
                                loading={loading}
                                loadingLabel={signupStep || t("auth.checking")}
                            >
                                {t("auth.createAccount")}
                                <ArrowRight
                                    className="h-5 w-5 transition-transform group-hover:translate-x-0.5"
                                    strokeWidth={2.5}
                                    aria-hidden="true"
                                />
                            </PrimaryButton>
                        ) : (
                            <PrimaryButton type="submit" disabled={loading}>
                                Continue
                                <ArrowRight
                                    className="h-5 w-5 transition-transform group-hover:translate-x-0.5"
                                    strokeWidth={2.5}
                                    aria-hidden="true"
                                />
                            </PrimaryButton>
                        )}

                        {currentStep === "phone" && (
                            <button
                                type="button"
                                onClick={skipPhone}
                                className="h-11 rounded-2xl text-sm font-semibold text-pd-muted transition-colors hover:text-pd-text outline-none focus-visible:ring-2 focus-visible:ring-pd-accent"
                            >
                                Skip for now
                            </button>
                        )}

                        {currentStep === "role" && (
                            <p className="text-center text-sm text-pd-muted">
                                {t("auth.alreadyHaveAccount")}{" "}
                                <Link
                                    href="/login"
                                    className="rounded-md font-bold text-pd-accent-text outline-none focus-visible:ring-2 focus-visible:ring-pd-accent"
                                >
                                    {t("auth.signIn")}
                                </Link>
                            </p>
                        )}
                    </footer>
                </form>
            </div>
        </main>
    );
}

function StepHeading({ title, subtitle }) {
    return (
        <div className="flex flex-col gap-2.5">
            <h1 className="text-balance text-[clamp(28px,8vw,34px)] font-extrabold leading-[1.12] tracking-tight">
                {title}
            </h1>
            {subtitle && (
                <p className="text-pretty text-base leading-relaxed text-pd-muted">{subtitle}</p>
            )}
        </div>
    );
}

function RoleStep({ role, onChoose, error, startJourney }) {
    return (
        <>
            <StepHeading
                title="Are you joining as a passenger or a driver?"
                subtitle={startJourney}
            />

            <div className="flex flex-col gap-3">
                <div
                    role="radiogroup"
                    aria-label="Join as"
                    aria-describedby={error ? "signup-role-error" : undefined}
                    className="flex flex-col gap-3"
                >
                    {ROLE_OPTIONS.map((option) => {
                        const selected = role === option.value;
                        const Icon = option.icon;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => onChoose(option.value)}
                                className={`flex items-center gap-4 rounded-3xl border-[1.5px] p-4 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-pd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pd-bg active:scale-[0.99] ${
                                    selected
                                        ? "border-pd-accent bg-pd-accent-soft shadow-pd"
                                        : "border-pd-line bg-pd-surface hover:border-pd-line-strong"
                                }`}
                            >
                                <span
                                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-colors ${
                                        selected
                                            ? "bg-pd-accent text-pd-accent-ink"
                                            : "bg-pd-surface-2 text-pd-text-2"
                                    }`}
                                >
                                    <Icon className="h-6 w-6" aria-hidden="true" />
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="text-base font-bold">{option.title}</span>
                                    <span className="text-sm leading-relaxed text-pd-muted">
                                        {option.description}
                                    </span>
                                </span>
                                <span
                                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                                        selected
                                            ? "border-pd-accent bg-pd-accent text-pd-accent-ink"
                                            : "border-pd-line-strong"
                                    }`}
                                    aria-hidden="true"
                                >
                                    {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                                </span>
                            </button>
                        );
                    })}
                </div>
                {error && (
                    <p id="signup-role-error" role="alert" className="text-sm font-medium text-pd-danger">
                        {error}
                    </p>
                )}
            </div>
        </>
    );
}

function PasswordRule({ met }) {
    return (
        <p
            className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                met ? "text-pd-accent-text" : "text-pd-muted"
            }`}
        >
            <span
                className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
                    met ? "bg-pd-accent text-pd-accent-ink" : "bg-pd-surface-3 text-transparent"
                }`}
                aria-hidden="true"
            >
                <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            At least 8 characters
        </p>
    );
}

function ReviewStep({ role, form, onEdit, disabled }) {
    const roleLabel = ROLE_OPTIONS.find((o) => o.value === role)?.title ?? "Passenger";
    const rows = [
        { step: "role", label: "Joining as", value: roleLabel },
        { step: "name", label: "Name", value: `${form.firstName} ${form.lastName}`.trim() },
        { step: "email", label: "Email", value: form.email.trim() },
        { step: "password", label: "Password", value: "•".repeat(Math.min(form.password.length, 12)) },
        { step: "phone", label: "Phone", value: form.phone.trim() || "Not added" },
    ];

    return (
        <>
            <StepHeading
                title="Everything look right?"
                subtitle="Review your details before we create your account."
            />

            <dl className="flex flex-col overflow-hidden rounded-3xl border border-pd-line bg-pd-surface">
                {rows.map((row, i) => (
                    <div
                        key={row.step}
                        className={`flex items-center gap-4 px-4 py-3.5 ${i > 0 ? "border-t border-pd-line" : ""}`}
                    >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-pd-faint">
                                {row.label}
                            </dt>
                            <dd
                                className={`truncate text-base font-semibold ${
                                    row.value === "Not added" ? "text-pd-muted" : "text-pd-text"
                                }`}
                            >
                                {row.value}
                            </dd>
                        </div>
                        <button
                            type="button"
                            onClick={() => onEdit(row.step)}
                            disabled={disabled}
                            aria-label={`Edit ${row.label.toLowerCase()}`}
                            className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-pd-accent-text transition-colors hover:bg-pd-accent-soft outline-none focus-visible:ring-2 focus-visible:ring-pd-accent disabled:opacity-40"
                        >
                            Edit
                        </button>
                    </div>
                ))}
            </dl>
        </>
    );
}
