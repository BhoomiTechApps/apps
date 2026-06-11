<?php
/**
 * Transliteration Lab — API endpoint
 * Handles all AJAX requests from the browser UI.
 * Compatible with PHP 7.4+
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/engine.php';

$DATA_DIR   = __DIR__ . '/../user_data/';
$SNIPPETS_F = $DATA_DIR . 'snippets.json';
$FWD_MAP_F  = $DATA_DIR . 'forwardMap.json';
$REV_MAP_F  = $DATA_DIR . 'reverseMap.json';

function read_json($path) {
    if (!file_exists($path)) return null;
    $raw = file_get_contents($path);
    return $raw !== false ? json_decode($raw, true) : null;
}

function write_json($path, $data) {
    $dir = dirname($path);
    if (!is_dir($dir)) mkdir($dir, 0777, true);
    return (bool) file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function json_out($data) {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function api_err($msg, $code = 400) {
    http_response_code($code);
    json_out(['error' => $msg]);
}

// ── Init defaults if user_data/ copies are missing ─────────────────────────────────
if (!is_dir($DATA_DIR)) mkdir($DATA_DIR, 0777, true);

if (!file_exists($FWD_MAP_F) && file_exists(__DIR__ . '/../default_data/forwardMap.json'))
    copy(__DIR__ . '/../default_data/forwardMap.json', $FWD_MAP_F);

if (!file_exists($REV_MAP_F) && file_exists(__DIR__ . '/../default_data/reverseMap.json'))
    copy(__DIR__ . '/../default_data/reverseMap.json', $REV_MAP_F);

if (!file_exists($SNIPPETS_F)) {
    $src = __DIR__ . '/../default_data/defaults.json';
    if (file_exists($src)) copy($src, $SNIPPETS_F);
    else write_json($SNIPPETS_F, []);
}

// ── Route ─────────────────────────────────────────────────────────────────────
$action = isset($_GET['action']) ? $_GET['action'] : '';
$body   = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    if ($raw !== false && $raw !== '') {
        $body = json_decode($raw, true);
        if (!is_array($body)) $body = [];
    }
    if ($action === '' && isset($body['action'])) $action = $body['action'];
}

switch ($action) {

    case 'get_engine_source':
        json_out([
            'js'  => file_exists(__DIR__ . '/../js/engine.js')  ? file_get_contents(__DIR__ . '/../js/engine.js')  : '',
            'php' => file_exists(__DIR__ . '/engine.php') ? file_get_contents(__DIR__ . '/engine.php') : '',
        ]);

    case 'load':
        $snippets    = read_json($SNIPPETS_F);
        $forward_map = read_json($FWD_MAP_F);
        $reverse_map = read_json($REV_MAP_F);
        json_out([
            'snippets'    => is_array($snippets)    ? $snippets    : [],
            'forward_map' => is_array($forward_map) ? $forward_map : new stdClass(),
            'reverse_map' => is_array($reverse_map) ? $reverse_map : new stdClass(),
        ]);

    case 'run_php':
        $input     = isset($body['input'])     ? (string)$body['input']     : '';
        $direction = isset($body['direction']) ? (string)$body['direction'] : 'forward';
        $snippets  = isset($body['snippets'])  && is_array($body['snippets']) ? $body['snippets'] : [];
        $fwd_map   = isset($body['forward_map']) && is_array($body['forward_map'])
                     ? $body['forward_map']
                     : (read_json($FWD_MAP_F) ?: []);
        $rev_map   = isset($body['reverse_map']) && is_array($body['reverse_map'])
                     ? $body['reverse_map']
                     : (read_json($REV_MAP_F) ?: []);

        $engine = new TranslitEngine($fwd_map, $rev_map);
        $result = $engine->transliterate($input, $direction, $snippets);
        json_out(['ok' => true, 'output' => $result['output'], 'log' => $result['log']]);

    case 'save_snippets':
        $snippets = isset($body['snippets']) ? $body['snippets'] : null;
        if (!is_array($snippets)) api_err('snippets must be array');
        write_json($SNIPPETS_F, $snippets);
        json_out(['ok' => true]);

    case 'save_map':
        $type = isset($body['type']) ? (string)$body['type'] : '';
        $data = isset($body['data']) ? $body['data'] : null;
        if ($type === 'forward')      write_json($FWD_MAP_F, $data);
        elseif ($type === 'reverse')  write_json($REV_MAP_F, $data);
        else api_err('type must be forward or reverse');
        json_out(['ok' => true]);

    case 'reset_defaults':
        $which = isset($body['which']) ? (string)$body['which'] : 'all';
        if ($which === 'snippets' || $which === 'all') {
            $src = __DIR__ . '/../default_data/defaults.json';
            if (file_exists($src)) copy($src, $SNIPPETS_F);
        }
        if ($which === 'forward' || $which === 'all') {
            $src = __DIR__ . '/../default_data/forwardMap.json';
            if (file_exists($src)) copy($src, $FWD_MAP_F);
        }
        if ($which === 'reverse' || $which === 'all') {
            $src = __DIR__ . '/../default_data/reverseMap.json';
            if (file_exists($src)) copy($src, $REV_MAP_F);
        }
        json_out(['ok' => true]);

    default:
        api_err('Unknown action: ' . htmlspecialchars($action), 404);
}
