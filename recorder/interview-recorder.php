<?php
/**
 * Plugin Name:       Interview Recorder
 * Description:       Record remote interviews in full quality. Each side records on their own computer; your site only connects the call. Open it at yoursite.com/recorder/.
 * Version:           1.5.1
 * Author:            BhoomiTech Heritage and Development Foundation
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * Text Domain:       interview-recorder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'IR_VERSION', '1.5.1' );
define( 'IR_JOIN_SLUG', 'join' );
define( 'IR_DIR', plugin_dir_path( __FILE__ ) );
define( 'IR_URL', plugin_dir_url( __FILE__ ) );
define( 'IR_SLUG', 'recorder' );
define( 'IR_NS', 'interview-recorder/v1' );

/* -------------------------------------------------------------------------
 * Install / upgrade
 * ---------------------------------------------------------------------- */

function ir_tables() {
	global $wpdb;
	return array(
		'rooms'   => $wpdb->prefix . 'ir_rooms',
		'signals' => $wpdb->prefix . 'ir_signals',
	);
}

function ir_install_tables() {
	global $wpdb;
	$t       = ir_tables();
	$charset = $wpdb->get_charset_collate();
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';

	dbDelta( "CREATE TABLE {$t['rooms']} (
		id varchar(32) NOT NULL,
		host_key varchar(64) NOT NULL,
		guest_key varchar(64) NOT NULL,
		title varchar(200) NOT NULL DEFAULT '',
		created_by bigint(20) unsigned NOT NULL DEFAULT 0,
		created_at datetime NOT NULL,
		host_seen datetime NULL,
		guest_seen datetime NULL,
		PRIMARY KEY  (id),
		KEY guest_key (guest_key)
	) $charset;" );

	dbDelta( "CREATE TABLE {$t['signals']} (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		room_id varchar(32) NOT NULL,
		to_role varchar(8) NOT NULL,
		body longtext NOT NULL,
		created_at datetime NOT NULL,
		PRIMARY KEY  (id),
		KEY room_role (room_id,to_role,id)
	) $charset;" );

	update_option( 'ir_db_version', IR_VERSION );
}

register_activation_hook( __FILE__, 'ir_activate' );
function ir_activate() {
	ir_install_tables();
	add_option( 'ir_theme', 'light' );
	add_option( 'ir_protect', '1' );
	add_option( 'ir_pwa', '1' );
	ir_add_rewrite();
	flush_rewrite_rules();
}

register_deactivation_hook( __FILE__, 'ir_deactivate' );
function ir_deactivate() {
	flush_rewrite_rules();
}

// Plugin updated by uploading a new zip: make sure tables and the /recorder/ address are current.
add_action( 'init', function () {
	if ( get_option( 'ir_db_version' ) !== IR_VERSION ) {
		ir_install_tables();
		flush_rewrite_rules();
	}
}, 99 );

/* -------------------------------------------------------------------------
 * The app page: yoursite.com/recorder/ (or /?ir_app=1 without pretty links)
 * ---------------------------------------------------------------------- */

function ir_add_rewrite() {
	add_rewrite_rule( '^' . IR_SLUG . '/?$', 'index.php?ir_app=1', 'top' );
	add_rewrite_rule( '^' . IR_JOIN_SLUG . '/([A-Za-z0-9]{4,32})/?$', 'index.php?ir_app=1&ir_join=$matches[1]', 'top' );
	// Installable app: the manifest and service worker live under /recorder/ so the worker can
	// control the recorder page. No file extensions, so server rules for static .js files can't
	// intercept them.
	add_rewrite_rule( '^' . IR_SLUG . '/app-manifest/?$', 'index.php?ir_pwa=manifest', 'top' );
	add_rewrite_rule( '^' . IR_SLUG . '/app-sw/?$', 'index.php?ir_pwa=sw', 'top' );
}
add_action( 'init', 'ir_add_rewrite' );

add_filter( 'query_vars', function ( $vars ) {
	$vars[] = 'ir_app';
	$vars[] = 'ir_join';
	$vars[] = 'ir_pwa';
	return $vars;
} );

function ir_app_url( $args = array() ) {
	$base = get_option( 'permalink_structure' )
		? home_url( '/' . IR_SLUG . '/' )
		: add_query_arg( 'ir_app', '1', home_url( '/' ) );
	return $args ? add_query_arg( $args, $base ) : $base;
}

/** Short guest link: yoursite.com/join/k7m2qx9p (or /?ir_join=k7m2qx9p without pretty links). */
function ir_join_url( $code ) {
	return get_option( 'permalink_structure' )
		? home_url( '/' . IR_JOIN_SLUG . '/' . $code )
		: add_query_arg( 'ir_join', $code, home_url( '/' ) );
}

/** 8 characters without look-alikes (no 0/o, 1/l/i): easy to read out or type. */
function ir_short_code( $length = 8 ) {
	$alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
	$code     = '';
	for ( $i = 0; $i < $length; $i++ ) {
		$code .= $alphabet[ random_int( 0, strlen( $alphabet ) - 1 ) ];
	}
	return $code;
}

/** Looks up a join code. Limits wrong guesses per visitor to stop link guessing. */
function ir_resolve_join( $code ) {
	global $wpdb;
	$t      = ir_tables();
	$code   = strtolower( preg_replace( '/[^A-Za-z0-9]/', '', (string) $code ) );
	$ip     = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$lock   = 'ir_join_fail_' . md5( $ip );
	$fails  = (int) get_transient( $lock );
	if ( $fails >= 20 ) {
		return null;
	}
	$room = '' === $code ? null : $wpdb->get_row( $wpdb->prepare( "SELECT id, guest_key FROM {$t['rooms']} WHERE guest_key = %s", $code ) );
	if ( ! $room ) {
		set_transient( $lock, $fails + 1, HOUR_IN_SECONDS );
		return null;
	}
	return array( 'room' => $room->id, 'key' => $room->guest_key );
}

