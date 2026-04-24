import clsx from "clsx";

export const formControlClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-ink placeholder:text-slate-400";

export const formControlCompactClass =
  "w-full rounded border border-slate-300 px-2 py-1 text-xs text-ink placeholder:text-slate-400";

type FormFieldProps = {
  label: string;
  helperText?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function FormField({ label, helperText, required = false, className, children }: FormFieldProps) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-sm font-semibold text-slate-700">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
      {helperText && <span className="mt-1 block text-xs text-slate-500">{helperText}</span>}
    </label>
  );
}

type FormSubmitButtonProps = {
  isLoading: boolean;
  idleLabel: string;
  loadingLabel: string;
  className?: string;
  type?: "button" | "submit";
};

export function FormSubmitButton({
  isLoading,
  idleLabel,
  loadingLabel,
  className,
  type = "submit"
}: FormSubmitButtonProps) {
  return (
    <button type={type} disabled={isLoading} className={clsx("disabled:opacity-50", className)}>
      {isLoading ? loadingLabel : idleLabel}
    </button>
  );
}
