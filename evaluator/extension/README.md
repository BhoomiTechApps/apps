# Evaluator browser extension

Sends what you are reading to your Evaluator app:

- **Select text › right-click › Check this claim with Evaluator**: Evaluator opens with the claim filled in.
  Longer selections go to the claim finder instead.
- **Right-click a page or a link › Find claims on this page**: the claim finder reads the page and picks out
  the claims worth checking.
- **Toolbar button › Find claims in a screenshot of this tab**: for pictures, memes and posts. Your AI
  model must be able to read pictures (Gemini can).

The extension reads nothing until you use it, and talks only to your own Evaluator app. All checking happens
in the app, with your keys or your organisation's server. It works with Chrome, Edge, Brave and Firefox (121+).

## Installing

The first time, the options page opens: enter the address you open Evaluator at (for example
`https://evaluator.example.org/`), and press Save. Allow the permission it asks for if you want screenshots;
it lets a small helper run on the app's pages only, to hand the picture over.

**Chrome, Edge, Brave** (without a store listing): open `chrome://extensions` (Edge: `edge://extensions`),
switch on **Developer mode**, choose **Load unpacked**, and select this `extension` folder.

**Firefox**: open `about:debugging#/runtime/this-firefox` › **Load Temporary Add-on** › choose `manifest.json`.
This lasts until Firefox restarts; for a permanent install, the extension must be signed by Mozilla
(see below).

## Publishing it

To make it a one-click install for everyone, zip the contents of this folder (`manifest.json` at the top of
the zip) and submit it:

- Chrome Web Store: https://chrome.google.com/webstore/devconsole (one-time developer fee).
- Microsoft Edge Add-ons: https://partner.microsoft.com/dashboard/microsoftedge (free).
- Firefox Add-ons: https://addons.mozilla.org/developers/ (free; can also sign it for your own distribution
  without listing it). Change `browser_specific_settings.gecko.id` to an address you control first.

Store reviewers ask why each permission is needed:

| Permission | Why |
| --- | --- |
| `contextMenus` | The right-click items. |
| `activeTab` | Reading the selection or the page address, and taking a screenshot, only of the tab you are on, only when you press a button. |
| `scripting` | Reading the selected text (popup), and registering the screenshot helper on the app's pages. |
| `storage` | Remembering the app's address; holding a screenshot for a few seconds until the app takes it. |
| Optional: your app's address | Only if you allow screenshots: lets the helper run on the app's own pages. |

An organisation that hosts its own copy of Evaluator can preset the address: edit `common.js` so that
`appAddress()` returns your address when none is saved, then publish your copy under your own name.