function ir_host_capability() {
	return apply_filters( 'ir_host_capability', 'edit_posts' );
}

function ir_ice_servers() {
	$servers = array(
		array( 'urls' => array( 'stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302' ) ),
		array( 'urls' => 'stun:stun.cloudflare.com:3478' ),
	);
	$urls = array_filter( array_map( 'trim', preg_split( '/[\s,]+/', (string) get_option( 'ir_turn_urls', '' ) ) ) );
	if ( $urls ) {
		$servers[] = array(
			'urls'       => array_values( $urls ),
			'username'   => (string) get_option( 'ir_turn_username', '' ),
			'credential' => (string) get_option( 'ir_turn_credential', '' ),
		);
	}
	return $servers;
}

/* -------------------------------------------------------------------------
 * Interface theme and the BhoomiTech frame
 * ---------------------------------------------------------------------- */

/** 'light' or 'dark': a valid per-instance override wins, else the admin setting (default Light). */
function ir_get_theme( $override = '' ) {
	$override = is_string( $override ) ? strtolower( trim( $override ) ) : '';
	if ( in_array( $override, array( 'dark', 'light' ), true ) ) {
		return $override;
	}
	$saved = get_option( 'ir_theme', 'light' );
	return in_array( $saved, array( 'dark', 'light' ), true ) ? $saved : 'light';
}

function ir_sanitize_theme( $value ) {
	return in_array( $value, array( 'dark', 'light' ), true ) ? $value : 'light';
}

function ir_sanitize_flag( $value ) {
	return ! empty( $value ) && '0' !== $value ? '1' : '0';
}

function ir_code_protection() {
	return (bool) apply_filters( 'ir_code_protection', '1' === get_option( 'ir_protect', '1' ) );
}

function ir_frame_open( $variant = 'app', $theme = 'light' ) {
	return '<div class="ir-frame ir-theme-' . esc_attr( ir_get_theme( $theme ) ) . ' ir-frame-' . esc_attr( $variant ) . ( 'embed' === $variant ? ' ir-embed' : '' ) . '">'
		. '<div class="ir-frame-head"><span class="ir-frame-brand">' . esc_html__( 'Interview Recorder', 'interview-recorder' )
		. ' <span class="ir-frame-ver">v' . esc_html( IR_VERSION ) . '</span></span>'
		. '<button type="button" class="ir-fs" hidden data-on="' . esc_attr__( 'Full screen', 'interview-recorder' ) . '" data-off="' . esc_attr__( 'Exit full screen', 'interview-recorder' ) . '">'
		. '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg><span>' . esc_html__( 'Full screen', 'interview-recorder' ) . '</span></button></div>'
		. '<div class="ir-stage">';
}

function ir_frame_close() {
	return '</div><div class="ir-frame-foot">' . sprintf(
		/* translators: 1: developer name, 2: foundation name, 3: programme name */
		esc_html__( 'WordPress Plugin developed by %1$s for %2$s under %3$s', 'interview-recorder' ),
		'<strong>Shankar Sinha</strong>',
		'<strong>BhoomiTech Heritage and Development Foundation</strong>',
		'<strong>CDEP</strong>'
	) . '</div></div>';
}

/* -------------------------------------------------------------------------
 * Installable app (PWA): manifest and service worker for the host recorder page
 * ---------------------------------------------------------------------- */

function ir_pwa_enabled() {
	return (bool) apply_filters( 'ir_pwa_enabled', '1' === get_option( 'ir_pwa', '1' ) );
}

function ir_pwa_url( $what ) {
	return get_option( 'permalink_structure' )
		? home_url( '/' . IR_SLUG . '/app-' . $what )
		: add_query_arg( 'ir_pwa', $what, home_url( '/' ) );
}

/** Files the app needs to open without a connection (exact URLs the page requests). */
function ir_pwa_precache() {
	$base  = IR_URL . 'app/';
	$files = array(
		$base . 'guard.js?v=' . IR_VERSION,
		$base . 'pwa.js?v=' . IR_VERSION,
		$base . 'vendor/onest/onest-latin-wght-normal.woff2',
		$base . 'vendor/onest/onest-latin-ext-wght-normal.woff2',
		$base . 'icons/icon-192.png',
		$base . 'icons/icon-512.png',
		$base . 'icons/apple-touch-icon.png',
	);
	foreach ( array_merge( (array) glob( IR_DIR . 'app/assets/*.js' ), (array) glob( IR_DIR . 'app/assets/*.css' ) ) as $f ) {
		$files[] = $base . 'assets/' . basename( $f ) . ( '.css' === substr( $f, -4 ) ? '?v=' . IR_VERSION : '' ); // the stylesheet is requested with ?v= (see ir_render_app)
	}
	// The recorder loads its two workers with a build tag; read it from the app bundle.
	foreach ( (array) glob( IR_DIR . 'app/assets/*.js' ) as $f ) {
		$js = (string) file_get_contents( $f );
		foreach ( array( 'opfs-worker.js', 'wav-worklet.js' ) as $w ) {
			if ( preg_match( '/' . preg_quote( $w, '/' ) . '(\?v=[A-Za-z0-9]+)?/', $js, $m ) ) {
				$files[] = $base . $m[0];
			}
		}
	}
	return array_values( array_unique( $files ) );
}

