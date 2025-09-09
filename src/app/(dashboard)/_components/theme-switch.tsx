"use client";

import { useId } from "react";
import { Switch, SwitchIndicator, SwitchWrapper } from "@/components/ui/switch";
import { Moon, Sun } from "lucide-react";
import { useThemeSwitch } from "@/hooks/use-theme";

export default function ThemeSwitch() {
	const id = useId();
	const { isLight, setIsLight, mounted } = useThemeSwitch();
	return (
		<div className="flex items-center space-x-2.5">
			<SwitchWrapper>
				<Switch
					id={id}
					size="md"
					aria-label="Toggle light/dark theme"
					checked={mounted ? isLight : undefined}
					onCheckedChange={(checked) => setIsLight(Boolean(checked))}
				/>
				<SwitchIndicator state="on">
					<Sun className="size-4 text-primary-foreground" />
				</SwitchIndicator>
				<SwitchIndicator state="off">
					<Moon className="size-4 text-muted-foreground" />
				</SwitchIndicator>
			</SwitchWrapper>
		</div>
	);
}
