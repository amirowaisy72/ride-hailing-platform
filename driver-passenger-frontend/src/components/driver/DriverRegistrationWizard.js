// Shared step indicator for the driver registration wizard:
// Step 1 Documents -> Step 2 Vehicle -> Step 3 Review & Submit.
// One component reused by the documents, vehicles and services pages,
// so "Become a driver" and the normal registration flow show the
// exact same wizard. There is no separate wizard screen: the wizard
// IS this stepper wrapped around the existing pages.
export default function DriverRegistrationWizard({ currentStep }) {
    const steps = ["Documents", "Vehicle", "Review & Submit"];

    return (
        <nav
            aria-label="Driver registration steps"
            className="rounded-[24px] bg-pd-surface p-5 shadow-sm"
        >
            <p className="text-xs font-extrabold uppercase tracking-wider text-pd-muted">
                Driver registration
            </p>
            <ol className="mt-4 flex items-start">
                {steps.map((label, index) => {
                    const step = index + 1;
                    const done = step < currentStep;
                    const current = step === currentStep;
                    return (
                        <li
                            key={label}
                            className="flex flex-1 flex-col items-center text-center"
                        >
                            <span
                                aria-current={current ? "step" : undefined}
                                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold ${
                                    done
                                        ? "bg-[#087F5B] text-white"
                                        : current
                                          ? "bg-[#087F5B] text-white ring-4 ring-emerald-100"
                                          : "bg-pd-surface-2 text-pd-muted"
                                }`}
                            >
                                {done ? "✓" : step}
                            </span>
                            <span
                                className={`mt-2 text-[11px] font-bold leading-tight ${
                                    current ? "text-[#087F5B]" : "text-pd-muted"
                                }`}
                            >
                                Step {step}: {label}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
