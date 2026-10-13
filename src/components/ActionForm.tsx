"use client";

import { useActionState } from "react";
import { FormMessage } from "./FormMessage";

type State = { error?: string; message?: string } | undefined;

/** Small wrapper so server components can render admin forms with inline success/error feedback. */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: State, form: FormData) => Promise<State>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {state && (
        <div className="mt-3">
          <FormMessage state={state} />
        </div>
      )}
    </form>
  );
}
