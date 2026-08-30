<?php
/**
 * TranslitLab — API endpoint (Database edition)
 * ──────────────────────────────────────────────
 * Drop-in replacement for the file-based api.php. Request/response
 * surface is identical — app.js needs no changes for load/run/save.
 *
 * New action: 'check_sort_order_conflicts' — used by the frontend to
 * detect and let the user rectify duplicate sort_order values before
 * importing/adding records (per schema.sql UNIQUE constraints).
 *
 * Requires: db.php (connection) + engine.php (transliteration logic)
 * Compatible with PHP 7.4+
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/engine.php';

// ── Output helpers ────────────────────────────────────────────────────────

function json_out($data) {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function api_err($msg, $code = 400) {
    http_response_code($code);
    json_out(['error' => $msg]);
}

function map_table($type) {
    return $type === 'reverse' ? 'translit_reverse_map' : 'translit_forward_map';
}

// ── DB read helpers ──────────────────────────────────────────────────────

/**
 * Load a map (forward or reverse) from DB, grouped by section,
 * ordered by sort_order within each section.
 */
function db_load_map($type) {
    $pdo   = get_db();
    $table = map_table($type);
    $stmt  = $pdo->query(
        "SELECT id, section, map_key, map_val, sort_order
         FROM {$table}
         ORDER BY section ASC, sort_order ASC, id ASC"
    );
    $rows = $stmt->fetchAll();

    $map = [];
    foreach ($rows as $row) {
        $sec = $row['section'] ?: 'general';
        // v3 format: [id, map_key, map_val] — id needed for reorder_map_section
        $map[$sec][] = [(int)$row['id'], $row['map_key'], $row['map_val']];
    }
    return $map;
}

/**
 * Load all snippets from DB.
 */
function db_load_snippets() {
    $pdo  = get_db();
    $stmt = $pdo->query(
        "SELECT snippet_key, label, direction, hook_stage, sort_order,
                is_active, source, logic_description, js_body, php_body
         FROM translit_snippets
         ORDER BY direction ASC, hook_stage ASC, sort_order ASC, id ASC"
    );
    $rows = $stmt->fetchAll();

    foreach ($rows as &$r) {
        $r['sort_order'] = (int)$r['sort_order'];
        $r['is_active']  = (int)$r['is_active'];
    }
    unset($r);

    return $rows;
}

/**
 * Load engine settings for one engine ('js' or 'php').
 */
function db_load_settings($engine) {
    $pdo  = get_db();
    $stmt = $pdo->prepare(
        "SELECT setting_key, setting_val
         FROM translit_settings
         WHERE engine = ?"
    );
    $stmt->execute([$engine]);
    $rows = $stmt->fetchAll();

    $out = [];
    foreach ($rows as $row) {
        $v = $row['setting_val'];
        $decoded = json_decode($v, true);
        $out[$row['setting_key']] = (json_last_error() === JSON_ERROR_NONE)
            ? $decoded
            : $v;
    }
    return $out;
}

// ── Sort-order conflict detection / resolution ──────────────────────────

/**
 * Scan items grouped by $groupFn and return conflicts: groups where two
 * or more items share a sort_order.
 *
 * @return array  [ groupKey => [ sort_order => [item_labels...] ] ]
 */
function find_sort_order_conflicts(array $items, callable $groupFn, callable $orderFn, callable $labelFn) {
    $buckets = [];
    foreach ($items as $item) {
        $buckets[$groupFn($item)][$orderFn($item)][] = $labelFn($item);
    }
    $conflicts = [];
    foreach ($buckets as $groupKey => $orders) {
        foreach ($orders as $so => $labels) {
            if (count($labels) > 1) {
                $conflicts[$groupKey][$so] = $labels;
            }
        }
    }
    return $conflicts;
}

/**
 * Renumber items within their group so sort_order is unique, preserving
 * relative order (stable sort by original sort_order).
 *
 * @return array  items with 'sort_order' rewritten where needed; appends
 *                human-readable notes to $report.
 */
