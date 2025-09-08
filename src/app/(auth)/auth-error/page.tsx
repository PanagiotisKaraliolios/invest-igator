import Link from "next/link";

type Props = {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const ERROR_MESSAGES: Record<string, string> = {
	Configuration: "There is a problem with the server configuration. Check if your provider options and environment variables are correct.",
	AccessDenied: "Access was denied. This usually happens when a callback or signIn check blocks the request.",
	Verification: "The verification token is invalid, expired, or has already been used. Request a new magic link.",
	Default: "An unexpected error occurred. Please try again.",
};

function friendlyMessage(code?: string | string[]) {
	const key = Array.isArray(code) ? code[0] : code;
	if (!key) return ERROR_MESSAGES.Default;
	return ERROR_MESSAGES[key] ?? `${ERROR_MESSAGES.Default} (${key})`;
}

export default async function AuthErrorPage({ searchParams }: Props) {
	const sp = await searchParams;
	const code = sp?.error;
	const description = sp?.error_description as string | undefined;

	return (
		<main className="flex min-h-screen items-center justify-center bg-background p-6">
			<div className="w-full max-w-lg rounded-lg bg-card p-8 shadow">
				<h1 className="mb-2 font-semibold text-2xl">Authentication error</h1>
				<p className="mb-4 text-muted-foreground">{friendlyMessage(code)}</p>
				{code ? (
					<div className="mb-4 text-muted-foreground text-xs">Error code: <strong>{Array.isArray(code) ? code[0] : code}</strong></div>
				) : null}
				{description ? (
					<div className="mb-4 rounded bg-muted/50 p-3 text-sm">
						{description}
					</div>
				) : null}

				<div className="flex gap-3">
					<Link
						href="/login"
						className="inline-block rounded bg-primary px-4 py-2 text-primary-foreground"
					>
						Back to sign in
					</Link>
					<Link href="/" className="inline-block rounded border px-4 py-2">
						Home
					</Link>
				</div>
			</div>
		</main>
	);
}
