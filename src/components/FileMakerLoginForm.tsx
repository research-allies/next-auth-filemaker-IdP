import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";

export interface FileMakerLoginFormProps {
  /** Provider ID to sign in with. Defaults to `"filemaker"`. Must match the `id` passed to `createFileMakerProvider`. */
  providerId?: string;
  /** Where to redirect after successful login. Defaults to the originating page or `/`. */
  callbackUrl?: string;
  /** CSS class applied to the outer `<form>` element for custom styling. */
  className?: string;
  /** Called with an error message string when authentication fails. */
  onError?: (error: string) => void;
}

/**
 * A ready-to-use login form that authenticates against the FileMaker provider.
 * Calls `signIn("filemaker", ...)` on submit and handles basic error display.
 *
 * @example
 * ```tsx
 * // app/login/page.tsx
 * import { FileMakerLoginForm } from "@research-allies/next-auth-filemaker-idp";
 *
 * export default function LoginPage() {
 *   return <FileMakerLoginForm callbackUrl="/dashboard" />;
 * }
 * ```
 */
export function FileMakerLoginForm({
  providerId = "filemaker",
  callbackUrl = "/",
  className,
  onError,
}: FileMakerLoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const result = await signIn(providerId, {
        username,
        password,
        callbackUrl,
        redirect: false,
      });

      if (result?.error) {
        const message = "Invalid username or password.";
        setError(message);
        onError?.(message);
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      const message = "An unexpected error occurred. Please try again.";
      setError(message);
      onError?.(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div>
        <label htmlFor="fm-username">Username</label>
        <input
          id="fm-username"
          name="username"
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={pending}
        />
      </div>

      <div>
        <label htmlFor="fm-password">Password</label>
        <input
          id="fm-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
      </div>

      {error && <p role="alert">{error}</p>}

      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
