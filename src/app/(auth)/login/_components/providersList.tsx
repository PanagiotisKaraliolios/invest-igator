"use client";

import { useEffect, useState } from "react";
import { getProviders } from "next-auth/react";

import ProviderLoginButton from "./providerLoginButton";
import type { ClientSafeProvider } from "node_modules/next-auth/lib/client";

export default function ProvidersList() {
	const [providers, setProviders] = useState<ClientSafeProvider[]>([]);

	useEffect(() => {
		getProviders().then((p) => {
			if (!p) return setProviders([]);
			setProviders(Object.values(p));
		});
	}, []);

	if (!providers.length) return null;

	return (
		<div className="grid gap-4">
			{providers
				.filter((provider) => provider.name !== "Email")
				.map((provider) => (
					<ProviderLoginButton key={provider.id} provider={provider.id} />
				))}
		</div>
	);
}
