import clsx from "clsx";

type InlineNoticeProps = {
  tone?: "info" | "success" | "error";
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

const toneStyles: Record<NonNullable<InlineNoticeProps["tone"]>, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-700"
};

export function InlineNotice({
  tone = "info",
  text,
  actionLabel,
  onAction,
  className
}: InlineNoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx("flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm", toneStyles[tone], className)}
    >
      <p>{text}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="rounded border border-current/30 bg-white/80 px-2.5 py-1 text-xs font-semibold"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
