import { env } from "@/env";
import { GalleryVerticalEnd } from "lucide-react";
import { auth } from "@/server/auth";
import { redirect } from "next/navigation";
import { SignUpForm } from "./_components/sign-up-form";

export const dynamic = "force-dynamic";
export const metadata = {
	title: `Sign up - ${env.APP_NAME}`,
	description: "Create an account",
	icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default async function SignUpPage() {
	const session = await auth();
	if (session?.user) redirect("/");

	return (
		<div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
			<div className="flex w-full max-w-sm flex-col gap-6">
				<a href="/" className="flex items-center gap-2 self-center font-medium">
					<div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
						<GalleryVerticalEnd className="size-4" />
					</div>
					{env.APP_NAME}
				</a>
				<SignUpForm />
			</div>
		</div>
	);
}
