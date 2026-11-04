"use client";

export default function AuthField({
    id,
    label,
    icon: Icon,
    error,
    hint,
    trailing,
    size = "md",
    ...inputProps
}) {
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
    const heightClass = size === "lg" ? "h-16" : "h-14";
    const textClass = size === "lg" ? "text-lg font-semibold" : "text-base";

    return (
        <div className="flex flex-col gap-2">
            <label htmlFor={id} className="text-sm font-semibold text-pd-text-2">
                {label}
            </label>

            <div
                className={`group flex ${heightClass} items-center gap-3 rounded-2xl border-[1.5px] bg-pd-surface-2 px-4 transition-colors focus-within:border-pd-accent focus-within:bg-pd-surface ${
                    error ? "border-pd-danger" : "border-transparent"
                }`}
            >
                {Icon && (
                    <Icon
                        className={`h-5 w-5 shrink-0 transition-colors group-focus-within:text-pd-accent ${
                            error ? "text-pd-danger" : "text-pd-faint"
                        }`}
                        aria-hidden="true"
                    />
                )}
                <input
                    id={id}
                    aria-invalid={error ? "true" : undefined}
                    aria-describedby={describedBy}
                    className={`h-full min-w-0 flex-1 bg-transparent ${textClass} text-pd-text outline-none placeholder:font-normal placeholder:text-pd-faint`}
                    {...inputProps}
                />
                {trailing}
            </div>

            {error ? (
                <p id={`${id}-error`} role="alert" className="text-sm font-medium text-pd-danger">
                    {error}
                </p>
            ) : hint ? (
                <p id={`${id}-hint`} className="text-sm text-pd-muted">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}