function dedupe_sort_orders(array $items, callable $groupFn, array &$report) {
    $buckets = [];
    foreach ($items as $i => $item) {
        $buckets[$groupFn($item)][] = ['idx' => $i, 'item' => $item];
    }

    $result = $items;
    foreach ($buckets as $groupKey => $entries) {
        $orders = array_map(fn($e) => (int)($e['item']['sort_order'] ?? 0), $entries);
        if (count($orders) === count(array_unique($orders))) continue;

        usort($entries, function($a, $b) {
            $oa = (int)($a['item']['sort_order'] ?? 0);
            $ob = (int)($b['item']['sort_order'] ?? 0);
            return $oa <=> $ob;
        });

        $before = array_map(fn($e) => ($e['item']['snippet_key'] ?? $e['item']['map_key'] ?? '?') . '=' . ($e['item']['sort_order'] ?? 0), $entries);

        $next = 0;
        foreach ($entries as $e) {
            $result[$e['idx']]['sort_order'] = $next;
            $next++;
        }

        $after = [];
        foreach ($entries as $e) {
            $after[] = ($result[$e['idx']]['snippet_key'] ?? $result[$e['idx']]['map_key'] ?? '?') . '=' . $result[$e['idx']]['sort_order'];
        }

        $report[] = "Group [{$groupKey}]: duplicate sort_order resolved. Before: " . implode(', ', $before) . " | After: " . implode(', ', $after);
    }

    return $result;
}

// ── Route ────────────────────────────────────────────────────────────────

$action = isset($_GET['action']) ? (string)$_GET['action'] : '';
$body   = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    if ($raw !== false && $raw !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) $body = $decoded;
    }
    if ($action === '' && isset($body['action'])) $action = (string)$body['action'];
}

