// Build-time banner for non-production environments (e.g. Stage).
// NEXT_PUBLIC_ENV_BANNER is inlined at build time; when empty, nothing renders.
const label = process.env.NEXT_PUBLIC_ENV_BANNER ?? "";

export function EnvBanner() {
  if (!label) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 w-full bg-amber-500 py-1 text-center text-sm font-medium text-black"
    >
      {label}
    </div>
  );
}