add_action( 'template_redirect', 'ir_serve_pwa', 0 );
function ir_serve_pwa() {
	$what = get_query_var( 'ir_pwa' );
	if ( ! $what ) {
		return;
	}
	if ( ! defined( 'DONOTCACHEPAGE' ) ) {
		define( 'DONOTCACHEPAGE', true );
	}
	status_header( 200 );
	header( 'X-Robots-Tag: noindex, nofollow' );
	header( 'Cache-Control: no-cache, max-age=0' );

	if ( 'manifest' === $what ) {
		$theme = ir_get_theme();
		$color = 'dark' === $theme ? '#1d1e20' : '#d8d5ce';
		$icons = IR_URL . 'app/icons/';
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		echo wp_json_encode( array(
			'id'               => ir_app_url(),
			'name'             => __( 'Interview Recorder', 'interview-recorder' ),
			'short_name'       => __( 'Recorder', 'interview-recorder' ),
			'description'      => __( 'Record remote interviews in full quality.', 'interview-recorder' ),
			'start_url'        => ir_app_url(),
			'scope'            => ir_app_url(),
			'display'          => 'standalone',
			'orientation'      => 'any',
			'background_color' => $color,
			'theme_color'      => $color,
			'icons'            => array(
				array( 'src' => $icons . 'icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any' ),
				array( 'src' => $icons . 'icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any' ),
				array( 'src' => $icons . 'icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable' ),
			),
		), JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT );
		exit;
	}

	header( 'Content-Type: application/javascript; charset=utf-8' );
	if ( 'sw' !== $what || ! ir_pwa_enabled() ) {
		// Installation switched off: a worker that removes itself and its cache.
		echo "self.addEventListener('install',function(){self.skipWaiting();});\n"
			. "self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(k){return Promise.all(k.filter(function(n){return n.indexOf('ir-')===0;}).map(function(n){return caches.delete(n);}));}).then(function(){return self.registration.unregister();}));});\n";
		exit;
	}
	$vars = 'const CACHE=' . wp_json_encode( 'ir-' . IR_VERSION ) . ';'
		. 'const SHELL=' . wp_json_encode( ir_app_url() ) . ';'
		. 'const ASSETS=' . wp_json_encode( IR_URL . 'app/' ) . ';'
		. 'const PRECACHE=' . wp_json_encode( ir_pwa_precache(), JSON_UNESCAPED_SLASHES ) . ';'
		. 'const OFFLINE_TITLE=' . wp_json_encode( __( 'You’re offline', 'interview-recorder' ) ) . ';'
		. 'const OFFLINE_TEXT=' . wp_json_encode( __( 'Open the recorder once while connected, and it will open offline next time.', 'interview-recorder' ) ) . ';';
	echo $vars . "\n" . file_get_contents( IR_DIR . 'app/sw-body.js' ); // phpcs:ignore WordPress.Security.EscapeOutput -- our own script
	exit;
}

add_action( 'template_redirect', 'ir_render_app', 1 );
function ir_render_app() {
	$join = get_query_var( 'ir_join' );
	if ( ! get_query_var( 'ir_app' ) && ! $join ) {
		return;
	}
	$file = IR_DIR . 'app/index.html';
	$html = is_readable( $file ) ? file_get_contents( $file ) : false;
	if ( false === $html ) {
		wp_die( esc_html__( 'Interview Recorder files are missing. Please reinstall the plugin.', 'interview-recorder' ) );
	}

	$embed  = ! empty( $_GET['ir_embed'] ); // phpcs:ignore WordPress.Security.NonceVerification -- display flag only
	$theme  = ir_get_theme( isset( $_GET['ir_theme'] ) ? sanitize_key( wp_unslash( $_GET['ir_theme'] ) ) : '' ); // phpcs:ignore WordPress.Security.NonceVerification -- display option only
	$user   = wp_get_current_user();
	$config = array(
		'restUrl'    => esc_url_raw( rest_url( IR_NS . '/' ) ),
		'nonce'      => is_user_logged_in() ? wp_create_nonce( 'wp_rest' ) : '',
		'canHost'    => current_user_can( ir_host_capability() ),
		'userName'   => $user->exists() ? $user->display_name : '',
		'loginUrl'   => wp_login_url( ir_app_url( $embed ? array( 'ir_embed' => 1 ) : array() ) ),
		'appUrl'     => ir_app_url(),
		'siteName'   => wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES ),
		'iceServers' => ir_ice_servers(),
		'pollMs'     => 1000,
		'version'    => IR_VERSION,
		'theme'      => $theme,
		'pwa'        => ( ir_pwa_enabled() && ! $embed && ! $join ) ? array(
			'sw'    => ir_pwa_url( 'sw' ),
			'scope' => ir_app_url(),
		) : null,
		'guard'      => array(
			'protect' => ir_code_protection(),
			'home'    => esc_url_raw( home_url( '/' ) ),
		),
	);
	if ( $join ) {
		$invite = ir_resolve_join( $join );
		if ( $invite ) {
			$config['invite'] = $invite;
		} else {
			$config['inviteInvalid'] = true;
		}
	}

	// <base> makes the app's relative asset paths load from the plugin folder.
	$inject = '<base href="' . esc_url( IR_URL . 'app/' ) . '">' . "\n"
		. '<script>window.IR_CONFIG = ' . wp_json_encode( $config ) . ';</script>' . "\n"
		. '<meta name="robots" content="noindex, nofollow">';
	if ( ir_pwa_enabled() && ! $embed && ! $join ) {
		// Host recorder page only: guests use their invite link in the browser.
		$inject .= "\n" . '<link rel="manifest" href="' . esc_url( ir_pwa_url( 'manifest' ) ) . '">'
			. "\n" . '<link rel="apple-touch-icon" href="' . esc_url( IR_URL . 'app/icons/apple-touch-icon.png' ) . '">'
			. "\n" . '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">'
			. '<meta name="apple-mobile-web-app-title" content="' . esc_attr__( 'Recorder', 'interview-recorder' ) . '">'
			. "\n" . '<script src="' . esc_url( IR_URL . 'app/pwa.js?v=' . IR_VERSION ) . '"></script>';
	}
	if ( preg_match( '/<meta charset=[^>]*>/i', $html ) ) {
		$html = preg_replace( '/(<meta charset=[^>]*>)/i', "$1\n" . $inject, $html, 1 );
	} else {
		$html = preg_replace( '/<head>/i', "<head>\n" . $inject, $html, 1 );
	}
	$html   = preg_replace( '#<link rel="manifest" href="\./manifest\.json"[^>]*>#i', '', $html ); // the build's own manifest; the plugin serves its own below
	$html   = preg_replace( '#(<link rel="stylesheet"[^>]*href="\./assets/[^"?]+\.css)"#i', '$1?v=' . IR_VERSION . '"', $html ); // new plugin version = fresh stylesheet, whatever the browser, CDN or page cache holds
	$html   = preg_replace( '#<meta name="theme-color"[^>]*>#i', '<meta name="theme-color" content="' . ( 'dark' === $theme ? '#1d1e20' : '#d8d5ce' ) . '">', $html );
	$html   = preg_replace( '#<body[^>]*>#i', '<body class="ir-body ir-body-' . $theme . ( $embed ? ' ir-body-embed' : '' ) . '">', $html, 1 );
	$frame  = ir_frame_open( $embed ? 'embed' : 'app', $theme ) . '<div id="root"></div>' . ir_frame_close();
	$html   = preg_replace_callback( '#<!--ir-frame-->.*?<!--/ir-frame-->#s', function () use ( $frame ) {
		return $frame;
	}, $html, 1 );

	if ( ! defined( 'DONOTCACHEPAGE' ) ) {
		define( 'DONOTCACHEPAGE', true ); // tell page-cache plugins to skip this page
	}
	status_header( 200 );
	nocache_headers();
	header( 'Content-Type: text/html; charset=utf-8' );
	header( 'Permissions-Policy: camera=(self), microphone=(self), screen-wake-lock=(self)' );
	header( 'X-Robots-Tag: noindex, nofollow' );
	echo $html; // phpcs:ignore WordPress.Security.EscapeOutput -- our own bundled file plus escaped config
	exit;
}

