import { signOut } from "next-auth/react";

export interface FileMakerSignOutButtonProps {
  /** Where to redirect after sign out. Defaults to `/login`. */
  callbackUrl?: string;
  /** Button label or custom children. Defaults to "Sign out". */
  children?: React.ReactNode;
  /** CSS class applied to the `<button>` element. */
  className?: string;
}

/**
 * A sign-out button that calls `signOut()` from next-auth/react.
 * Must be rendered inside a Client Component.
 *
 * @example
 * ```tsx
 * import { FileMakerSignOutButton } from "@research-allies/next-auth-filemaker-idp/client";
 *
 * export function LogoutButton() {
 *   return <FileMakerSignOutButton callbackUrl="/login" />;
 * }
 * ```
 */
export function FileMakerSignOutButton({
  callbackUrl = "/login",
  children = "Sign out",
  className,
}: FileMakerSignOutButtonProps) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => signOut({ callbackUrl })}
    >
      {children}
    </button>
  );
}
