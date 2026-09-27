# Evaluator (static PWA)

_Formerly History Tracer. Data saved by earlier versions (settings, sources, topics, local folders, recent results) carries over unchanged._

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

## Help for users

The **Help** tab (top right) has fold-out sections: Quick start, System requirements and API setup (with links to get every key), Setting up sources and topics, Using local files, Reading your results, Good practice with AI, and Troubleshooting. It's part of the page, so it works offline. To change it, edit the `view-help` section in `index.html`.

## Four ways to analyse a statement

- **Support / Challenge**: builds the strongest evidence-based case for one side.
- **Evaluate**: gathers evidence once, builds both cases from it, then an impartial "examiner" step weighs them (shown in random order, judged only on cited evidence) and writes one report: an overall leaning, the strongest points on each side, where they conflict and which way the evidence points, what they agree on, and gaps. Both full cases are included below the report.
- **Verify** (for scientific, mathematical and logical statements): splits the statement into separate claims, then
  - checks logical validity **in the app** with a truth table when the argument can be written in propositional logic (a counterexample is shown if it's invalid),
  - **recomputes** any calculations in the app and compares them with the claimed values,
  - searches neutrally for evidence on the factual claims and grades each one (true, mostly true, mixed, mostly false, false, unverified), weighing study types (systematic reviews above trials, above observational studies, and so on) and noting limits on when a claim holds.
  "Unverified" means the sources don't cover a claim; it is not the same as false. Arguments that need "all"/"some" (quantifiers) are judged by the model, and the report says so.

Every result can be copied as text, printed or saved as PDF, or downloaded as a Word file (.doc).

## Speed

- Web searches run at the same time (up to four at once), alongside the local-file search.
- **Evaluate** writes the two cases at the same time from the same evidence; only the final weighing waits for both.
- **Evidence is reused.** The passages found for a statement (per topic and set of sources) are kept on the device for 6 hours, and a repeat run skips planning and searching. The result says when evidence was reused, and **Search again** fetches fresh results.
- **Search focus** (Settings > AI model and search > "Support and Challenge search for"):
  - *Their own side only* (default): Support searches only for supporting evidence and Challenge only for challenging evidence, which is more targeted. Once both have run, **Evaluate** merges their evidence instead of searching again.
  - *For and against, shared*: one search covers both sides and is shared by all four buttons, so later runs on the same statement are nearly instant and use fewer Tavily credits.
  Evaluate and Verify always search neutrally when they need fresh evidence.
- The model receives at most the 15 most relevant passages (about 1,000 characters each), with near-duplicates removed.
- **Fast model for planning searches** (Settings): a small, quick model can plan the searches while the main model writes and checks everything. Where supported, planning also asks the model to "think" less.
- Local folders keep their search index in memory, so repeat searches over large folders are near-instant.
- The app opens from its saved copy immediately. Scripts and styles carry a version number (`?v=16`), so updates still arrive. When releasing a change, use your editor's replace-all to change `v=16` to `v=17` in `index.html` and `sw.js`, and `evaluator-v16` to `evaluator-v17` in `sw.js`.

## Balance and usage

Settings > AI model and search shows what's left on your accounts where the service allows an app to read it:

- **OpenRouter**: money left on the key (if it has a spending limit) and free-model requests left today.
- **Tavily**: search credits left this month on your plan.
- **Claude, OpenAI, Gemini, Groq and Mistral** don't offer a balance endpoint for ordinary API keys, so the app links to their billing pages instead.

Live figures also appear under the buttons on the Trace page, with a small bar that turns amber below 25% and red below 10%. Every result's footnote records the tokens it used and the Tavily credits it spent.

## Local files

Settings > Local files adds folders of PDF, DOCX, TXT and Markdown files. Text is extracted in the browser and stored only on the device (IndexedDB). A folder can be mapped to topics like any website, and each file gets its own colour in results; citations show the file and page. Only the passages chosen as evidence are sent to the AI provider.

- Chrome and Edge on desktop remember the folder, so **Rescan** picks up new or changed files. Other browsers read the files you select; to update, remove the folder and add it again.
- Scanned PDFs (images of pages) and old .doc files can't be read and are listed with the reason.
- A topic can contain only local folders; then no web search (and no Tavily key) is needed.
- Local folders aren't included in Export JSON, since the files live on the device.

The PDF and Word readers (pdf.js and mammoth.js, see `vendor/`) are bundled and load only when you add files.

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

## Code layout

The app code is split into plain scripts that `index.html` loads in order. They share one scope, so each file can use what the files before it declare. They download in parallel and run after the page has loaded.

| File | What it does |
|---|---|
| `js/core.js` | Shared helpers: DOM shortcuts, escaping, storage keys, labels |
| `js/store.js` | Trusted sources, topics and local folders (`SourceStore`, `LibraryStore`) |
| `js/providers.js` | AI providers, HTTP helpers, `chat()`, model lists, usage meter |
| `js/prompts.js` | Instructions sent to the models |
| `js/citations.js` | Reading model answers; numbering, colouring and verifying citations |
| `js/evidence.js` | Tavily and local-file search, the evidence cache, built-in web search |
| `js/analysis.js` | Support, Challenge, Evaluate, Verify; logic and arithmetic checks; `runAnalysis()` |
| `js/settings.js` | Balances, and the model / search / key settings |
| `js/manage.js` | Topics, sources and local-folder screens; routing; scope line |
| `js/results.js` | Busy state, result views, copy / print / Word, recent results |
| `js/main.js` | Start-up wiring, context-menu block, service worker registration |
| `lib/logic.js` | Truth tables and the safe calculator |
| `lib/local.js` | Reading PDF/DOCX/TXT files, IndexedDB storage, local search |

To add a new file, add a `<script defer>` tag in `index.html` (keep the order: a file must come after the files it relies on at load time) and add it to `SHELL` in `sw.js`.

The app blocks the browser's context menu (right click, and long press on phones) everywhere except text boxes, so pasting still works. This is a tidy-screen measure, not a security one: the code can still be viewed through the browser's developer tools.

## Where data lives

Everything is stored in the browser on that device: your API keys, the trusted source list, and the last 20 traces. Use **Export JSON** / **Import JSON** to move the source list between devices. `trusted-sources.json` in this folder is the default list loaded on first run and by "Restore default list".

## Important for public deployment

Each visitor enters their own API key, and it stays in their browser. Don't put your own key in the code of a public site. If you want visitors to use your key, use the server version (`history-tracer.zip`), which keeps the key on the server.