/* -------------------------------------------------------------------------
 * Shortcode: [interview_recorder] puts the recorder inside any page or post.
 * The app runs in a same-site iframe so its styles and your theme's can't clash.
 * Attributes:
 *   (no height)       default: same as height="auto".
 *   height="fixed"    built-in per-screen heights (85vh desktop, 80vh mobile); the recorder scrolls inside.
 *   height="480" / "80vh"   one fixed height for every screen; height_tablet / height_mobile override it.
 *   height="100%"     fill the height of the container it sits in (it needs its own height).
 *   height="auto"     the box is always exactly as tall as the recorder: grows when an accordion opens, shrinks when it closes.
 *   min_height="280"  smallest height in px.
 *   theme="light|dark" overrides the Interface theme setting for this page.
 * The recorder scrolls inside the box when its content is taller.
 * ---------------------------------------------------------------------- */

add_shortcode( 'interview_recorder', 'ir_shortcode' );

/* -------------------------------------------------------------------------
 * Container height. By default the shortcode box is exactly as tall as the recorder (auto mode).
 * height="fixed" gives an exact, enforced height per screen size (the defaults below), and the
 * recorder scrolls inside it.
 * ---------------------------------------------------------------------- */

function ir_container_defaults() {
	return array(
		'tablet_max' => 1024,
		'mobile_max' => 767,
		'h'          => array(
			'desktop' => array( 'v' => '85', 'u' => 'vh' ),
			'tablet'  => array( 'v' => '', 'u' => '' ),   // '' = same as the larger screen
			'mobile'  => array( 'v' => '80', 'u' => 'vh' ),
		),
	);
}

function ir_clean_height( $v, $u ) {
	if ( ! in_array( $u, array( 'px', 'vh' ), true ) || ! is_numeric( $v ) || (float) $v <= 0 ) {
		return array( 'v' => '', 'u' => '' );
	}
	$range = ( 'px' === $u ) ? array( 320, 4000 ) : array( 30, 100 );
	$n     = max( $range[0], min( $range[1], (float) $v ) );
	return array( 'v' => (string) ( round( $n * 100 ) / 100 ), 'u' => $u );
}

/** Built-in per-screen heights, used only by height="fixed" (there is no admin setting for them). */
function ir_get_container() {
	return ir_container_defaults();
}

/** "480", "480px", "80vh" -> array( v, u ), or null. */
function ir_parse_height_att( $raw ) {
	$raw = strtolower( trim( (string) $raw ) );
	if ( preg_match( '/^(\d{2,4})(px)?$/', $raw, $m ) ) {
		return ir_clean_height( $m[1], 'px' );
	}
	if ( preg_match( '/^(\d{1,3})(vh|dvh|svh)$/', $raw, $m ) ) {
		return ir_clean_height( $m[1], 'vh' );
	}
	return null;
}

/** The media queries that enforce the heights. Printed once per page. */
function ir_container_css( $ct ) {
	$rule = function ( $d ) {
		return '.ir-embed.ir-fixed{height:var(--ir-h-' . $d . ')!important}'
			. '@supports (height:1dvh){.ir-embed.ir-fixed{height:var(--ir-hd-' . $d . ')!important}}';
	};
	return $rule( 'd' )
		. '@media (max-width:' . (int) $ct['tablet_max'] . 'px){' . $rule( 't' ) . '}'
		. '@media (max-width:' . (int) $ct['mobile_max'] . 'px){' . $rule( 'm' ) . '}';
}

