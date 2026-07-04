# 🚀 Deploying Buddy to GitHub Pages (with a Cloudflare Worker backend)

GitHub Pages only serves static files — it can't run a server or keep your
OpenAI API key secret. So this deployment has two parts:

| Piece | What it does | Hosted on |
|---|---|---|
| `web/index.html` | The chat page kids actually use | **GitHub Pages** (free) |
| `web/cloudflare-worker/worker.js` | Holds your API key secretly, calls OpenAI | **Cloudflare Workers** (free tier) |

The browser never talks to OpenAI directly — it talks to your Worker,
and the Worker (which only you control) talks to OpenAI. This keeps your
API key out of public view.

---

## Part 1 — Deploy the Cloudflare Worker (the backend)

### 1. Create a free Cloudflare account
Go to https://dash.cloudflare.com/sign-up if you don't have one.

### 2. Install Wrangler (Cloudflare's CLI tool)
```bash
npm install -g wrangler
```

### 3. Log in
```bash
wrangler login
```
This opens a browser window to authorize the CLI.

### 4. Go to the worker folder
```bash
cd homework-helper-agent/web/cloudflare-worker
```

### 5. Deploy the Worker
```bash
wrangler deploy
```
Wrangler will print a URL when it's done, something like:
```
https://homework-helper-proxy.<your-subdomain>.workers.dev
```
**Copy this URL** — you'll need it in Part 2.

### 6. Add your OpenAI API key as a secret
```bash
wrangler secret put OPENAI_API_KEY
```
Paste your key when prompted. This stores it securely on Cloudflare's
side — it is never visible in your code or in the browser.

### 7. (Recommended) Restrict which site can call your Worker
Once you know your GitHub Pages URL (Part 2, step 3), open
`wrangler.toml` and add:
```toml
[vars]
ALLOWED_ORIGIN = "https://yourusername.github.io"
```
Then redeploy:
```bash
wrangler deploy
```
This stops other websites from quietly using your API key/quota.

---

## Part 2 — Deploy the frontend to GitHub Pages

### 1. Update the Worker URL in the frontend
Open `web/index.html` and find this line near the bottom:
```js
const WORKER_URL = "https://REPLACE-WITH-YOUR-WORKER-URL.workers.dev";
```
Replace it with the URL you copied in Part 1, step 5.

### 2. Create a GitHub repository
- Go to https://github.com/new
- Create a new repo (e.g. `homework-helper-agent`)
- Push your project to it:
```bash
cd homework-helper-agent
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/homework-helper-agent.git
git push -u origin main
```

### 3. Enable GitHub Pages
- In your repo, go to **Settings → Pages**
- Under **Build and deployment → Source**, choose **Deploy from a branch**
- Branch: `main`, folder: `/web` (or move `index.html` to the repo root
  and choose `/root` — either works, just be consistent)
- Click **Save**

GitHub will give you a live URL, typically:
```
https://yourusername.github.io/homework-helper-agent/
```

It can take a minute or two for the first deploy to go live.

### 4. Test it!
Open the GitHub Pages URL, type a homework question, and Buddy should
reply — routed through your Cloudflare Worker to OpenAI and back.

---

## Notes on cost, safety, and abuse

- **Anyone with the link can use it.** Since it's a public page, anyone
  who finds the URL can chat with Buddy — and each message uses your
  OpenAI quota/billing. Setting `ALLOWED_ORIGIN` (Part 1, step 7) stops
  *other websites* from calling your Worker, but doesn't stop a person
  from directly visiting your Pages URL and using it — that's expected
  for a public deployment.
- **To limit cost further**, consider Cloudflare's free **Rate Limiting
  Rules** (Dashboard → your Worker/domain → Security → WAF → Rate
  limiting rules) to cap how many requests a single visitor can make per
  minute.
- **Set a spending cap** in your OpenAI account (Billing → Limits) so
  you never get an unexpectedly large bill.
- This is a fine setup for a family/classroom project shared with people
  you trust. For a truly public, high-traffic deployment you'd want
  proper auth (e.g. a login) — let me know if you'd like help adding that.

## Updating the site later

Any time you edit `index.html` or `worker.js`:
- Frontend change → `git add . && git commit -m "update" && git push` (Pages redeploys automatically)
- Worker change → `wrangler deploy` again from the `cloudflare-worker` folder
