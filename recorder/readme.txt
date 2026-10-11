=== Interview Recorder ===
Requires at least: 5.8
Requires PHP: 7.4
Stable tag: 1.5.1
License: GPLv2 or later

Record remote interviews in full quality. You and your guest each record on your own computer; your site only connects the call.

== Description ==

* Open the recorder at yoursite.com/recorder/ (or from the Interview Recorder admin menu), or place it in any page with the shortcode [interview_recorder]. Add theme="dark" or theme="light" to override the site-wide Interface theme for one page. The box is always exactly as tall as the recorder: it grows when you open an accordion section and shrinks when you close it, so nothing is clipped and there is no gap above your footer. Optional: height="fixed" (built-in per-screen heights), height="700" or height="80vh" (one fixed height), min_height="280".
* Create an invite link and send it to your guest. They open it in Chrome or Edge; nothing to install.
* Press Record: both computers start recording their own camera and mic (video file + 24-bit WAV) at the same instant, so all files line up when placed at 0:00 in any editor.
* After each recording, the guest's files are sent straight to your computer over the call connection, resuming if the connection drops.
* Video and audio never pass through your website, so hosting bandwidth and upload limits don't matter.

Only users who can edit posts can create invite links. Change this with the `ir_host_capability` filter.

== Installation ==

1. Plugins > Add New > Upload Plugin, choose the zip, Install, Activate.
2. Open Interview Recorder in the admin menu and click "Open recorder".

== Troubleshooting ==

