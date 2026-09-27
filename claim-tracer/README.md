# History Tracer (static PWA)

Build sourced arguments for or against a claim, searching only sources you trust.

No server and no build step. Upload this folder to any static host with HTTPS, open it, and install it from the browser.

## Put it online (pick one)

- **Netlify Drop:** go to https://app.netlify.com/drop and drag this folder onto the page. You get an HTTPS link in seconds.
- **GitHub Pages:** push the folder to a repository, then Settings > Pages > deploy from the main branch.
- **Your own site / cPanel / WordPress host:** upload the folder by FTP, e.g. to `yoursite.com/tracer/`. All paths are relative, so any subfolder works.

Try it on your computer: `python3 -m http.server 8000` inside this folder, then open http://localhost:8000. (Opening index.html by double-clicking won't work; service workers need a web address.)

## First run

1. Open **Settings** and pick an AI model provider. Free options:
   - **Google Gemini**: key at https://aistudio.google.com/apikey (free tier, no card).
   - **Groq**: key at https://console.groq.com/keys (free tier).
   - **OpenRouter**: key at https://openrouter.ai/keys, then "Load models" to list the free ones.
   - **Mistral**: key at https://console.mistral.ai/api-keys (free tier).
   Paid options: OpenAI (ChatGPT) and Anthropic Claude.
2. Paste the key, then click **Load models** and pick a model. Model names change often, so the list comes live from the provider.
3. Choose the search:
   - **Tavily** works with every model. Get a free key at https://app.tavily.com (1,000 searches a month).
   - **The model's own web search** is offered only for Claude and OpenAI, the two whose search can be limited to your trusted domains.
4. Save, review your trusted sources, and go to **Trace**.

## How the free route works

With Tavily, a trace makes two model calls and a few searches: the model writes 3 to 8 search queries, Tavily runs them only inside your enabled trusted domains, and the model builds the argument from the numbered excerpts it was given. It can cite only those numbers, so it cannot invent a link. Every citation is also checked against your trusted list before it is shown.

Free tiers have daily and monthly caps. If a provider says you've hit a limit, switch to another provider in Settings; your keys for each provider are remembered.

## Install as an app

- Android / Chrome / Edge: browser menu > Install app (or Add to Home screen).
- iPhone / iPad: Safari > Share > Add to Home Screen.

## Topics

Topics group your trusted sources by subject (for example "Indian history" or "Treaties and diplomacy"). A source can belong to several topics.

- Create, rename and delete topics in **Settings > Topics**, and tick the sources that belong to each.
- You can also tick topics when adding or editing a source.
- On the Trace page, the **Topic** menu picks what to search. Only sources that are both in that topic and switched on are searched. "All trusted sources" searches every switched-on source.

## Colour-coded results

Each trusted site cited in a result gets its own colour. A sentence drawn from a source is tinted in that site's colour and followed by a numbered marker; the **Colour key** at the top of the result names the sites, and the numbered **Sources** list at the bottom links to each page. Text without colour is the model's own connecting reasoning. Click a number to jump to its source.

## Source file format

`trusted-sources.json` (and Export/Import) uses:

```json
{
  "version": 2,
  "topics": [ { "id": "t-india", "name": "Indian history", "description": "..." } ],
  "sources": [ { "id": "src-archive", "domain": "archive.org", "label": "Internet Archive",
                 "category": "archive", "notes": "...", "enabled": true, "topics": ["t-india"] } ]
}
```

Lists saved by earlier versions are upgraded automatically: the default topics are added and matching sites are mapped to them. For a database or WordPress version, this becomes a topics table and a source-to-topic link table.

## Where data lives

Everything is stored in the browser on that device: your API keys, the trusted source list, and the last 20 traces. Use **Export JSON** / **Import JSON** to move the source list between devices. `trusted-sources.json` in this folder is the default list loaded on first run and by "Restore default list".

## Important for public deployment

Each visitor enters their own API key, and it stays in their browser. Don't put your own key in the code of a public site. If you want visitors to use your key, use the server version (`history-tracer.zip`), which keeps the key on the server.
