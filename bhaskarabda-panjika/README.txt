Bhaskarabda Panjika 1.2.0 - installable web app (PWA)

Upload everything in this folder, keeping the folders as they are, to any HTTPS static host
(GitHub Pages, Netlify, Cloudflare Pages, or a folder on your own site). Open it once on a phone
and choose "Add to Home screen" / "Install app". After the first visit it works offline.

Your own events, chosen location, theme and other settings are stored in this browser on this
device only. To keep a copy or move events to another device, open "Import and export events"
in the sidebar: export to Excel (.xlsx), CSV or JSON, and import the same formats on the other
device. The "Excel template" button gives a sheet with example rows and a "How to fill" sheet
explaining each column. Importing adds events and skips ones already in the list.
"Export to calendar" gives an .ics file for Google Calendar, Apple Calendar or Outlook.

The right-click menu is off except in text boxes, and opening the browser's developer tools sends
the page back to index.html. This discourages casual copying; it cannot stop a determined person.

To try it on your computer: run  python3 -m http.server 8000  in this folder and open
http://localhost:8000 (the offline cache needs http(s), not a file opened directly).

Credits: Astronomy Engine by Don Cross (MIT, assets/vendor/astronomy-engine/LICENSE.txt).
Onest, Tiro Bangla and Noto Sans Meetei Mayek fonts under the SIL Open Font License 1.1.
