"use client";

import { useMutation } from "@tanstack/react-query";

type CheckEmailResponse = { exists?: boolean };
type CheckEmailError = { message: string };

export function useCheckEmailMutation() {
	return useMutation<CheckEmailResponse, CheckEmailError, string>({
		mutationFn: async (email: string) => {
			const res = await fetch(
				`/api/auth/check-email?email=${encodeURIComponent(email)}`,
			);
			if (!res.ok) {
				throw { message: "Failed to validate email" } satisfies CheckEmailError;
			}
			return (await res.json()) as CheckEmailResponse;
		},
	});
}
