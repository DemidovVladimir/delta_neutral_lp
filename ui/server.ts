/**
 * Bun Development Server for React UI
 * Serves the React app with Bun's built-in transpilation
 */

const PORT = process.env.PORT || 3000;

// Build the React app entry point
const build = await Bun.build({
  entrypoints: ['./src/index.tsx'],
  outdir: './dist',
  target: 'browser',
  minify: false,
  sourcemap: 'inline',
});

if (!build.success) {
  console.error('Build failed:', build.logs);
  process.exit(1);
}

console.log('✅ Build successful');

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Serve index.html for root
    if (path === '/' || path === '/index.html') {
      const file = Bun.file('./public/index.html');
      return new Response(file, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Serve built JavaScript
    if (path === '/index.js' || path === '/src/index.tsx') {
      const file = Bun.file('./dist/index.js');
      return new Response(file, {
        headers: {
          'Content-Type': 'application/javascript',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Serve CSS files
    if (path.endsWith('.css')) {
      const file = Bun.file('./src' + path.replace(/^\/src/, ''));
      return new Response(file, {
        headers: { 'Content-Type': 'text/css' },
      });
    }

    // Serve static files from public directory
    if (path.startsWith('/public/')) {
      const file = Bun.file('.' + path);
      return new Response(file);
    }

    // Fallback to index.html for client-side routing
    const file = Bun.file('./public/index.html');
    return new Response(file, {
      headers: { 'Content-Type': 'text/html' },
    });
  },
});

console.log(`🎨 UI Server running on http://localhost:${server.port}`);
