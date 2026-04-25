import clsx from "clsx";
import { cloneElement, isValidElement, useId, type ReactElement } from "react";

export const formControlClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-ink placeholder:text-slate-400";

export const formControlCompactClass =
  "w-full rounded border border-slate-300 px-2 py-1 text-xs text-ink placeholder:text-slate-400";

type FormFieldProps = {
  label: string;
  helperText?: string;
  errorText?: string;
  required?: boolean;
  className?: string;
  controlId?: string;
  children: React.ReactNode;
};

function mergeDescribedBy(
  existing: unknown,
  helperId: string | undefined,
  errorId: string | undefined
): string | undefined {
  const tokens = new Set<string>();
  const existingTokens = typeof existing === "string" ? existing.split(/\s+/).filter(Boolean) : [];
  for (const token of existingTokens) tokens.add(token);
  if (helperId) tokens.add(helperId);
  if (errorId) tokens.add(errorId);
  return tokens.size ? Array.from(tokens).join(" ") : undefined;
}

export function FormField({
  label,
  helperText,
  errorText,
  required = false,
  className,
  controlId,
  children
}: FormFieldProps) {
  const generatedId = useId();
  const helperId = helperText ? `${controlId || generatedId}-hint` : undefined;
  const errorId = errorText ? `${controlId || generatedId}-error` : undefined;
  const enhancedChild = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id || controlId || generatedId,
        "aria-invalid": errorText ? true : undefined,
        "aria-describedby": mergeDescribedBy(
          (children.props as { "aria-describedby"?: string })["aria-describedby"],
          helperId,
          errorId
        )
      })
    : children;

  return (
    <label className={clsx("block", className)} htmlFor={controlId || generatedId}>
      <span className="mb-1 block text-sm font-semibold text-slate-700">
        {label}
        {required ? " *" : ""}
      </span>
      {enhancedChild}
      {helperText && (
        <span id={helperId} className="mt-1 block text-xs text-slate-500">
          {helperText}
        </span>
      )}
      {errorText && (
        <span id={errorId} className="mt-1 block text-xs font-semibold text-red-700" role="alert" aria-live="polite">
          {errorText}
        </span>
      )}
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
