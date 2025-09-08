"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

const formSchema = z.object({
	email: z.email(),
});

export function EmailProviderLoginForm() {
	const searchParams = useSearchParams();

	const callbackUrl = searchParams.get("callbackUrl") ?? "/";

	// 1. Define your form.
	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			email: "",
		},
	});

		const [submitting, setSubmitting] = useState(false);
		const [info, setInfo] = useState<string | null>(null);

	// 2. Define a submit handler.
		async function onSubmit(values: z.infer<typeof formSchema>) {
			setInfo(null);
			setSubmitting(true);
			try {
				// Pre-check email existence via API
				const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(values.email)}`);
				if (!res.ok) {
					throw new Error("Failed to validate email");
				}
				const data = (await res.json()) as { exists?: boolean };
				if (!data.exists) {
					form.setError("email", { type: "manual", message: "No account found for this email. Create an account first." });
					return;
				}

				// Proceed with magic link flow without immediate redirect
				const result = await signIn("nodemailer", {
					email: values.email,
					callbackUrl,
					redirect: false,
				});
				if (result && "error" in result && result.error) {
					form.setError("email", { type: "manual", message: result.error });
					return;
				}
				setInfo("Check your email for the sign-in link.");
			} catch (e) {
				form.setError("email", { type: "manual", message: "Something went wrong. Please try again." });
			} finally {
				setSubmitting(false);
			}
		}

	return (
		<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
				<FormField
					control={form.control}
					name="email"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Email</FormLabel>
							<FormControl>
										<Input placeholder="m@example.com" {...field} />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<Button
					className="h-auto w-full whitespace-normal break-words leading-tight"
							type="submit"
							disabled={submitting}
				>
							{submitting ? "Sending…" : "Get one-time login link"}
				</Button>
						{info ? (
							<div className="rounded bg-muted/50 p-3 text-sm">{info}</div>
						) : null}
			</form>
		</Form>
	);
}
