"use client";

import { useMutation } from "@tanstack/react-query";

type SignupInput = {
	name: string;
	email: string;
	password: string;
	confirmPassword: string;
};

type SignupResponse = { ok?: boolean };
type SignupError = { message: string };

export function useSignupMutation() {
	return useMutation<SignupResponse, SignupError, SignupInput>({
		mutationFn: async (values: SignupInput) => {
			const res = await fetch("/api/auth/signup", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: values.name,
					email: values.email,
					password: values.password,
				}),
			});
			if (!res.ok) {
				const data = (await res
					.json()
					.catch(() => ({}) as { error?: string })) as { error?: string };
				const message = data?.error ?? "Failed to create account";
				throw { message } satisfies SignupError;
			}
			return (await res.json()) as SignupResponse;
		},
	});
}
