/* GeoViewer Street View (3.5.0)
 * Shows Google Street View inside Feature info for any Street View address found in:
 *   - the feature's description HTML (links, bare addresses in the text, and Google embed <iframe>s);
 *   - property values, including several addresses in one value (e.g. Google My Maps "gx_media_links").
 *
 * Addresses understood:
 *   https://www.google.com/maps/@26.18,91.74,3a,75y,90h,95t/data=!3m6!1e1!3m4!1s<pano>!2e0...  (shared from Maps)
 *   https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=26.18,91.74&heading=90&pano=...  (Maps URLs)
 *   https://maps.google.com/?layer=c&cbll=26.18,91.74&cbp=12,90,,0,0&panoid=...  (older links)
 *   https://www.google.com/maps/embed?pb=...!6m8!1m7!1s<pano>...  ("Embed a map" from Street View)
 *   https://www.google.com/maps/embed/v1/streetview?key=...&location=...  (Maps Embed API)
 *   https://maps.app.goo.gl/...  short links: cannot be resolved in the browser, shown as an "Open" button.
 * Any Google country domain (google.co.in, ...) is accepted; previews are always loaded from www.google.com.
 *
 * Preview addresses: with a panorama ID, the keyless embed that Google's "Share > Embed a map" produces.
 * With only a location, the optional Maps Embed API key from Settings, otherwise Google's older keyless viewer.
 * Settings are kept in localStorage "geoviewer_streetview" = {auto: bool, key: string}.
 */
