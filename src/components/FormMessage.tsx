export function FormMessage({ state }: { state?: { error?: string; message?: string } }) {
  if (!state?.error && !state?.message) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`rounded-lg px-3 py-2.5 text-sm ${state.error ? "bg-danger-bg text-danger" : "bg-ok-bg text-accent-ink"}`}
    >
      {state.error ?? state.message}
    </p>
  );
}
