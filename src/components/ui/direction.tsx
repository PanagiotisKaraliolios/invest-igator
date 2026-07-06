'use client';

import { DirectionProvider as DirectionProviderPrimitive, useDirection } from '@base-ui/react/direction-provider';
import type * as React from 'react';

// Radix's DirectionProvider took `dir`; Base UI's takes `direction`. Accept both
// for API compatibility and forward to Base UI's `direction` prop.
function DirectionProvider({
	dir,
	direction,
	children
}: {
	children?: React.ReactNode;
	dir?: 'ltr' | 'rtl';
	direction?: 'ltr' | 'rtl';
}) {
	return <DirectionProviderPrimitive direction={direction ?? dir ?? 'ltr'}>{children}</DirectionProviderPrimitive>;
}

export { DirectionProvider, useDirection };
