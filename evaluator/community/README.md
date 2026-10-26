# Community source lists

A source list is a topic with its trusted websites, like a starter pack that anyone can make and share.
Evaluator users can open a list from a link, a file or a web address. They always see every website before
anything is added, and nothing they already have is removed.

A **catalogue** is an `index.json` file that lists many lists. Evaluator shows the catalogue in this folder
(it comes with the app), any catalogues the host of an Evaluator copy adds in `config.js`, and any a person adds
in Settings › Community lists. When a list in a catalogue gets a newer `updated` date, people who added it are
offered the update. An update only ever adds websites; it never removes any.

## Making a list

The easiest way: in Evaluator, set up a topic with the websites you trust for it, then open Settings › Topics ›
the topic › **Share as a list**. You get a link to send, or a `.json` file. Your notes on each website go with it.
Local folders are never included.

Or write the file by hand:

```json
{
  "kind": "evaluator-list",
  "v": 1,
  "id": "assam-history-teachers",
  "name": "Assam history (teachers)",
  "description": "What the list is for and how the websites were chosen (up to 400 characters).",
  "author": "Who made it",
  "language": "en",
  "updated": "2026-10-26",
  "exampleClaim": "A claim people could try first (optional).",
  "topic": { "name": "Assam history", "description": "Shown under the topic (optional)." },
  "sources": [
    { "domain": "britannica.com", "label": "Encyclopaedia Britannica", "category": "reference", "notes": "Why it is trusted, what it is good for." }
  ]
}
```

- `id`: 3 to 64 lowercase letters, digits and hyphens. The file is named `<id>.json`.
- `domain`: a site such as `britannica.com`, or a part of one such as `archive.org/details`. No `https://`.
- `category`: one of `primary`, `academic`, `reference`, `archive`, `journalism`, `other`.
- Up to 60 websites. Change `updated` whenever you change the list, so that people get the update.

## Running a catalogue

1. Put the list files in a folder and run the checker. It reports any problems and writes `index.json`:

   ```
   node community/validate.mjs path/to/folder https://example.org/evaluator-lists
   ```

   The second argument is the web address the folder will be published at. Leave it out if the lists sit next
   to `index.json` (the addresses are then relative to it). `CATALOGUE_NAME="Our lists"` sets the name shown.

2. Publish the folder over **https** where browsers may read it from other sites. GitHub Pages, a GitHub
   repository (`raw.githubusercontent.com` addresses), Netlify and Cloudflare Pages all allow this. Your own web
   server needs the header `Access-Control-Allow-Origin: *` on these files.

3. Share the address of `index.json`. People paste it into Settings › Community lists › Open. If you host a copy
   of Evaluator for your organisation, add it to `listCatalogs` in `config.js` instead, so everyone sees it.

A catalogue in a public repository is an easy way to take suggestions: people send a list file (or a pull
request), you check every website, run the checker and publish.

## Reviewing lists

A list only says which websites to search. It cannot add anything else to Evaluator, and the app rebuilds
every field before showing it. Still, a list decides what counts as evidence, so whoever runs a catalogue
should check each website: who runs it, whether it says where its information comes from, and whether it
is fit for the topic.