switch ($action) {

    // ── load ────────────────────────────────────────────────────────────
    case 'load':
        json_out([
            'snippets'     => db_load_snippets(),
            'forward_map'  => db_load_map('forward'),
            'reverse_map'  => db_load_map('reverse'),
            'php_settings' => db_load_settings('php'),
            'js_settings'  => db_load_settings('js'),
        ]);

    // ── run_php ─────────────────────────────────────────────────────────
    case 'run_php':
        $input     = isset($body['input'])     ? (string)$body['input']     : '';
        $direction = isset($body['direction']) ? (string)$body['direction'] : 'forward';
        $snippets  = isset($body['snippets'])  && is_array($body['snippets'])  ? $body['snippets']  : db_load_snippets();
        $fwd_map   = isset($body['forward_map']) && is_array($body['forward_map']) ? $body['forward_map'] : db_load_map('forward');
        $rev_map   = isset($body['reverse_map']) && is_array($body['reverse_map']) ? $body['reverse_map'] : db_load_map('reverse');
        $settings  = isset($body['php_settings']) && is_array($body['php_settings']) ? $body['php_settings'] : db_load_settings('php');

        $engine = new TranslitEngine($fwd_map, $rev_map, $settings);
        $result = $engine->transliterate($input, $direction, $snippets);
        json_out(['ok' => true, 'output' => $result['output'], 'log' => $result['log']]);

    // ── get_engine_source ──────────────────────────────────────────────
    case 'get_engine_source':
        json_out([
            'js'  => file_exists(__DIR__ . '/engine.js')  ? file_get_contents(__DIR__ . '/engine.js')  : '',
            'php' => file_exists(__DIR__ . '/engine.php') ? file_get_contents(__DIR__ . '/engine.php') : '',
        ]);

    // ── check_sort_order_conflicts ─────────────────────────────────────
    // Frontend calls this before importing/adding records to detect
    // duplicate sort_order values that would violate the schema's
    // UNIQUE constraints, so the user can rectify them in the UI.
    case 'check_sort_order_conflicts':
        $type = isset($body['type']) ? (string)$body['type'] : '';

        if ($type === 'forward' || $type === 'reverse') {
            $data = isset($body['data']) && is_array($body['data']) ? $body['data'] : [];
            $items = [];
            foreach ($data as $section => $entries) {
                if ($section === '_meta' || !is_array($entries)) continue;
                foreach ($entries as $i => $pair) {
                    if (!is_array($pair) || count($pair) < 2) continue;
                    $items[] = [
                        'section'    => $section,
                        'map_key'    => $pair[0],
                        'sort_order' => $i, // implicit from array position
                    ];
                }
            }
            $conflicts = find_sort_order_conflicts(
                $items,
                fn($it) => $it['section'],
                fn($it) => $it['sort_order'],
                fn($it) => $it['map_key']
            );
            json_out(['ok' => true, 'conflicts' => $conflicts]);
        }

        if ($type === 'snippets') {
            $snippets = isset($body['snippets']) && is_array($body['snippets']) ? $body['snippets'] : [];
            $conflicts = find_sort_order_conflicts(
                $snippets,
                fn($s) => ($s['direction'] ?? 'forward') . '::' . ($s['hook_stage'] ?? 'pre'),
                fn($s) => (int)($s['sort_order'] ?? 0),
                fn($s) => $s['snippet_key'] ?? '?'
            );
            json_out(['ok' => true, 'conflicts' => $conflicts]);
        }

        api_err('type must be forward, reverse, or snippets');

    // ── save_snippets ───────────────────────────────────────────────────
    case 'save_snippets':
        $snippets = isset($body['snippets']) ? $body['snippets'] : null;
        if (!is_array($snippets)) api_err('snippets must be array');

        $report = [];
        $snippets = dedupe_sort_orders(
            $snippets,
            fn($s) => ($s['direction'] ?? 'forward') . '::' . ($s['hook_stage'] ?? 'pre'),
            $report
        );

        $pdo = get_db();

        $incoming_keys = array_map(fn($s) => $s['snippet_key'] ?? '', $snippets);
        $incoming_keys = array_filter($incoming_keys);

        $pdo->beginTransaction();
        try {
            if (!empty($incoming_keys)) {
                $placeholders = implode(',', array_fill(0, count($incoming_keys), '?'));
                $pdo->prepare(
                    "DELETE FROM translit_snippets WHERE snippet_key NOT IN ({$placeholders})"
                )->execute(array_values($incoming_keys));
            } else {
                $pdo->exec("DELETE FROM translit_snippets");
            }

            // Bump existing rows' sort_order out of the way first to avoid
            // transient UNIQUE(direction,hook_stage,sort_order) collisions
            // while reordering.
            $pdo->exec("UPDATE translit_snippets SET sort_order = sort_order + 1000000");

            $stmt = $pdo->prepare("
                INSERT INTO translit_snippets
                    (snippet_key, label, direction, hook_stage, sort_order,
                     is_active, source, logic_description, js_body, php_body)
                VALUES
                    (:snippet_key, :label, :direction, :hook_stage, :sort_order,
                     :is_active, :source, :logic_description, :js_body, :php_body)
                ON DUPLICATE KEY UPDATE
                    label             = VALUES(label),
                    direction         = VALUES(direction),
                    hook_stage        = VALUES(hook_stage),
                    sort_order        = VALUES(sort_order),
                    is_active         = VALUES(is_active),
                    source            = VALUES(source),
                    logic_description = VALUES(logic_description),
                    js_body           = VALUES(js_body),
                    php_body          = VALUES(php_body)
            ");

            foreach ($snippets as $s) {
                if (empty($s['snippet_key'])) continue;
                // Empty js_body/php_body allowed for custom snippets —
                // user fills these in later via the editor.
                $stmt->execute([
                    ':snippet_key'       => $s['snippet_key'],
                    ':label'             => $s['label']             ?? '',
                    ':direction'         => $s['direction']         ?? 'forward',
                    ':hook_stage'        => $s['hook_stage']        ?? 'pre',
                    ':sort_order'        => (int)($s['sort_order']  ?? 0),
                    ':is_active'         => (int)($s['is_active']   ?? 1),
                    ':source'            => $s['source']            ?? 'custom',
                    ':logic_description' => $s['logic_description'] ?? '',
                    ':js_body'           => $s['js_body']           ?? '',
                    ':php_body'          => $s['php_body']          ?? '',
                ]);
            }

            $pdo->commit();
        } catch (PDOException $e) {
            $pdo->rollBack();
            api_err('DB error: ' . $e->getMessage(), 500);
        }

        json_out(['ok' => true, 'corrections' => $report]);

    // ── save_map ────────────────────────────────────────────────────────
    case 'save_map':
        $type = isset($body['type']) ? (string)$body['type'] : '';
        $data = isset($body['data']) ? $body['data'] : null;

        if (!in_array($type, ['forward', 'reverse'], true)) api_err('type must be forward or reverse');
        if (!is_array($data)) api_err('data must be an object');

        $pdo   = get_db();
        $table = map_table($type);
        $report = [];

        $pdo->beginTransaction();
        try {
            $pdo->exec("DELETE FROM {$table}");

            $stmt = $pdo->prepare("
                INSERT INTO {$table} (section, map_key, map_val, sort_order)
                VALUES (:s, :k, :v, :o)
            ");

            foreach ($data as $section => $entries) {
                if ($section === '_meta' || !is_array($entries)) continue;

                $seen = [];
                $hasDup = false;
                foreach ($entries as $i => $pair) {
                    $so = is_array($pair) && isset($pair['sort_order']) ? (int)$pair['sort_order'] : $i;
                    if (isset($seen[$so])) $hasDup = true;
                    $seen[$so] = true;
                }
                if ($hasDup) {
                    $report[] = "Section [{$section}]: duplicate sort_order detected in incoming data; reassigned by array order.";
                }

                $order = 0;
                foreach ($entries as $pair) {
                    if (!is_array($pair) || count($pair) < 2) continue;
                    $stmt->execute([':s' => $section, ':k' => (string)$pair[0], ':v' => (string)$pair[1], ':o' => $order]);
                    $order++;
                }
            }

            $pdo->commit();
        } catch (PDOException $e) {
            $pdo->rollBack();
            api_err('DB error: ' . $e->getMessage(), 500);
        }

        json_out(['ok' => true, 'corrections' => $report]);

    // ── save_engine_settings ────────────────────────────────────────────
    case 'save_engine_settings':
        $engine = isset($body['engine']) ? (string)$body['engine'] : '';
        $data   = isset($body['data']) && is_array($body['data']) ? $body['data'] : null;

        if (!in_array($engine, ['js', 'php'], true)) api_err('engine must be js or php');
        if ($data === null) api_err('data must be an object');

        $pdo  = get_db();
        $stmt = $pdo->prepare("
            INSERT INTO translit_settings (engine, setting_key, setting_val)
            VALUES (:engine, :k, :v)
            ON DUPLICATE KEY UPDATE setting_val = VALUES(setting_val)
        ");

        foreach ($data as $k => $v) {
            $stmt->execute([
                ':engine' => $engine,
                ':k'      => $k,
                ':v'      => is_scalar($v) ? (string)$v : json_encode($v, JSON_UNESCAPED_UNICODE),
            ]);
        }

        json_out(['ok' => true]);

    // ── reset_defaults ───────────────────────────────────────────────────
    // Resets to FACTORY defaults (root *.json / defaults.json), NOT the
    // user's active /data/ config. Use with caution — distinct from the
    // initial seed, which loads from /data/.
    case 'reset_defaults':
        $which = isset($body['which']) ? (string)$body['which'] : 'all';
        $pdo   = get_db();

        $import_map = function($type, $file) use ($pdo) {
            $data = file_exists($file) ? json_decode(file_get_contents($file), true) : null;
            if (!is_array($data)) return false;

            $table = map_table($type);
            $pdo->beginTransaction();
            try {
                $pdo->exec("DELETE FROM {$table}");
                $stmt = $pdo->prepare("
                    INSERT INTO {$table} (section, map_key, map_val, sort_order)
                    VALUES (:s, :k, :v, :o)
                ");
                foreach ($data as $section => $entries) {
                    if ($section === '_meta' || !is_array($entries)) continue;
                    $order = 0;
                    foreach ($entries as $pair) {
                        if (!is_array($pair) || count($pair) < 2) continue;
                        $stmt->execute([':s' => $section, ':k' => (string)$pair[0], ':v' => (string)$pair[1], ':o' => $order]);
                        $order++;
                    }
                }
                $pdo->commit();
                return true;
            } catch (PDOException $e) {
                $pdo->rollBack();
                return false;
            }
        };

        $import_snippets = function() use ($pdo) {
            $src  = __DIR__ . '/defaults.json';
            $data = file_exists($src) ? json_decode(file_get_contents($src), true) : null;
            if (!is_array($data)) return false;

            $report = [];
            $data = dedupe_sort_orders(
                $data,
                fn($s) => ($s['direction'] ?? 'forward') . '::' . ($s['hook_stage'] ?? 'pre'),
                $report
            );

            $pdo->exec("DELETE FROM translit_snippets");
            $stmt = $pdo->prepare("
                INSERT INTO translit_snippets
                    (snippet_key, label, direction, hook_stage, sort_order,
                     is_active, source, logic_description, js_body, php_body)
                VALUES
                    (:snippet_key, :label, :direction, :hook_stage, :sort_order,
                     :is_active, :source, :logic_description, :js_body, :php_body)
            ");
            foreach ($data as $s) {
                if (empty($s['snippet_key'])) continue;
                $stmt->execute([
                    ':snippet_key'       => $s['snippet_key'],
                    ':label'             => $s['label']             ?? '',
                    ':direction'         => $s['direction']         ?? 'forward',
                    ':hook_stage'        => $s['hook_stage']        ?? 'pre',
                    ':sort_order'        => (int)($s['sort_order']  ?? 0),
                    ':is_active'         => (int)($s['is_active']   ?? 1),
                    ':source'            => $s['source']            ?? 'custom',
                    ':logic_description' => $s['logic_description'] ?? '',
                    ':js_body'           => $s['js_body']           ?? '',
                    ':php_body'          => $s['php_body']          ?? '',
                ]);
            }
            return true;
        };

        $import_settings = function($engine) use ($pdo) {
            $file = __DIR__ . "/{$engine}-engine-settings.default.json";
            $data = file_exists($file) ? json_decode(file_get_contents($file), true) : null;
            if (!is_array($data)) return false;

            $stmt = $pdo->prepare("
                INSERT INTO translit_settings (engine, setting_key, setting_val)
                VALUES (:engine, :k, :v)
                ON DUPLICATE KEY UPDATE setting_val = VALUES(setting_val)
            ");
            foreach ($data as $k => $v) {
                $stmt->execute([
                    ':engine' => $engine,
                    ':k'      => $k,
                    ':v'      => is_scalar($v) ? (string)$v : json_encode($v, JSON_UNESCAPED_UNICODE),
                ]);
            }
            return true;
        };

        $out = ['ok' => true];

        if ($which === 'snippets'     || $which === 'all') $import_snippets();
        if ($which === 'forward'      || $which === 'all') $import_map('forward', __DIR__ . '/forwardMap.json');
        if ($which === 'reverse'      || $which === 'all') $import_map('reverse', __DIR__ . '/reverseMap.json');
        if ($which === 'php_settings' || $which === 'all') {
            $import_settings('php');
            if ($which === 'php_settings') $out['data'] = db_load_settings('php');
        }
        if ($which === 'js_settings'  || $which === 'all') {
            $import_settings('js');
            if ($which === 'js_settings') $out['data'] = db_load_settings('js');
        }

        json_out($out);

    // ── reorder_map_section ──────────────────────────────────────────────
    // Accepts:  type ('forward'|'reverse'), section (string), ids (int[])
    // Reassigns sort_order 0,1,2… in the given id order within the section.
    // Only touches sort_order — map_key/map_val are untouched.
    case 'reorder_map_section':
        $type    = isset($body['type'])    ? (string)$body['type']    : '';
        $section = isset($body['section']) ? (string)$body['section'] : '';
        $ids     = isset($body['ids'])     && is_array($body['ids'])  ? $body['ids'] : null;

        if (!in_array($type, ['forward', 'reverse'], true)) api_err('type must be forward or reverse');
        if ($section === '')  api_err('section is required');
        if ($ids === null)    api_err('ids must be an array');

        // Validate: all values must be positive integers
        $ids = array_values(array_map('intval', $ids));
        if (in_array(0, $ids, true)) api_err('ids must be positive integers');

        $pdo   = get_db();
        $table = map_table($type);

        $pdo->beginTransaction();
        try {
            // Step 1 — shift all rows in this section far out of range to avoid
            // transient UNIQUE(section, sort_order) collisions during rewrite.
            $pdo->prepare(
                "UPDATE {$table} SET sort_order = sort_order + 1000000
                 WHERE section = ?"
            )->execute([$section]);

            // Step 2 — write new sort_order values in the given id order.
            $upd = $pdo->prepare(
                "UPDATE {$table} SET sort_order = ? WHERE id = ? AND section = ?"
            );
            foreach ($ids as $newOrder => $id) {
                $upd->execute([$newOrder, $id, $section]);
            }

            $pdo->commit();
        } catch (PDOException $e) {
            $pdo->rollBack();
            api_err('DB error: ' . $e->getMessage(), 500);
        }

        json_out(['ok' => true]);

    // ── unknown ──────────────────────────────────────────────────────────
    default:
        api_err('Unknown action: ' . htmlspecialchars($action), 404);
}
