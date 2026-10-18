Waypost Reporter 1.1.0
======================

A small phone app for reporting incidents with GPS location and photo.

Hosting
- Put this folder on any web server with https (GPS and installing as an app need https).
  It is also included inside Waypost (reporter/) and inside the Waypost WordPress plugin
  (app/reporter/), so usually nothing extra is needed.

Setting up phones
- In Waypost: Project tab > Field reports from phones > Share setup link.
- Open the link on the phone, then use the browser's "Add to Home screen" / "Install app".
- The link carries the project name, categories, extra columns, and, when a server is set,
  the server address and reporter key. It can also be pasted under Settings in the app.

Where reports go
- With a server (a WordPress site with the Waypost plugin): reports are sent to it, and
  Waypost on your computer collects them into the project folder (reports/ and photos/).
  Without signal, reports wait on the phone and go out when the app is open with signal.
- Without a server: each report is shared as files (report .geojson + photo .jpg) through
  WhatsApp, email and so on. Save them into the project's inbox/ folder; Waypost files them.

(c) BhoomiTech Heritage and Development Foundation