(function () {
  "use strict";

  var STORE = "geoviewer_streetview",
    MAX_CARDS = 6,
    PB_ZOOM = "0.7820865974627469",
    GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i,
    URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi,
    SV_WORDS = /street[\s_-]*view|(?:^|[^a-z])sv(?:[^a-z]|$)|panoram|(?:^|[^a-z])pano(?:[^a-z]|$)|photo[\s_-]*sphere/i;

  var ICON = {
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    pin: '<circle cx="12" cy="7" r="3"/><path d="M12 10v6M7 15c-2.5.6-4 1.6-4 2.7C3 19.5 7 21 12 21s9-1.5 9-3.3c0-1.1-1.5-2.1-4-2.7"/>'
  };
  function ico(name) {
    return '<svg class="gv-ico" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICON[name] + "</svg>";
  }

  /* ---------- settings ---------- */
  function cfg() {
    var c = { auto: true, key: "" };
    try {
      var s = JSON.parse(window.localStorage.getItem(STORE) || "{}") || {};
      if (typeof s.auto === "boolean") c.auto = s.auto;
      if (typeof s.key === "string") c.key = s.key.trim();
    } catch (e) {}
    return c;
  }
  function saveCfg(c) {
    try { window.localStorage.setItem(STORE, JSON.stringify(c)); } catch (e) {}
  }

  /* ---------- parsing ---------- */
  function num(x) {
    if (x === null || x === undefined || x === "") return null;
    var n = parseFloat(x);
    return isFinite(n) ? n : null;
  }
  function round(n, d) {
    var f = Math.pow(10, d);
    return Math.round(n * f) / f;
  }
  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }
  function cleanUrl(s) {
    // Trailing punctuation from prose, and HTML entities left in attribute text.
    return String(s).replace(/&amp;/g, "&").replace(/[),.;:!?\]}'"]+$/, "");
  }

  /** Returns {lat,lng,heading,pitch,fov,pano,open,embed?,short?} or null when the address is not Street View. */
  function parse(raw) {
    var u;
    try { u = new URL(cleanUrl(String(raw || "").trim())); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    var host = u.hostname.toLowerCase(),
      q = u.searchParams,
      path = safeDecode(u.pathname),
      r = { lat: null, lng: null, heading: null, pitch: null, fov: null, pano: null, open: u.href };

    if (host === "maps.app.goo.gl" || ((host === "goo.gl" || host === "www.goo.gl") && /^\/maps/i.test(u.pathname))) {
      r.short = true;
      return r;
    }
    if (!GOOGLE_HOST.test(host)) return null;

    // Maps Embed API (needs the key that is already in the address).
    if (/^\/maps\/embed\/v1\/streetview/i.test(u.pathname)) {
      r.embed = "https://www.google.com" + u.pathname + u.search;
      var loc = (q.get("location") || "").split(",");
      r.lat = num(loc[0]); r.lng = num(loc[1]);
      r.pano = q.get("pano"); r.heading = num(q.get("heading")); r.pitch = num(q.get("pitch")); r.fov = num(q.get("fov"));
      r.open = mapsUrl(r);
      return r;
    }

    // Keyless "Embed a map" address; Street View ones carry !6m..!1m..!1s<pano>.
    if (/^\/maps\/embed\/?$/i.test(u.pathname) && q.get("pb")) {
      var pb = q.get("pb"),
        m = /!6m\d+!1m\d+!1s([^!]+)(?:!2m2!1d(-?[\d.]+)!2d(-?[\d.]+))?(?:!3f(-?[\d.]+))?(?:!4f(-?[\d.]+))?/.exec(pb);
      if (!m) return null;
      r.pano = safeDecode(m[1]); r.lat = num(m[2]); r.lng = num(m[3]); r.heading = num(m[4]); r.pitch = num(m[5]);
      r.embed = "https://www.google.com/maps/embed?pb=" + pb.replace(/[\s"<>]/g, encodeURIComponent);
      r.open = mapsUrl(r);
      return r;
    }

    // Maps URLs: /maps/@?api=1&map_action=pano
    if ((q.get("map_action") || "").toLowerCase() === "pano") {
      var vp = (q.get("viewpoint") || "").split(",");
      r.lat = num(vp[0]); r.lng = num(vp[1]);
      r.pano = q.get("pano") || null;
      r.heading = num(q.get("heading")); r.pitch = num(q.get("pitch")); r.fov = num(q.get("fov"));
      return r.pano || r.lat !== null ? r : null;
    }

    // Shared from Google Maps: .../@lat,lng,3a,75y,90h,95t/data=!3m..!1e1!3m..!1s<pano>!2e0
    var at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)((?:,[^,/]+)*)/.exec(path);
    if (at) {
      var tokens = (at[3] || "").split(",").filter(Boolean),
        isPano = false;
      tokens.forEach(function (t) {
        var v = num(t), unit = t.slice(-1);
        if (v === null) return;
        if (unit === "a") isPano = true;
        else if (unit === "h") r.heading = v;
        else if (unit === "t") r.pitch = v - 90;   // 90t = level with the horizon
        else if (unit === "y") r.fov = v;
      });
      var pm = /!1s([^!/?]+)!2e\d+/.exec(path);
      if (pm) r.pano = safeDecode(pm[1]);
      if (/!1e1(?:!|$)/.test(path)) isPano = true;
      if (!isPano) return null;
      r.lat = num(at[1]); r.lng = num(at[2]);
      return r;
    }

    // Older links: ?layer=c&cbll=lat,lng&cbp=12,heading,,zoom,pitch&panoid=...
    if (q.get("cbll") || q.get("panoid") || (q.get("layer") === "c" && q.get("ll"))) {
      var ll = (q.get("cbll") || q.get("ll") || "").split(",");
      r.lat = num(ll[0]); r.lng = num(ll[1]);
      r.pano = q.get("panoid") || null;
      var cbp = (q.get("cbp") || "").split(",");
      r.heading = num(cbp[1]);
      var lp = num(cbp[4]);
      r.pitch = lp === null ? null : -lp;           // older links count pitch downwards
      return r.pano || r.lat !== null ? r : null;
    }
    return null;
  }

  function mapsUrl(r) {
    var s = "https://www.google.com/maps/@?api=1&map_action=pano";
    if (r.lat !== null && r.lng !== null) s += "&viewpoint=" + r.lat + "," + r.lng;
    if (r.pano) s += "&pano=" + encodeURIComponent(r.pano);
    if (r.heading !== null) s += "&heading=" + round(r.heading, 2);
    if (r.pitch !== null) s += "&pitch=" + round(Math.max(-90, Math.min(90, r.pitch)), 2);
    if (r.fov !== null) s += "&fov=" + round(Math.max(10, Math.min(100, r.fov)), 0);
    return s;
  }

  /** Address to load in the frame, or "" when there is nothing that can be shown. */
  function embedUrl(r) {
    if (r.short) return "";
    if (r.embed) return r.embed;
    var c = cfg(),
      h = r.heading === null ? 0 : round(r.heading, 2),
      p = r.pitch === null ? 0 : round(Math.max(-90, Math.min(90, r.pitch)), 2),
      hasLoc = r.lat !== null && r.lng !== null;
    if (c.key && (r.pano || hasLoc)) {
      var s = "https://www.google.com/maps/embed/v1/streetview?key=" + encodeURIComponent(c.key);
      if (r.pano) s += "&pano=" + encodeURIComponent(r.pano);
      else s += "&location=" + r.lat + "," + r.lng;
      s += "&heading=" + h + "&pitch=" + p;
      if (r.fov !== null) s += "&fov=" + round(Math.max(10, Math.min(100, r.fov)), 0);
      return s;
    }
    if (r.pano) {
      var pano = /^[\w-]+$/.test(r.pano) ? r.pano : encodeURIComponent(r.pano);
      return "https://www.google.com/maps/embed?pb=!4v1!6m8!1m7!1s" + pano +
        "!2m2!1d" + (hasLoc ? r.lat : 0) + "!2d" + (hasLoc ? r.lng : 0) +
        "!3f" + h + "!4f" + p + "!5f" + PB_ZOOM;
    }
    if (hasLoc) {
      return "https://www.google.com/maps?layer=c&cbll=" + r.lat + "," + r.lng +
        "&cbp=11," + h + ",0,0," + (-p) + "&output=svembed";
    }
    return "";
  }

  /* ---------- cards ---------- */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function card(r, label) {
    var fig = document.createElement("figure"),
      src = embedUrl(r);
    fig.className = "gv-sv";
    fig.setAttribute("data-testid", "geoviewer-streetview");
    var where = r.lat !== null && r.lng !== null ? round(r.lat, 5) + ", " + round(r.lng, 5) : "";
    fig.innerHTML =
      '<div class="gv-sv-frame"></div>' +
      '<figcaption class="gv-sv-bar">' +
      '<span class="gv-sv-label">' + ico("pin") + "<span>" + esc(label || "Street View") +
      (where ? ' <span class="gv-sv-where">' + esc(where) + "</span>" : "") + "</span></span>" +
      '<span class="gv-sv-actions">' +
      (src ? '<button type="button" class="btn-sm gv-sv-full" title="Full screen" aria-label="Show Street View full screen">' + ico("full") + "</button>" : "") +
      '<a class="btn-sm gv-sv-open" href="' + esc(r.open) + '" target="_blank" rel="noopener noreferrer" title="Open in Google Maps">' + ico("open") + "<span>Google Maps</span></a>" +
      "</span></figcaption>";
    var box = fig.firstChild;

    if (!src) {
      box.classList.add("gv-sv-empty", "gv-sv-msg");
      box.innerHTML = '<p>' + (r.short
        ? "Short Google Maps links can't be previewed here. Open it in Google Maps, then share the full address from the browser bar to see Street View in GeoViewer."
        : "This link has no location or panorama to show.") + "</p>";
      return fig;
    }

    function load() {
      box.classList.remove("gv-sv-empty");
      box.innerHTML = "";
      var f = document.createElement("iframe");
      f.src = src;
      f.title = "Google Street View" + (label ? ": " + label : "");
      f.loading = "lazy";
      f.setAttribute("allowfullscreen", "");
      f.setAttribute("allow", "fullscreen; accelerometer; gyroscope");
      f.referrerPolicy = "no-referrer-when-downgrade";
      box.appendChild(f);
    }
    var offline = navigator.onLine === false;
    if (cfg().auto && !offline) load();
    else {
      box.classList.add("gv-sv-empty");
      box.innerHTML =
        "<p>" + (offline ? "Street View needs an internet connection." : "Street View loads from Google when you ask for it.") + "</p>" +
        '<button type="button" class="btn-sm btn-accent gv-sv-load">' + ico("eye") + "<span>Show Street View</span></button>";
      box.querySelector(".gv-sv-load").addEventListener("click", load);
    }

    fig.querySelector(".gv-sv-full").addEventListener("click", function () {
      var el = box, fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (fs) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      if (!box.querySelector("iframe")) load();
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        try {
          var pr = req.call(el);
          if (pr && pr.catch) pr.catch(function () { window.open(r.open, "_blank", "noopener"); });
        } catch (e) { window.open(r.open, "_blank", "noopener"); }
      } else window.open(r.open, "_blank", "noopener");
    });
    return fig;
  }

  /* ---------- finding addresses ---------- */
  function urlsIn(text) {
    var out = [], m;
    URL_IN_TEXT.lastIndex = 0;
    while ((m = URL_IN_TEXT.exec(String(text || "")))) out.push(cleanUrl(m[0]));
    return out;
  }
  function wanted(r, context) {
    // Short links are only treated as Street View when the field or link text says so.
    return r && (!r.short || SV_WORDS.test(context || ""));
  }
  function keyOf(r) {
    return r.short ? r.open : embedUrl(r) || r.open;
  }

  function linkFor(href) {
    var a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "gv-sv-link";
    a.textContent = "Street View link";
    a.title = href;
    return a;
  }

  /** Enhances Feature info. `root` is #panel-body, `props` the feature properties. */
  function enhance(root, props) {
    if (!root) return;
    var seen = {}, count = 0;
    function take(r) {
      var k = keyOf(r);
      if (seen[k] || count >= MAX_CARDS) return false;
      seen[k] = 1; count++;
      return true;
    }
    function after(node, el) {
      node.parentNode.insertBefore(el, node.nextSibling);
    }

    var desc = root.querySelector(".desc-html");
    if (desc) {
      // 1. Google embeds already in the description: replace with a card (same viewer, plus Open / Full screen).
      [].slice.call(desc.querySelectorAll("iframe")).forEach(function (f) {
        var r = parse(f.getAttribute("src"));
        if (!r || !(r.embed || r.pano || r.lat !== null)) return;
        if (take(r)) f.parentNode.replaceChild(card(r, f.getAttribute("title") || "Street View"), f);
        else f.parentNode.removeChild(f);
      });
      // 2. Links.
      [].slice.call(desc.querySelectorAll("a[href]")).forEach(function (a) {
        if (a.closest(".gv-sv")) return;
        var text = a.textContent || "", r = parse(a.getAttribute("href"));
        if (!wanted(r, text + " " + a.getAttribute("href")) || !take(r)) return;
        a.target = "_blank"; a.rel = "noopener noreferrer";
        var label = text.trim() && !/^https?:\/\//i.test(text.trim()) ? text.trim() : "Street View",
          host = a.closest("table, ul, ol") || a;
        if (!desc.contains(host)) host = a;
        after(host, card(r, label));
      });
      // 3. Addresses written as plain text.
      var walker = document.createTreeWalker(desc, NodeFilter.SHOW_TEXT, {
          acceptNode: function (n) {
            return n.parentNode.closest("a, script, style, textarea, .gv-sv") ? NodeFilter.FILTER_REJECT
              : /https?:\/\//i.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
        }), texts = [], t;
      while ((t = walker.nextNode())) texts.push(t);
      texts.forEach(function (node) {
        var s = node.nodeValue, found = urlsIn(s).map(function (u) { return [u, parse(u)]; })
          .filter(function (x) { return wanted(x[1], s); });
        if (!found.length) return;
        var frag = document.createDocumentFragment(), rest = s, cards = [];
        found.forEach(function (x) {
          var i = rest.indexOf(x[0]);
          if (i < 0) return;
          frag.appendChild(document.createTextNode(rest.slice(0, i)));
          frag.appendChild(linkFor(x[0]));
          rest = rest.slice(i + x[0].length);
          if (take(x[1])) cards.push(card(x[1], "Street View"));
        });
        frag.appendChild(document.createTextNode(rest));
        var host = node.parentNode.closest("table, ul, ol");
        node.parentNode.replaceChild(frag, node);
        cards.reverse().forEach(function (c) {
          if (host && desc.contains(host)) after(host, c);
          else desc.appendChild(c);
        });
      });
    }

    // 4. Property values shown as rows (no description).
    [].slice.call(root.querySelectorAll(".props-grid > .prop-row")).forEach(function (row) {
      if (row.closest(".gv-measure")) return;
      var keyEl = row.querySelector(".prop-key"), valEl = row.querySelector(".prop-val");
      if (!valEl) return;
      var key = keyEl ? keyEl.textContent : "", val = valEl.textContent,
        found = urlsIn(val).map(function (u) { return [u, parse(u)]; })
          .filter(function (x) { return wanted(x[1], key + " " + val); });
      if (!found.length) return;
      // Turn the addresses in the value into short links, keep any other text.
      var rest = val;
      valEl.textContent = "";
      found.forEach(function (x) {
        var i = rest.indexOf(x[0]);
        if (i < 0) return;
        valEl.appendChild(document.createTextNode(rest.slice(0, i)));
        valEl.appendChild(linkFor(x[0]));
        rest = rest.slice(i + x[0].length);
      });
      valEl.appendChild(document.createTextNode(rest));
      var anchor = row;
      found.forEach(function (x, i) {
        if (!take(x[1])) return;
        var c = card(x[1], key + (found.length > 1 ? " (" + (i + 1) + ")" : ""));
        c.classList.add("gv-sv-in-grid");
        after(anchor, c);
        anchor = c;
      });
    });

    // 5. With a description, the property rows are hidden: still show Street View addresses stored in properties.
    if (desc && props && typeof props === "object") {
      var extra = [];
      Object.keys(props).forEach(function (k) {
        if (k === "description" || props[k] === null || props[k] === undefined) return;
        var v = typeof props[k] === "string" ? props[k] : JSON.stringify(props[k]);
        urlsIn(v).forEach(function (u) {
          var r = parse(u);
          if (wanted(r, k + " " + v) && take(r)) extra.push(card(r, k));
        });
      });
      if (extra.length) {
        var sec = document.createElement("div");
        sec.className = "gv-sv-section";
        sec.innerHTML = '<div class="gv-measure-title">Street View</div>';
        extra.forEach(function (c) { sec.appendChild(c); });
        var measure = root.querySelector(".gv-measure");
        if (measure) measure.parentNode.insertBefore(sec, measure);
        else (root.querySelector(".feature-content") || root).appendChild(sec);
      }
    }
  }

  /* ---------- Settings dialog ---------- */
  function wireSettings() {
    var open = document.getElementById("btn-settings"),
      save = document.getElementById("btn-settings-save"),
      auto = document.getElementById("set-sv-auto"),
      key = document.getElementById("set-sv-key");
    if (!open || !save || !auto || !key) return;
    open.addEventListener("click", function () {
      var c = cfg();
      auto.checked = c.auto;
      key.value = c.key;
    });
    save.addEventListener("click", function () {
      saveCfg({ auto: !!auto.checked, key: String(key.value || "").trim() });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireSettings);
  else wireSettings();

  window.GVStreetView = { parse: parse, embedUrl: embedUrl, enhance: enhance };
})();
