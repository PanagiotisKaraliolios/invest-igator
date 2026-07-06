import type * as React from 'react';

// Base UI has no AspectRatio primitive. Radix's AspectRatio mapped `ratio` onto
// the CSS `aspect-ratio` property, so render a plain div that does the same.
function AspectRatio({ ratio = 1, style, ...props }: React.ComponentProps<'div'> & { ratio?: number }) {
	return <div data-slot='aspect-ratio' style={{ aspectRatio: ratio, ...style }} {...props} />;
}

export { AspectRatio };