function ir_print_embed_css() {
	static $done = false;
	if ( $done ) {
		return;
	}
	$done = true;
	$css  = '<style id="ir-embed-css">' . ir_container_css( ir_get_container() ) . '</style>';
	if ( did_action( 'wp_footer' ) ) {
		echo $css; // phpcs:ignore WordPress.Security.EscapeOutput -- built from validated numbers
	} else {
		add_action( 'wp_footer', function () use ( $css ) {
			echo $css; // phpcs:ignore WordPress.Security.EscapeOutput -- built from validated numbers
		}, 5 );
	}
}

function ir_shortcode( $atts ) {
	$atts = shortcode_atts( array( 'height' => '', 'height_tablet' => '', 'height_mobile' => '', 'min_height' => 280, 'theme' => '' ), $atts, 'interview_recorder' );
	$h    = strtolower( trim( (string) $atts['height'] ) );
	if ( '' === $h ) {
		$h = 'auto'; // default: the box is always exactly as tall as the recorder (grows and shrinks with the accordions)
	} elseif ( 'fixed' === $h ) {
		$h = ''; // height="fixed": use the built-in per-screen heights
	}
	$min  = max( 280, min( 2000, absint( $atts['min_height'] ) ) );

	// Legacy modes: height="auto" grows to fit by script; height="100%" fills a container that has its own height.
	$mode = 'fixed';
	if ( 'auto' === $h ) {
		$mode = 'auto';
	} elseif ( preg_match( '/^\d{1,3}%$/', $h ) ) {
		$mode = 'fill';
	}

	$args = array( 'ir_embed' => 1 );
	if ( 'auto' === $mode ) {
		$args['ir_auto'] = 1;
	}
	$theme = strtolower( trim( (string) $atts['theme'] ) );
	if ( in_array( $theme, array( 'dark', 'light' ), true ) ) {
		$args['ir_theme'] = $theme;
	}
	$src = ir_app_url( $args );

	$base = 'position:relative;box-sizing:border-box;width:100%;max-width:100%;clear:both;min-height:' . (int) $min . 'px;';
	if ( 'auto' === $mode ) {
		$box = $base . 'height:' . (int) $min . 'px;flex:none;overflow:hidden;';
		$cls = 'ir-embed';
		$dat = ' data-ir-auto="' . (int) $min . '"';
	} elseif ( 'fill' === $mode ) {
		$box = $base . 'height:' . esc_attr( $h ) . ';flex:1 1 auto;align-self:stretch;';
		$cls = 'ir-embed';
		$dat = '';
	} else {
		// Fixed per screen size: shortcode attributes win, then the admin setting.
		$ct   = ir_get_container();
		$over = ir_parse_height_att( $h );
		$res  = array();
		$prev = null;
		foreach ( array( 'desktop' => '', 'tablet' => $atts['height_tablet'], 'mobile' => $atts['height_mobile'] ) as $dev => $att ) {
			$e = ir_parse_height_att( $att );
			if ( ! $e && $over ) {
				$e = $over; // height="480" applies to every screen unless a per-screen attribute says otherwise
			}
			if ( ! $e ) {
				$e = $ct['h'][ $dev ];
			}
			if ( '' === $e['u'] && $prev ) {
				$e = $prev; // inherit from the larger screen
			}
			$prev        = $e;
			$res[ $dev ] = $e;
		}
		$vars = '';
		foreach ( array( 'd' => 'desktop', 't' => 'tablet', 'm' => 'mobile' ) as $k => $dev ) {
			$len   = $res[ $dev ]['v'] . $res[ $dev ]['u'];
			$vars .= '--ir-h-' . $k . ':' . $len . ';--ir-hd-' . $k . ':' . ( 'vh' === $res[ $dev ]['u'] ? $res[ $dev ]['v'] . 'dvh' : $len ) . ';';
		}
		// The first declaration is a fallback if the page's stylesheet rules are missing.
		$box = $base . 'height:' . $res['desktop']['v'] . $res['desktop']['u'] . ';flex:none;overflow:hidden;' . $vars;
		$cls = 'ir-embed ir-fixed';
		$dat = '';
		ir_print_embed_css();
	}

	$out = '<div class="' . $cls . '"' . $dat . ' style="' . esc_attr( $box ) . '">'
		. '<iframe src="' . esc_url( $src ) . '" title="' . esc_attr__( 'Interview Recorder', 'interview-recorder' ) . '"'
		. ' style="position:absolute;top:0;left:0;display:block;width:100%;height:100%;margin:0;border:0;border-radius:4px;"'
		. ' allow="camera; microphone; display-capture; clipboard-read; clipboard-write; screen-wake-lock; fullscreen" allowfullscreen loading="eager"></iframe>'
		. '</div>';
	if ( 'auto' === $mode ) {
		ir_print_embed_grow_script();
	}
	return $out;
}

/**
 * One small script per page that lets every auto-height shortcode box grow to fit the recorder.
 * It is printed in the footer (not inside the post content, where editors and filters can strip it)
 * and matches each message to its iframe by window, so it works even when the page and the
 * recorder address differ (www / non-www, http / https).
 */