* Page cache or CDN: exclude /recorder/ (which includes the app's /recorder/app-manifest and /recorder/app-sw), /join/ and /wp-json/interview-recorder/ from caching.
* Security plugins: allow /wp-json/interview-recorder/ (it's checked about once a second while connecting).
* Calls that won't connect on office or mobile networks: add a TURN relay under Interview Recorder > Relay server.

== Changelog ==

= 1.5.1 =
* Fixed the bottom of the recorder being cut off when an accordion section is opened. The shortcode box keeps the height you set under Display as its minimum, and now grows to fit the recorder when an open section makes it taller, pushing your footer down instead of hiding content or overlapping it. There is no inner scrolling any more.

= 1.5.1 =
* Fixed accordion sections being clipped at the bottom, and the gap above the footer when they are closed. The shortcode box now sizes itself to the recorder by default (the old height="auto" mode, now the default): it grows when a section opens and shrinks when it closes. The recorder's height measurement was also tightened so the box never ends a pixel short. Fixed heights are still available with height="fixed", height="700" or height="80vh". Removed the now-unneeded "Shortcode box height" settings from Interview Recorder > Display.

= 1.5.0 =
* Fixed the recorder flowing into the site footer on phones. The shortcode box now has an exact height for each screen size (desktop, tablet, mobile; px or vh), enforced over the theme, and the recorder scrolls inside it. Set the heights under Interview Recorder > Display, or per page with height, height_tablet and height_mobile. Phones use the visible screen height. The older height="auto" (grow by script) and height="100%" still work if you ask for them.

= 1.4.9 =
* Fixed the recorder spilling over the site footer on phones. The shortcode box could miss the recorder's height when the page's scripts loaded late (common with mobile speed optimisers), and stayed too short. The recorder now re-sends its height when the page asks, after fonts and layout settle, on rotation, and every couple of seconds as a safety net, and the box can no longer be squeezed by its container.

= 1.4.8 =
* Removed the extra vertical scrollbar that could appear beside the recorder when it is placed with the shortcode. A box with a fixed height (height="480" and so on) still scrolls with the wheel or touch, just without a visible bar.

= 1.4.7 =
* New Full screen button in the recorder's header (also on the shortcode and the guest page). Click it to fill the screen; click again, or press Esc, to leave. It is hidden in browsers that don't allow full screen (iPhone Safari).

= 1.4.6 =
* Fixed the recorder still showing the old fixed-height layout (sections cut off with a scrollbar beside them) after updating. The stylesheet is now requested with the plugin version, so browsers, CDNs and cache plugins fetch the new one.

= 1.4.5 =
* Fixed the shortcode box staying at its starting height (cutting off open sections) when the page and the recorder address differ, for example www and non-www or http and https. The box now grows to fit in every case, and the script that does it is loaded in the page footer instead of inside the post content.

= 1.4.4 =
* Fixed the shortcode box not growing to fit the recorder when code protection is switched off, which left open sections cut off.

= 1.4.3 =
* Removed the fixed height. The recorder page now grows with what is open and the browser page scrolls; sections no longer scroll inside themselves. The shortcode box grows to fit too (height="auto" is the new default; height="480", "80vh" and "100%" still work).

= 1.4.2 =
* Removed the vertical scrollbars from individual accordion items. Long sections still scroll with the wheel, trackpad or touch.

= 1.4.0 =
New features
* Install the recorder as an app (Chrome, Edge, Android, iPhone and iPad). An "Install app" button appears at the top of yoursite.com/recorder/; the app opens in its own window with its own icon. Needs HTTPS.
* The installed app opens even without a connection, so you can record yourself offline. Interviews still need a connection.
* New setting Interview Recorder > Display > Install as an app (on by default). Switching it off also clears the app's stored files from browsers that installed it.

Design and other changes
* New app icon in the graphite and muga-gold palette.
* Guests keep using their invite link in the browser; the install offer is only on the host recorder page.

= 1.3.0 =
Design and other changes
* Two equal columns (50% / 50%), so the video is smaller.
* The video screen and the recording panel sit together in a "Video and recording" section on the left, open by default. On the right, Interview, Devices and Pre-flight start open; Save folder and Backups start closed. Each computer remembers what you open or close.
* Every section scrolls its own content when it doesn't fit, so section headers stay in view. Only if many sections are open in very little height does the column itself scroll, so nothing is ever cut off.
* Simpler shortcode sizing: the recorder fills the height of the box it sits in (a Group, column or custom block with a fixed or minimum height), or use height="480" / height="80vh" on the shortcode. With no fixed height anywhere it is 420 px tall (change with min_height). The container-measuring scripts from 1.1 are removed.

= 1.2.0 =
* Release of the 1.1.x changes as 1.2.0: the recorder fits containers with a set height, sized from inside its own frame, with compact spacing in short containers. No functional changes since 1.1.1.

= 1.1.1 =
Bug fixes
* The shortcode now reliably fits a container with a set height. The recorder sizes itself from inside its own frame, so caching and "delay JavaScript" plugins (LiteSpeed, WP Rocket, Autoptimize and similar) no longer stop it, and page-builder containers nested several levels deep (Elementor, Kadence, Spectra and others) are found.
* Removed the grey border and margin that appeared around the recorder inside a page, so it uses the container's full size.

Design and other changes
* In short containers (under 640 px) the header, footer and recording panel get tighter, leaving more height for the video.

= 1.1.0 =
New features
* The shortcode fits its container. Put [interview_recorder] in a Group with a minimum height, a fixed-height column or any box with a set height, and the recorder fills exactly that height: the video shrinks so the recording controls stay in view, and the settings column scrolls. Anywhere else it grows to fit its content as before.
* New shortcode option fit="auto|container|content" to force either behaviour (default auto).

= 1.0.0 =
Design and other changes
* The left pane (video and recording controls) shows a thin scrollbar when the browser window is too short to fit it. Inside a page using the shortcode, the frame still grows to fit instead.
* Author is now listed as BhoomiTech Heritage and Development Foundation.

= 0.6.1 =
Design and other changes
* The video and recording panel no longer share a fixed 480 px height. The video keeps its full 16:9 shape, and the settings column matches the left column's height and scrolls.

= 0.6.0 =
New features
* Interface theme setting (Interview Recorder > Display): Light "stone" (default) or Dark "graphite", both matte. Override per page with [interview_recorder theme="dark"].
* Settings sit in a scrolling side panel of collapsible sections (Interview, Devices, Pre-flight, Save folder, Backups), each with a live status. Open and closed sections are remembered on each computer.
* Right-click is off across the recorder. Text fields get a small menu with only Copy and Paste.
* Code protection (on by default, Interview Recorder > Display): opening developer tools, view-source or save-page sends the visitor to the site's main page. Opening the recorder's script or style files directly in a tab does the same on Apache and LiteSpeed servers.

Design and other changes
* New two-column layout: video and recording controls on the left (60%); settings on the right (40%).
* The recorder sits in the BhoomiTech frame with the installed version shown at top right and a credit line underneath.
* Matte surfaces with fine grooves instead of border lines, one gold accent, 4 px corners, sentence-case labels and thinner line icons.
* Bundled the Onest typeface (SIL Open Font License); no font is loaded from outside your site.
