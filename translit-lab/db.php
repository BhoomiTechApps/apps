<?php
/**
 * TranslitLab — Database Connection
 * ─────────────────────────────────
 * Local (USBWebServer / XAMPP / plain MySQL):
 *   Uses raw PDO. Edit the four constants below to match your setup.
 *
 * WordPress migration:
 *   Replace get_db() body with a thin $wpdb wrapper — everything else
 *   in api.php stays the same.
 */

define('DB_HOST',    'localhost');
define('DB_NAME',    'translitlab');
define('DB_USER',    'root');
define('DB_PASS',    'usbw');
define('DB_PORT', 3306);
define('DB_CHARSET', 'utf8mb4');

/**
 * Returns a singleton PDO instance.
 */
function get_db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            DB_HOST, DB_PORT, DB_NAME
        );
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
        $pdo->exec("SET CHARACTER SET utf8mb4");
    }
    return $pdo;
}
