import { NextResponse } from 'next/server';

export async function GET() {
	const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>Invest-igator API Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/api/docs"
      data-theme="purple"
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
	`;

	return new NextResponse(html, {
		headers: {
			'content-type': 'text/html'
		}
	});
}