function ir_print_embed_grow_script() {
	static $done = false;
	if ( $done ) {
		return;
	}
	$done = true;
	$js   = '<script>(function(){function boxes(){return document.querySelectorAll(".ir-embed[data-ir-auto]");}'
		. 'function ask(){var b=boxes();for(var i=0;i<b.length;i++){var f=b[i].querySelector("iframe");if(f&&f.contentWindow){try{f.contentWindow.postMessage({irMeasure:1},"*");}catch(x){}}}}'
		. 'window.addEventListener("message",function(e){var d=e.data;if(!d||typeof d.irHeight!=="number")return;'
		. 'var b=boxes();for(var i=0;i<b.length;i++){var f=b[i].querySelector("iframe");'
		. 'if(f&&f.contentWindow===e.source){var m=parseInt(b[i].getAttribute("data-ir-auto"),10)||420;b[i].style.height=Math.max(m,Math.ceil(d.irHeight))+"px";break;}}});'
		. 'ask();window.addEventListener("load",ask);window.addEventListener("resize",ask);window.addEventListener("orientationchange",function(){setTimeout(ask,300);});'
		. 'document.addEventListener("visibilitychange",ask);setTimeout(ask,500);setTimeout(ask,2000);})();</script>';
	if ( did_action( 'wp_footer' ) ) {
		echo $js; // phpcs:ignore WordPress.Security.EscapeOutput -- fixed script, no user input
	} else {
		add_action( 'wp_footer', function () use ( $js ) {
			echo $js; // phpcs:ignore WordPress.Security.EscapeOutput -- fixed script, no user input
		}, 99 );
	}
}

/* -------------------------------------------------------------------------
 * REST API: rooms and the message relay used to connect the call
 * ---------------------------------------------------------------------- */

add_action( 'rest_api_init', function () {
	register_rest_route( IR_NS, '/rooms', array(
		'methods'             => 'POST',
		'callback'            => 'ir_create_room',
		'permission_callback' => function () {
			return current_user_can( ir_host_capability() );
		},
	) );
	register_rest_route( IR_NS, '/rooms/(?P<id>[a-z0-9]+)', array(
		'methods'             => 'DELETE',
		'callback'            => 'ir_delete_room',
		'permission_callback' => '__return_true', // checked with the host key
	) );
	register_rest_route( IR_NS, '/signal', array(
		array(
			'methods'             => 'GET',
			'callback'            => 'ir_get_signals',
			'permission_callback' => '__return_true', // checked with the room key
		),
		array(
			'methods'             => 'POST',
			'callback'            => 'ir_post_signal',
			'permission_callback' => '__return_true',
		),
	) );
} );

function ir_now() {
	return current_time( 'mysql', true );
}

function ir_no_cache( $data, $status = 200 ) {
	$res = new WP_REST_Response( $data, $status );
	$res->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
	$res->header( 'X-LiteSpeed-Cache-Control', 'no-cache' );
	return $res;
}

/** Returns 'host' or 'guest' for a valid room + key, or a WP_Error. */
function ir_role( $room_id, $key ) {
	global $wpdb;
	$t       = ir_tables();
	$room_id = strtolower( (string) $room_id );
	$key     = (string) $key;
	if ( ! preg_match( '/^[a-z0-9]{1,32}$/', $room_id ) || '' === $key ) {
		return new WP_Error( 'ir_not_found', 'Interview not found.', array( 'status' => 404 ) );
	}
	$room = $wpdb->get_row( $wpdb->prepare( "SELECT id, host_key, guest_key FROM {$t['rooms']} WHERE id = %s", $room_id ) );
	if ( ! $room ) {
		return new WP_Error( 'ir_not_found', 'Interview not found.', array( 'status' => 404 ) );
	}
	if ( hash_equals( $room->host_key, $key ) ) {
		return 'host';
	}
	if ( hash_equals( $room->guest_key, $key ) ) {
		return 'guest';
	}
	return new WP_Error( 'ir_forbidden', 'This invite link isn’t valid.', array( 'status' => 403 ) );
}

function ir_random_key( $length ) {
	return wp_generate_password( $length, false, false );
}

function ir_cleanup() {
	global $wpdb;
	$t = ir_tables();
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$t['signals']} WHERE created_at < %s", gmdate( 'Y-m-d H:i:s', time() - 2 * HOUR_IN_SECONDS ) ) );
	$old = $wpdb->get_col( $wpdb->prepare( "SELECT id FROM {$t['rooms']} WHERE created_at < %s", gmdate( 'Y-m-d H:i:s', time() - 2 * DAY_IN_SECONDS ) ) );
	foreach ( $old as $id ) {
		$wpdb->delete( $t['signals'], array( 'room_id' => $id ) );
		$wpdb->delete( $t['rooms'], array( 'id' => $id ) );
	}
}

function ir_create_room( WP_REST_Request $req ) {
	global $wpdb;
	$t = ir_tables();
	ir_cleanup();

	$id       = strtolower( ir_random_key( 12 ) );
	$host_key = ir_random_key( 32 );
	do {
		$guest_key = ir_short_code();
	} while ( $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t['rooms']} WHERE guest_key = %s", $guest_key ) ) );
	$title     = mb_substr( sanitize_text_field( (string) $req->get_param( 'title' ) ), 0, 200 );

	$ok = $wpdb->insert( $t['rooms'], array(
		'id'         => $id,
		'host_key'   => $host_key,
		'guest_key'  => $guest_key,
		'title'      => $title,
		'created_by' => get_current_user_id(),
		'created_at' => ir_now(),
	) );
	if ( ! $ok ) {
		return new WP_Error( 'ir_db', 'Couldn’t save the interview room. Try deactivating and reactivating the plugin.', array( 'status' => 500 ) );
	}
	return ir_no_cache( array(
		'id'       => $id,
		'hostKey'  => $host_key,
		'guestKey' => $guest_key,
		'guestUrl' => ir_join_url( $guest_key ),
	) );
}

