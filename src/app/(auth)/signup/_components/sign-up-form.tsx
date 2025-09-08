"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { api } from "@/trpc/react";

const schema = z
	.object({
		name: z.string().min(2, "Name must be at least 2 characters"),
		email: z.email(),
		password: z
			.string()
			.min(8, "Password must be at least 8 characters")
			.regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Use letters and numbers"),
		confirmPassword: z.string(),
	})
	.refine((vals) => vals.password === vals.confirmPassword, {
		path: ["confirmPassword"],
		message: "Passwords do not match",
	});

export function SignUpForm() {
	const form = useForm<z.infer<typeof schema>>({
		resolver: zodResolver(schema),
		defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
	});

	const [info, setInfo] = useState<string | null>(null);

	const signupMutation = api.auth.signup.useMutation();

	async function onSubmit(values: z.infer<typeof schema>) {
		setInfo(null);
		try {
			await signupMutation.mutateAsync(values);
			setInfo("Account created. Check your email for a sign-in link.");
			await signIn("nodemailer", { email: values.email, redirect: false });
		} catch (err) {
			const message = (err as { message?: string })?.message ?? "Failed to create account";
			if (message.includes("already exists")) {
				form.setError("email", { type: "manual", message });
			} else {
				form.setError("name", { type: "manual", message });
			}
		}
	}

	return (
		<Card>
			<CardHeader className="text-center">
				<CardTitle className="text-xl">Create your account</CardTitle>
				<CardDescription>Sign up with your name and email</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
									<FormControl>
										<Input placeholder="Jane Doe" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="email"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email</FormLabel>
									<FormControl>
										<Input placeholder="jane@example.com" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="password"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Password</FormLabel>
									<FormControl>
										<Input type="password" placeholder="••••••••" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="confirmPassword"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Confirm password</FormLabel>
									<FormControl>
										<Input type="password" placeholder="••••••••" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						{info ? (
							<div className="rounded bg-muted/50 p-3 text-sm">{info}</div>
						) : null}
						<Button
							className="h-auto w-full whitespace-normal break-words leading-tight"
							type="submit"
							disabled={signupMutation.isPending}
						>
							{signupMutation.isPending ? "Creating…" : "Create account"}
						</Button>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
