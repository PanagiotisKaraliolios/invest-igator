import Link from "next/link";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export const metadata = {
	title: "Check your email",
	description: "Confirm your sign-in link",
};

export default function VerifyRequestPage({
	searchParams,
}: {
	searchParams?: { [key: string]: string | string[] };
}) {
	const rawEmail = searchParams?.email;
	const email =
		Array.isArray(rawEmail) && rawEmail.length > 0
			? rawEmail[0]
			: typeof rawEmail === "string"
				? rawEmail
				: null;

	return (
		<div className="flex min-h-screen items-center justify-center p-6">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<CardTitle>Check your email</CardTitle>
					<CardDescription>
						We&apos;ve sent you a sign-in link{email ? ` to ${email}` : ""}. It
						may take a few minutes to arrive — check your spam folder if you
						don&apos;t see it.
					</CardDescription>
				</CardHeader>
				<CardContent className="text-sm">
					<p className="mb-4">
						Once you click the link in the email you will be signed in
						automatically.
					</p>
					<div className="flex justify-center">
						<Link href="/login" className="underline">
							Back to login
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
