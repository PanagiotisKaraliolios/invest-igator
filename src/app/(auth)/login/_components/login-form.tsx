import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ProvidersList from "./providersList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmailProviderLoginForm } from "./emailProviderLoginForm";
import { Skeleton } from "@/components/ui/skeleton";
export function LoginForm({
	className,
	errorCode,
	...props
}: React.ComponentProps<"div"> & { errorCode?: string }) {
	return (
		<div className={cn("flex flex-col gap-6", className)} {...props}>
			<Card>
				<CardHeader className="text-center">
					<CardTitle className="text-xl">Welcome back</CardTitle>
					<CardDescription>
						Login with your Discord or Google account
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-6">
						{errorCode === "OAuthAccountNotLinked" ? (
							<Alert variant="destructive">
								<AlertTitle>Account not linked</AlertTitle>
								<AlertDescription>
									This email is already linked to a different sign-in provider. Sign in with the original provider and then link this provider through your account settings.
								</AlertDescription>
							</Alert>
						) : null}
						<ProvidersList />
						{/* Form to login with Email one time link */}
						<EmailProviderLoginForm />
						<div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-border after:border-t">
							<span className="relative z-10 bg-card px-2 text-muted-foreground">
								Or continue with
							</span>
						</div>
						<form>
							<div className="grid gap-6">
								<div className="grid gap-3">
									<Label htmlFor="email">Email</Label>
									<Input
										id="email"
										type="email"
										placeholder="m@example.com"
										required
									/>
								</div>
								<div className="grid gap-3">
									<div className="flex items-center">
										<Label htmlFor="password">Password</Label>
										<a
											href="/forgot-password"
											className="ml-auto text-sm underline-offset-4 hover:underline"
										>
											Forgot your password?
										</a>
									</div>
									<Input id="password" type="password" required />
								</div>
								<Button type="submit" className="w-full">
									Login
								</Button>
							</div>
						</form>
						<div className="text-center text-sm">
							Don&apos;t have an account?{" "}
							<a href="/signup" className="underline underline-offset-4">
								Sign up
							</a>
						</div>
					</div>
				</CardContent>
			</Card>
			<div className="text-balance text-center text-muted-foreground text-xs *:[a]:underline *:[a]:underline-offset-4 *:[a]:hover:text-primary">
				By clicking continue, you agree to our <a href="/">Terms of Service</a>{" "}
				and <a href="/">Privacy Policy</a>.
			</div>
		</div>
	);
}
