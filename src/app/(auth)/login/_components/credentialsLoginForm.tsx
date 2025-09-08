"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function CredentialsLoginForm() {
	const router = useRouter();
	const sp = useSearchParams();
	const callbackUrl = sp.get("callbackUrl") ?? "/dashboard";

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		if (!email || !password) {
			setError("Email and password are required.");
			return;
		}
		setSubmitting(true);
		try {
			const result = await signIn("credentials", {
				email: email.trim().toLowerCase(),
				password,
				redirect: false,
				// callbackUrl,
			});

			console.log("credentials signIn result:", result);

			// Success: NextAuth returns a URL when redirect is false. Fallback to callbackUrl.
			if (!result?.error && (result?.url || result?.ok)) {
				router.replace(result.url ?? callbackUrl);
				return;
			}

			// Normalize error message
			const code = result?.error;
			const message =
				code === "CredentialsSignin" || code === "Invalid Email or Password"
					? "Invalid email or password."
					: code || "Invalid email or password.";
			setError(message);
		} catch (err) {
			setError("Something went wrong. Please try again.");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form onSubmit={onSubmit}>
			<div className="grid gap-6">
				{error ? (
					<Alert variant="destructive">
						<AlertTitle>Sign-in failed</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}
				<div className="grid gap-3">
					<Label htmlFor="cred-email">Email</Label>
					<Input
						id="cred-email"
						type="email"
						placeholder="m@example.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						disabled={submitting}
						required
					/>
				</div>
				<div className="grid gap-3">
					<div className="flex items-center">
						<Label htmlFor="cred-password">Password</Label>
						<a
							href="/forgot-password"
							className="ml-auto text-sm underline-offset-4 hover:underline"
						>
							Forgot your password?
						</a>
					</div>
					<Input
						id="cred-password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						disabled={submitting}
						required
					/>
				</div>
				<Button type="submit" className="w-full" disabled={submitting}>
					{submitting ? "Logging in…" : "Login"}
				</Button>
			</div>
		</form>
	);
}
