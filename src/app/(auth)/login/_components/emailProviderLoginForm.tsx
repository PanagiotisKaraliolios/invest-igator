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
import { useCheckEmailMutation } from "../_mutations/useCheckEmail";

const formSchema = z.object({
	email: z.email(),
});

export function EmailProviderLoginForm() {
	const searchParams = useSearchParams();

	const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

	// 1. Define your form.
	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			email: "",
		},
	});

	const [info, setInfo] = useState<string | null>(null);

	const checkEmailMutation = useCheckEmailMutation();

	// 2. Define a submit handler.
	async function onSubmit(values: z.infer<typeof formSchema>) {
		setInfo(null);
		try {
			const data = await checkEmailMutation.mutateAsync(values.email);
			if (!data?.exists) {
				form.setError("email", {
					type: "manual",
					message: "No account found for this email. Create an account first.",
				});
				return;
			}
			await signIn("nodemailer", {
				email: values.email,
				callbackUrl,
			});
		} catch (e) {
			form.setError("email", {
				type: "manual",
				message:
					(e as { message?: string })?.message ??
					"Something went wrong. Please try again.",
			});
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
					disabled={checkEmailMutation.isPending}
				>
					{checkEmailMutation.isPending
						? "Sending…"
						: "Get one-time login link"}
				</Button>
				{info ? (
					<div className="rounded bg-muted/50 p-3 text-sm">{info}</div>
				) : null}
			</form>
		</Form>
	);
}
