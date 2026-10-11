<?php
// Runs when the plugin is deleted from the Plugins screen. Recordings are never stored on the
// site, so this only removes the plugin's rooms, relay messages and settings.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
global $wpdb;
$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}ir_signals" );
$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}ir_rooms" );
foreach ( array( 'ir_db_version', 'ir_turn_urls', 'ir_turn_username', 'ir_turn_credential', 'ir_theme', 'ir_protect', 'ir_pwa', 'ir_container' ) as $opt ) {
	delete_option( $opt );
}
