# Netlify deployment

Connect the GitHub repository in Netlify. The tracked configuration sets the base to `apps/web`, command to `npm run build`, output to `dist` and Node to 22.22.0. Set the public build-time `VITE_API_BASE_URL` to the HTTPS Railway origin, then redeploy. The SPA fallback supports direct navigation to both case-study routes. Fingerprinted assets use immutable caching, while evidence refreshes independently.

Provision the custom domain in Netlify and use Netlify's displayed CNAME target for `boxbay` in Cloudflare. Start DNS-only during verification and certificate issuance. Confirm TLS, all three direct routes, an evidence JSON response and an operator benchmark job. Never put a credential in a Vite environment variable. [Netlify monorepo setup](https://docs.netlify.com/build/configure-builds/monorepos/)