function ir_delete_room( WP_REST_Request $req ) {
	global $wpdb;
	$t    = ir_tables();
	$role = ir_role( $req['id'], $req->get_param( 'key' ) );
	if ( is_wp_error( $role ) ) {
		return $role;
	}
	if ( 'host' !== $role ) {
		return new WP_Error( 'ir_forbidden', 'Only the host can end the interview.', array( 'status' => 403 ) );
	}
	$wpdb->delete( $t['signals'], array( 'room_id' => $req['id'] ) );
	$wpdb->delete( $t['rooms'], array( 'id' => $req['id'] ) );
	return ir_no_cache( array( 'deleted' => true ) );
}

function ir_post_signal( WP_REST_Request $req ) {
	global $wpdb;
	$t    = ir_tables();
	$room = strtolower( (string) $req->get_param( 'room' ) );
	$role = ir_role( $room, $req->get_param( 'key' ) );
	if ( is_wp_error( $role ) ) {
		return $role;
	}
	$body = $req->get_param( 'body' );
	if ( ! is_array( $body ) || empty( $body['type'] ) || ! is_string( $body['type'] ) ) {
		return new WP_Error( 'ir_bad_message', 'Invalid message.', array( 'status' => 400 ) );
	}
	$json = wp_json_encode( $body );
	if ( strlen( $json ) > 65536 ) {
		return new WP_Error( 'ir_too_big', 'Message too large.', array( 'status' => 413 ) );
	}

	// Simple flood protection: a call setup needs a few dozen messages, not hundreds.
	$recent = (int) $wpdb->get_var( $wpdb->prepare(
		"SELECT COUNT(*) FROM {$t['signals']} WHERE room_id = %s AND created_at > %s",
		$room,
		gmdate( 'Y-m-d H:i:s', time() - MINUTE_IN_SECONDS )
	) );
	if ( $recent > 400 ) {
		return new WP_Error( 'ir_rate', 'Too many messages. Wait a moment.', array( 'status' => 429 ) );
	}

	$wpdb->insert( $t['signals'], array(
		'room_id'    => $room,
		'to_role'    => 'host' === $role ? 'guest' : 'host',
		'body'       => $json,
		'created_at' => ir_now(),
	) );
	$wpdb->update( $t['rooms'], array( $role . '_seen' => ir_now() ), array( 'id' => $room ) );
	return ir_no_cache( array( 'id' => (int) $wpdb->insert_id ) );
}

function ir_get_signals( WP_REST_Request $req ) {
	global $wpdb;
	$t    = ir_tables();
	$room = strtolower( (string) $req->get_param( 'room' ) );
	$role = ir_role( $room, $req->get_param( 'key' ) );
	if ( is_wp_error( $role ) ) {
		return $role;
	}
	$after = absint( $req->get_param( 'after' ) );

	if ( $req->get_param( 'init' ) ) {
		// A freshly opened page: anything already waiting is from an earlier visit.
		$wpdb->delete( $t['signals'], array( 'room_id' => $room, 'to_role' => $role ) );
		$rows = array();
	} else {
		if ( $after > 0 ) {
			// Delivered already: tidy up.
			$wpdb->query( $wpdb->prepare(
				"DELETE FROM {$t['signals']} WHERE room_id = %s AND to_role = %s AND id <= %d",
				$room, $role, $after
			) );
		}
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT id, body FROM {$t['signals']} WHERE room_id = %s AND to_role = %s AND id > %d ORDER BY id ASC LIMIT 100",
			$room, $role, $after
		) );
	}

	$wpdb->update( $t['rooms'], array( $role . '_seen' => ir_now() ), array( 'id' => $room ) );
	$peer_col  = 'host' === $role ? 'guest_seen' : 'host_seen';
	$peer_seen = $wpdb->get_var( $wpdb->prepare( "SELECT {$peer_col} FROM {$t['rooms']} WHERE id = %s", $room ) );
	$ago       = $peer_seen ? max( 0, time() - strtotime( $peer_seen . ' UTC' ) ) : null;

	$messages = array();
	foreach ( (array) $rows as $row ) {
		$messages[] = array(
			'id'   => (int) $row->id,
			'body' => json_decode( $row->body, true ),
		);
	}
	return ir_no_cache( array(
		'messages'    => $messages,
		'peerSeenAgo' => $ago,
	) );
}

/* -------------------------------------------------------------------------
 * Admin: menu, "Open" link, relay (TURN) settings
 * ---------------------------------------------------------------------- */

add_action( 'admin_menu', function () {
	add_menu_page(
		'Interview Recorder',
		'Interview Recorder',
		ir_host_capability(),
		'interview-recorder',
		'ir_admin_page',
		'dashicons-video-alt2',
		26
	);
} );

add_action( 'admin_init', function () {
	foreach ( array( 'ir_turn_urls', 'ir_turn_username', 'ir_turn_credential' ) as $opt ) {
		register_setting( 'ir_settings', $opt, array(
			'type'              => 'string',
			'sanitize_callback' => 'ir_sanitize_setting',
			'default'           => '',
		) );
	}
	register_setting( 'ir_settings', 'ir_theme', array(
		'type'              => 'string',
		'sanitize_callback' => 'ir_sanitize_theme',
		'default'           => 'light',
	) );
	register_setting( 'ir_settings', 'ir_pwa', array(
		'type'              => 'string',
		'sanitize_callback' => 'ir_sanitize_flag',
		'default'           => '1',
	) );
	register_setting( 'ir_settings', 'ir_protect', array(
		'type'              => 'string',
		'sanitize_callback' => 'ir_sanitize_flag',
		'default'           => '1',
	) );
} );

function ir_sanitize_setting( $value ) {
	return trim( sanitize_textarea_field( (string) $value ) );
}

