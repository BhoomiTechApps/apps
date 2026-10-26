# Evaluator organisation server

Evaluator normally needs each person to get two free keys (an AI model and Tavily search). For a school,
college or group that is a real hurdle. This small server lets the organisation hold the keys instead: members
enter the server's address and an access code, and need no keys of their own.

The server is a relay. It accepts only what Evaluator sends, rebuilds each request field by field, and passes
it to the AI service and Tavily with the organisation's keys. The keys never leave the server, and searches
are always restricted to the trusted websites the app sends (it is not a general web search).

## What it does

| Request | What happens |
| --- | --- |
| `GET /v1/info` | The server's name, models and limits; with a code, how much of today's allowance is left. |
| `GET /v1/models` | The models members may use (`MODELS`). |
| `POST /v1/chat/completions` | OpenAI-style chat, sent to `UPSTREAM_CHAT_URL` with `UPSTREAM_KEY`. Only text (and pictures, if `IMAGES` is on); only the models in `MODELS`; answer length capped by `MAX_TOKENS`. |
| `POST /tavily/search` | A Tavily search, only within the trusted domains sent. |
| `POST /tavily/extract` | Reads up to 5 web pages (the claim finder's "Web link"). |

Each access code has a daily allowance of model calls (`DAILY_CALLS`) and searches (`DAILY_SEARCHES`), and the
whole server has a daily ceiling (`DAILY_TOTAL_CALLS`). Allowances reset at midnight UTC. One analysis takes
about 3 to 5 model calls and 2 to 4 searches.

## Settings (environment variables)

| Name | Meaning | Default |
| --- | --- | --- |
| `NAME` | Shown to members, e.g. `Cotton University` | `Evaluator server` |
| `NOTE` | A short note shown with the name (optional) | |
| `UPSTREAM_KEY` | The AI service's key (secret) | required |
| `UPSTREAM_CHAT_URL` | Any OpenAI-compatible chat address | Google Gemini's OpenAI-compatible endpoint |
| `MODELS` | Comma-separated models members may use; the first is the default | `gemini-2.5-flash,gemini-2.5-flash-lite` |
| `UPSTREAM_JSON` | `false` if the service doesn't accept `response_format: json_object` | `true` |
| `IMAGES` | `false` to refuse pictures (screenshots in the claim finder) | `true` |
| `TAVILY_KEY` | The Tavily key (secret) | required |
| `ACCESS_CODES` | Comma-separated `code:label` pairs, e.g. `9a-x7k2p4:Class 9A,staff-q8m3t1:Staff`. Codes need 6+ characters. `*` makes the server open to anyone (counted by network address). | required |
| `ALLOWED_ORIGINS` | Comma-separated addresses the app is served from, e.g. `https://evaluator.example.org`. Browsers on other sites are refused. | required |
| `DAILY_CALLS` / `DAILY_SEARCHES` | Allowance per code per day | `300` / `120` |
| `DAILY_TOTAL_CALLS` | Ceiling for the whole server per day | `6000` |
| `MAX_TOKENS` | Longest answer allowed | `8000` |
| `PORT`, `TRUST_PROXY` | Node only: port to listen on; `1` to trust `X-Forwarded-For` behind a proxy | `8787`, off |

Other services: OpenAI (`https://api.openai.com/v1/chat/completions`), Groq
(`https://api.groq.com/openai/v1/chat/completions`), Mistral (`https://api.mistral.ai/v1/chat/completions`),
OpenRouter, or a model server on your own machine (Ollama: `http://localhost:11434/v1/chat/completions`).

## Running it

**Node.js 18 or later** (no packages needed):

```
NAME="Our school" UPSTREAM_KEY=... TAVILY_KEY=... \
ACCESS_CODES="9a-x7k2p4:Class 9A,staff-q8m3t1:Staff" \
ALLOWED_ORIGINS=https://evaluator.example.org \
node server/node.mjs
```

Put it behind HTTPS (Caddy, nginx, or a platform that provides it, such as Render or Fly.io). Daily counts
are kept in memory, so they start again if the server restarts.

**Cloudflare Workers** (free plan is enough for a class): edit `wrangler.toml`, then

```
npm install -g wrangler && wrangler login
wrangler kv namespace create COUNTS        # paste the id into wrangler.toml
wrangler secret put UPSTREAM_KEY
wrangler secret put TAVILY_KEY
wrangler secret put ACCESS_CODES
wrangler deploy
```

## Giving it to members

- Tell people the server's address and their code. In Evaluator they open the setup guide and choose
  **Use your organisation's server**, or Settings › AI model and search › **Your organisation's server**.
- If you also host the app itself, set `server` in the app's `config.js`. The setup guide then greets people
  with your name and asks only for the code.
- Give one code per class or group so that one group can't use up everyone's allowance, and change a code
  (edit `ACCESS_CODES` and restart) if it leaks.

## Privacy and cost

Statements, the passages found and the results pass through this server on their way to the AI service. The
server keeps nothing except the daily counts (code and date). Nothing is logged by the code here; your hosting
platform may keep its own access logs. Tell members which AI service you use. Free tiers of Gemini and Tavily
cover light use; set the allowances to fit your plan.
