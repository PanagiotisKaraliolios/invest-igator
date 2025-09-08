"use client";

import { useEffect, useState } from "react";
import { getProviders } from "next-auth/react";

import ProviderLoginButton from "./providerLoginButton";
import type { ClientSafeProvider } from "node_modules/next-auth/lib/client";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProvidersList() {
	const [providers, setProviders] = useState<ClientSafeProvider[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		getProviders()
			.then((p) => {
				if (!p) return setProviders([]);
				setProviders(Object.values(p));
			})
			.finally(() => setLoading(false));
	}, []);

	if (loading) {
		return (
			<div className="grid gap-4">
				<Skeleton className="h-10 w-full rounded-md" />
				{/* <Skeleton className="h-10 w-full rounded-md" /> */}
			</div>
		);
	}

	if (!providers.length) return null;

	return (
		<div className="grid gap-4">
			{providers
				.filter((provider) => provider.type !== "email")
				.map((provider) => (
					<ProviderLoginButton key={provider.id} provider={provider.id} />
				))}
		</div>
	);
}