add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
	array_unshift( $links, '<a href="' . esc_url( ir_app_url() ) . '" target="_blank" rel="noopener">Open recorder</a>' );
	return $links;
} );

function ir_admin_page() {
	if ( ! current_user_can( ir_host_capability() ) ) {
		return;
	}
	$pretty = (bool) get_option( 'permalink_structure' );
	?>
	<div class="wrap">
		<h1>Interview Recorder</h1>
		<p>Record remote interviews in full quality. You and your guest each record on your own computer; this site only connects the call.</p>
		<p><a class="button button-primary button-hero" href="<?php echo esc_url( ir_app_url() ); ?>" target="_blank" rel="noopener">Open recorder</a></p>
		<p>Recorder address: <code><?php echo esc_html( ir_app_url() ); ?></code>
		<br>Or put it inside any page or post with the shortcode <code>[interview_recorder]</code> (optional: <code>[interview_recorder theme="dark"]</code>).
		By default the box is always exactly as tall as the recorder: it grows when you open an accordion section and shrinks when you close it, so nothing is clipped and there is no gap above your footer. Other options: <code>height="fixed"</code> uses built-in per-screen heights (85vh desktop, 80vh mobile; the recorder scrolls inside); <code>height="700"</code> or <code>height="80vh"</code> sets one fixed height; <code>height="100%"</code> fills a container that has its own height.
		The recorder brings its own frame, so remove any border or box you added around the shortcode by hand.
		<?php if ( ! $pretty ) : ?>
			<br><em>Tip: turn on pretty permalinks (Settings &gt; Permalinks) to get the shorter address <code><?php echo esc_html( home_url( '/' . IR_SLUG . '/' ) ); ?></code>.</em>
		<?php endif; ?>
		</p>

		<?php if ( current_user_can( 'manage_options' ) ) : ?>
		<form method="post" action="options.php">
			<?php settings_fields( 'ir_settings' ); ?>
		<h2>Display</h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row">Interface theme</th>
				<td>
					<?php $ir_theme = ir_get_theme(); ?>
					<fieldset>
						<label><input type="radio" name="ir_theme" value="light" <?php checked( 'light', $ir_theme ); ?>> Light (stone, matte)</label><br>
						<label><input type="radio" name="ir_theme" value="dark" <?php checked( 'dark', $ir_theme ); ?>> Dark (graphite, matte)</label>
					</fieldset>
					<p class="description">Used on the recorder page and every shortcode. One page can use the other theme with <code>[interview_recorder theme="dark"]</code> or <code>theme="light"</code>.</p>
				</td>
			</tr>
			<tr>
				<th scope="row">Install as an app</th>
				<td>
					<input type="hidden" name="ir_pwa" value="0">
					<label><input type="checkbox" name="ir_pwa" value="1" <?php checked( '1', get_option( 'ir_pwa', '1' ) ); ?>> Let hosts install the recorder as an app (Chrome, Edge, Android, iPhone and iPad)</label>
					<p class="description">An "Install app" button appears at the top of <code><?php echo esc_html( ir_app_url() ); ?></code>; it opens in its own window and starts even without a connection (recording yourself works offline; interviews need one). Needs HTTPS. Guests keep using their invite link in the browser. Switching this off also removes the app's stored files from browsers that installed it.</p>
				</td>
			</tr>
			<tr>
				<th scope="row">Code protection</th>
				<td>
					<input type="hidden" name="ir_protect" value="0">
					<label><input type="checkbox" name="ir_protect" value="1" <?php checked( '1', get_option( 'ir_protect', '1' ) ); ?>> Send visitors to the site's main page if they open the browser's developer tools or view-source</label>
					<p class="description">Right-click stays off either way; text fields offer only Copy and Paste. Turn this off while troubleshooting the recorder in your browser's console. It discourages casual copying but can't fully hide files a browser has downloaded.</p>
				</td>
			</tr>
		</table>

		<h2>Relay server (optional)</h2>
		<p>Most calls connect directly. Some office, school and mobile networks block that; a TURN relay server gets those calls through.
			Free options include Metered (metered.ca) and Cloudflare Calls. Paste the details they give you.</p>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="ir_turn_urls">TURN server URLs</label></th>
					<td>
						<textarea id="ir_turn_urls" name="ir_turn_urls" rows="3" class="large-text code" placeholder="turn:global.relay.metered.ca:80&#10;turns:global.relay.metered.ca:443?transport=tcp"><?php echo esc_textarea( get_option( 'ir_turn_urls', '' ) ); ?></textarea>
						<p class="description">One per line.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="ir_turn_username">Username</label></th>
					<td><input id="ir_turn_username" name="ir_turn_username" type="text" class="regular-text" value="<?php echo esc_attr( get_option( 'ir_turn_username', '' ) ); ?>"></td>
				</tr>
				<tr>
					<th scope="row"><label for="ir_turn_credential">Password / credential</label></th>
					<td><input id="ir_turn_credential" name="ir_turn_credential" type="text" class="regular-text" value="<?php echo esc_attr( get_option( 'ir_turn_credential', '' ) ); ?>"></td>
				</tr>
			</table>
			<?php submit_button( 'Save settings' ); ?>
		</form>
		<?php endif; ?>

		<h2>If calls don’t connect</h2>
		<ul style="list-style:disc;padding-left:20px">
			<li>Caching plugins or a CDN: exclude <code>/recorder/</code>, <code>/join/</code> and <code>/wp-json/interview-recorder/</code> from caching.</li>
			<li>Security plugins (e.g. Wordfence): allow <code>/wp-json/interview-recorder/</code>; the recorder checks in about once a second while connecting.</li>
			<li>If one side is on an office or mobile network, add a relay server above.</li>
		</ul>
	</div>
	<?php
}
