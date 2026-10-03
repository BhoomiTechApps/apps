/* Media Map: the app's version, set in this one place.
 * The frame header shows it, app.js reads it, and sw.js (importScripts) names its caches after it,
 * so bumping it here is all a release needs: installed copies then offer "Update now". */
( function ( g ) {
    'use strict';
    g.APP_VERSION = '1.6.1';
}( typeof self !== 'undefined' ? self : this ) );
