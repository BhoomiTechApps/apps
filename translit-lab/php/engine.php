<?php
/**
 * Transliteration Lab — PHP Engine
 * Mirrors class-engine.php from CompilingAI plugin.
 * Standalone, no WordPress. Compatible with PHP 7.4+
 */

class TranslitEngine {

    private $forward_map = [];
    private $reverse_map = [];
    private $virama;
    private $inherent_vowel = 'o';
    private $zwj;
    private $zwnj;
    private $non_linking_consonants = ['ng','M','NG','Ng',':','H','^','~'];

    public function __construct(array $forward_map, array $reverse_map) {
        $this->virama       = "\u{09CD}";
        $this->zwj          = "\u{200D}";
        $this->zwnj         = "\u{200C}";
        $this->forward_map  = $forward_map;
        $this->reverse_map  = $reverse_map;
    }

    // ── Public entry ──────────────────────────────────────────────────────────

    public function transliterate(string $input, string $direction, array $snippets = []): array {
        $log = [];
        if ($direction === 'forward') {
            [$output, $log] = $this->forward($input, $snippets);
        } elseif ($direction === 'reverse') {
            [$output, $log] = $this->reverse($input, $snippets);
        } else {
            $output = $input;
            $log[] = "[ERROR] Unknown direction: {$direction}";
        }
        return ['output' => $output, 'log' => $log];
    }

    // ── Forward ───────────────────────────────────────────────────────────────

    private function forward(string $input, array $snippets): array {
        $log = [];

        // Pre hooks
        $input = $this->run_pre_post_hooks($input, 'forward', 'pre', $snippets, $log);

        $lookup        = $this->flatten_map($this->forward_map, ['special','consonants','matras','independent_vowels','digits','punctuation']);
        $consonant_map = $this->build_section_map($this->forward_map, 'consonants');
        $matra_map     = $this->build_section_map($this->forward_map, 'matras');
        $iv_map        = $this->build_section_map($this->forward_map, 'independent_vowels');

        uksort($consonant_map, function($a,$b){ return mb_strlen($b) - mb_strlen($a); });
        uksort($matra_map,     function($a,$b){ return mb_strlen($b) - mb_strlen($a); });
        uksort($iv_map,        function($a,$b){ return mb_strlen($b) - mb_strlen($a); });

        $sorted_cons   = array_keys($consonant_map);
        $sorted_matras = array_keys($matra_map);
        $sorted_iv     = array_keys($iv_map);

        $config = [
            'map'            => $this->forward_map,
            'direction'      => 'forward',
            'virama'         => $this->virama,
            'inherent_vowel' => $this->inherent_vowel,
            'hardcode_independent_vowel' => true,
            'hardcode_explicit_zwnj'     => true,
            'hardcode_consonant_matra'   => true,
            'hardcode_consonant_cluster' => true,
        ];

        $state = [
            'input'              => $input,
            'output'             => '',
            'pos'                => 0,
            'prev_was_consonant' => false,
            'prev'               => ['token'=>'','was_consonant'=>false,'was_matra'=>false,'token_length'=>0],
            'handled'            => false,
        ];

        $len = mb_strlen($input);
        $loop_snippets = $this->filter_snippets($snippets, 'forward', 'loop');

        while ($state['pos'] < $len) {
            $state['handled'] = false;
            $pos = $state['pos'];

            // 1. Independent vowel at word start
            if (!$state['handled'] && ($config['hardcode_independent_vowel'] ?? true)) {
                $at_start = ($pos === 0) || !ctype_alpha(mb_substr($input, $pos-1, 1));
                if ($at_start) {
                    $consumed = mb_substr($input, 0, $pos);
                    $prev_ends_vowel = false;
                    foreach ($sorted_iv as $vk) {
                        if ($this->str_ends_with($consumed, $vk)) { $prev_ends_vowel = true; break; }
                    }
                    if (!$prev_ends_vowel) {
                        $iv_match = null;
                        foreach ($sorted_iv as $vk) {
                            if (mb_substr($input, $pos, mb_strlen($vk)) === $vk) { $iv_match = $vk; break; }
                        }
                        if ($iv_match !== null) {
                            $state['output'] .= $iv_map[$iv_match];
                            $state['pos'] += mb_strlen($iv_match);
                            $state['prev_was_consonant'] = false;
                            $state['handled'] = true;
                            $log[] = "[FWD IND VOWEL] {$iv_match} → {$iv_map[$iv_match]}";
                        }
                    }
                }
            }

            // 2. Explicit ZWNJ (apostrophe)
            if (!$state['handled'] && ($config['hardcode_explicit_zwnj'] ?? true)) {
                if (mb_substr($input, $state['pos'], 1) === "'") {
                    $state['output'] .= $this->zwnj;
                    $state['pos'] += 1;
                    $state['handled'] = true;
                    $log[] = '[ZWNJ] explicit ZWNJ at pos ' . $state['pos'];
                }
            }

            // 3. Consonant + matra
            if (!$state['handled'] && ($config['hardcode_consonant_matra'] ?? true)) {
                $c_match = null;
                foreach ($sorted_cons as $ck) {
                    if (mb_substr($input, $state['pos'], mb_strlen($ck)) === $ck) { $c_match = $ck; break; }
                }
                if ($c_match !== null) {
                    $next_pos    = $state['pos'] + mb_strlen($c_match);
                    $matra_match = null;
                    foreach ($sorted_matras as $mk) {
                        if (mb_substr($input, $next_pos, mb_strlen($mk)) === $mk) { $matra_match = $mk; break; }
                    }
                    if ($matra_match !== null) {
                        $bpm         = $consonant_map[$c_match];
                        $after_matra = $next_pos + mb_strlen($matra_match);
                        if ($matra_match === 'o') {
                            $char_after = mb_substr($input, $after_matra, 1);
                            $at_end = ($char_after === '') || !ctype_alpha($char_after);
                            $state['output'] .= $at_end ? $bpm . $this->zwnj : $bpm;
                            $state['pos'] = $after_matra;
                        } elseif ($matra_match === "'") {
                            $state['output'] .= $bpm . $this->zwnj;
                            $state['pos'] = $after_matra;
                        } elseif ($matra_match === 'y' || $matra_match === 'Y') {
                            $y_value = isset($matra_map[$matra_match]) ? $matra_map[$matra_match] : '';
                            $second_matra = null;
                            foreach ($sorted_matras as $mk2) {
                                if (mb_substr($input, $after_matra, mb_strlen($mk2)) === $mk2) { $second_matra = $mk2; break; }
                            }
                            if ($second_matra !== null) {
                                if ($second_matra === 'o') {
                                    $ca2 = mb_substr($input, $after_matra + mb_strlen($second_matra), 1);
                                    $ae2 = ($ca2 === '') || !ctype_alpha($ca2);
                                    $state['output'] .= $bpm . $y_value . ($ae2 ? $this->zwnj : '');
                                } else {
                                    $state['output'] .= $bpm . $y_value . (isset($matra_map[$second_matra]) ? $matra_map[$second_matra] : '');
                                }
                                $state['pos'] = $after_matra + mb_strlen($second_matra);
                            } else {
                                $state['output'] .= $bpm . $y_value;
                                $state['pos'] = $after_matra;
                            }
                        } else {
                            $state['output'] .= $bpm . (isset($matra_map[$matra_match]) ? $matra_map[$matra_match] : '');
                            $state['pos'] = $after_matra;
                        }
                        $state['prev_was_consonant'] = true;
                        $state['prev']['was_consonant'] = true;
                        $state['handled'] = true;
                        $log[] = "[FWD CONS+MATRA] {$c_match} + {$matra_match}";
                    }
                }
            }

            // 4. Consonant cluster + halanta
            if (!$state['handled'] && ($config['hardcode_consonant_cluster'] ?? true)) {
                $c_match = null;
                foreach ($sorted_cons as $ck) {
                    if (mb_substr($input, $state['pos'], mb_strlen($ck)) === $ck) { $c_match = $ck; break; }
                }
                if ($c_match !== null) {
                    $next_pos    = $state['pos'] + mb_strlen($c_match);
                    $matra_match = null;
                    foreach ($sorted_matras as $mk) {
                        if (mb_substr($input, $next_pos, mb_strlen($mk)) === $mk) { $matra_match = $mk; break; }
                    }
                    if ($matra_match === null) {
                        $bpm = $consonant_map[$c_match];
                        $is_non_linking = in_array($c_match, $this->non_linking_consonants, true);
                        $next_cons = null;
                        foreach ($sorted_cons as $ck2) {
                            if (mb_substr($input, $next_pos, mb_strlen($ck2)) === $ck2) { $next_cons = $ck2; break; }
                        }
                        if ($next_cons !== null && !$is_non_linking) {
                            if ($c_match === 'r' && mb_substr($input, $next_pos, 1) === 'r') {
                                $state['output'] .= $bpm . $this->virama;
                            } elseif ($c_match === 'r') {
                                $state['output'] .= $bpm . $this->virama . $this->zwj;
                            } else {
                                $state['output'] .= $bpm . $this->virama;
                            }
                            $log[] = "[FWD CLUSTER] {$c_match}+HALANTA";
                        } else {
                            $state['output'] .= $bpm;
                            $log[] = "[FWD CLUSTER] {$c_match} bare";
                        }
                        $state['pos'] = $next_pos;
                        $state['prev_was_consonant'] = true;
                        $state['prev']['was_consonant'] = true;
                        $state['handled'] = true;
                    }
                }
            }

            if ($state['handled']) { $state['handled'] = false; continue; }

            // 5. Loop snippet hooks
            foreach ($loop_snippets as $snippet) {
                $body = isset($snippet['php_body']) ? $snippet['php_body'] : '';
                if ($body === '') continue;
                $decoded = json_decode($body, true);
                if (is_array($decoded)) {
                    $this->apply_loop_rules($state, $decoded, $config, $log);
                }
                if ($state['handled']) break;
            }

            if ($state['handled']) { $state['handled'] = false; continue; }

            // 6. Core map lookup
            $matched = false;
            foreach ($lookup as $roman => $bpm) {
                $chunk_len = mb_strlen($roman);
                if ($state['pos'] + $chunk_len > $len) continue;
                if (mb_substr($input, $state['pos'], $chunk_len) === $roman) {
                    $state['output'] .= $bpm;
                    $log[] = "[MATCH] '{$roman}' → '{$bpm}' (pos {$state['pos']})";
                    $state['pos'] += $chunk_len;
                    $state['prev_was_consonant'] = false;
                    $matched = true;
                    break;
                }
            }
            if (!$matched) {
                $char = mb_substr($input, $state['pos'], 1);
                $state['output'] .= $char;
                $log[] = "[PASS] '{$char}' (pos {$state['pos']})";
                $state['pos']++;
                $state['prev_was_consonant'] = false;
            }
        }

        $output = $state['output'];
        $output = $this->run_pre_post_hooks($output, 'forward', 'post', $snippets, $log);
        return [$output, $log];
    }

    // ── Reverse ───────────────────────────────────────────────────────────────

    private function reverse(string $input, array $snippets): array {
        $log = [];

        if (function_exists('normalizer_normalize')) {
            $input = normalizer_normalize($input, Normalizer::NFC);
        }

        $input = $this->run_pre_post_hooks($input, 'reverse', 'pre', $snippets, $log);

        $lookup        = $this->flatten_map($this->reverse_map, ['special','consonants','matras','independent_vowels','digits','punctuation']);
        $consonant_bpm = array_keys($this->build_section_map($this->reverse_map, 'consonants'));
        $matra_keys    = array_keys($this->build_section_map($this->reverse_map, 'matras'));

        $config = [
            'map'            => $this->reverse_map,
            'direction'      => 'reverse',
            'virama'         => $this->virama,
            'inherent_vowel' => $this->inherent_vowel,
        ];

        $chars = preg_split('//u', $input, -1, PREG_SPLIT_NO_EMPTY);
        if ($chars === false) $chars = [];
        $total = count($chars);

        $state = [
            'input'              => $input,
            'output'             => '',
            'pos'                => 0,
            'prev_was_consonant' => false,
            'prev'               => ['token'=>'','was_consonant'=>false,'was_matra'=>false,'token_length'=>0],
            'handled'            => false,
        ];

        $loop_snippets = $this->filter_snippets($snippets, 'reverse', 'loop');

        while ($state['pos'] < $total) {
            $state['handled'] = false;

            foreach ($loop_snippets as $snippet) {
                $body = isset($snippet['php_body']) ? $snippet['php_body'] : '';
                if ($body === '') continue;
                $decoded = json_decode($body, true);
                if (is_array($decoded)) {
                    $this->apply_loop_rules($state, $decoded, $config, $log);
                }
                if ($state['handled']) break;
            }

            if ($state['handled']) { $state['handled'] = false; continue; }

            $matched = false;
            foreach ($lookup as $bpm => $roman) {
                $bpm_len = mb_strlen($bpm);
                $slice = implode('', array_slice($chars, $state['pos'], $bpm_len));
                if ($slice === $bpm) {
                    $is_consonant = in_array($bpm, $consonant_bpm, true);
                    $state['output'] .= $roman;
                    if ($is_consonant) {
                        $next_char = isset($chars[$state['pos'] + $bpm_len]) ? $chars[$state['pos'] + $bpm_len] : '';
                        $is_matra  = in_array($next_char, $matra_keys, true);
                        $is_virama = ($next_char === $this->virama);
                        if (!$is_matra && !$is_virama) {
                            $state['output'] .= $this->inherent_vowel;
                            $log[] = "[INHERENT] after '{$bpm}'";
                        }
                    }
                    $log[] = "[MATCH] '{$bpm}' → '{$roman}' (pos {$state['pos']})";
                    $state['pos'] += $bpm_len;
                    $state['prev_was_consonant'] = $is_consonant;
                    $matched = true;
                    break;
                }
            }

            if (!$matched) {
                $state['output'] .= $chars[$state['pos']];
                $log[] = "[PASS] '{$chars[$state['pos']]}' (pos {$state['pos']})";
                $state['pos']++;
                $state['prev_was_consonant'] = false;
            }
        }

        $output = $state['output'];
        $output = $this->run_pre_post_hooks($output, 'reverse', 'post', $snippets, $log);
        return [$output, $log];
    }

    // ── Hook runners ──────────────────────────────────────────────────────────

    private function run_pre_post_hooks(string $text, string $direction, string $stage, array $snippets, array &$log): string {
        $active = $this->filter_snippets($snippets, $direction, $stage);
        foreach ($active as $snippet) {
            $body = isset($snippet['php_body']) ? (string)$snippet['php_body'] : '';
            if ($body === '') continue;
            $decoded = json_decode($body, true);
            if (is_array($decoded)) {
                $text = $this->apply_processing_rules($text, $decoded, $log);
            }
        }
        return $text;
    }

    private function apply_processing_rules(string $text, array $rules, array &$log): string {
        foreach ($rules as $rule) {
            if (!is_array($rule)) continue;
            $type  = isset($rule['type'])  ? $rule['type']  : 'replace';
            $from  = isset($rule['from'])  ? $rule['from']  : '';
            $to    = isset($rule['to'])    ? $rule['to']    : '';
            $regex = !empty($rule['regex']);
            if ($from === '' || $type !== 'replace') continue;
            if ($regex) {
                $result = @preg_replace($from, $to, $text);
                if ($result !== null && $result !== $text) {
                    $log[] = "[PRE/POST] regex '{$from}' → '{$to}'";
                    $text = $result;
                }
            } else {
                if (mb_strpos($text, $from) !== false) {
                    $log[] = "[PRE/POST] replace '{$from}' → '{$to}'";
                    $text = str_replace($from, $to, $text);
                }
            }
        }
        return $text;
    }

    private function apply_loop_rules(array &$state, array $rules, array $config, array &$log): void {
        $map = isset($config['map']) ? $config['map'] : [];
        foreach ($rules as $rule) {
            if (!is_array($rule)) continue;
            $type  = isset($rule['type'])  ? $rule['type']  : 'replace';
            $from  = isset($rule['from'])  ? $rule['from']  : '';
            $to    = isset($rule['to'])    ? $rule['to']    : '';
            $regex = !empty($rule['regex']);
            if ($from === '' || $type !== 'replace') continue;

            if (isset($rule['context_output_ends_with'])) {
                if (!$this->str_ends_with($state['output'], (string)$rule['context_output_ends_with'])) continue;
            }
            if (isset($rule['context_prev_was_consonant'])) {
                if ((bool)$state['prev_was_consonant'] !== (bool)$rule['context_prev_was_consonant']) continue;
            }
            if (isset($rule['context_next_token_in'])) {
                $section      = (string)$rule['context_next_token_in'];
                $remaining    = mb_substr($state['input'], $state['pos']);
                $section_keys = array_keys($this->build_section_map($map, $section));
                usort($section_keys, function($a,$b){ return mb_strlen($b) - mb_strlen($a); });
                $token_found = false;
                foreach ($section_keys as $key) {
                    if ($this->str_starts_with($remaining, $key)) { $token_found = true; break; }
                }
                if (!$token_found) continue;
            }

            if ($regex) {
                $result = @preg_replace($from, $to, $state['output']);
                if ($result !== null && $result !== $state['output']) {
                    $state['output']  = $result;
                    $state['handled'] = true;
                    $log[] = "[LOOP] regex '{$from}' → '{$to}' pos {$state['pos']}";
                }
            } else {
                if ($this->str_ends_with($state['output'], $from)) {
                    $state['output']  = mb_substr($state['output'], 0, mb_strlen($state['output']) - mb_strlen($from)) . $to;
                    $state['handled'] = true;
                    $log[] = "[LOOP] tail-replace '{$from}' → '{$to}' pos {$state['pos']}";
                } elseif (mb_strpos($state['output'], $from) !== false) {
                    $state['output']  = str_replace($from, $to, $state['output']);
                    $state['handled'] = true;
                    $log[] = "[LOOP] replace '{$from}' → '{$to}' pos {$state['pos']}";
                }
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function flatten_map(array $map, array $sections): array {
        $items = [];
        $pos   = 0;
        foreach ($sections as $section) {
            $raw = isset($map[$section]) ? $map[$section] : [];
            if (!is_array($raw) || empty($raw)) continue;
            if ($this->is_pairs($raw)) {
                foreach ($raw as $pair) {
                    if (is_array($pair) && isset($pair[0], $pair[1]) && $pair[0] !== '_meta') {
                        $items[] = [(string)$pair[0], (string)$pair[1], $pos++];
                    }
                }
            } else {
                foreach ($raw as $k => $v) {
                    if ($k !== '_meta') $items[] = [(string)$k, (string)$v, $pos++];
                }
            }
        }
        usort($items, function($a,$b){ $d = mb_strlen($b[0]) - mb_strlen($a[0]); return $d !== 0 ? $d : $a[2] - $b[2]; });
        $flat = [];
        foreach ($items as $item) {
            $k = $item[0]; $v = $item[1];
            if (!array_key_exists($k, $flat)) $flat[$k] = $v;
        }
        return $flat;
    }

    private function build_section_map(array $map, string $section): array {
        $raw = isset($map[$section]) ? $map[$section] : [];
        $out = [];
        if (!is_array($raw)) return $out;
        if ($this->is_pairs($raw)) {
            foreach ($raw as $pair) {
                if (is_array($pair) && isset($pair[0], $pair[1])) {
                    $out[(string)$pair[0]] = (string)$pair[1];
                }
            }
        } else {
            foreach ($raw as $k => $v) $out[(string)$k] = (string)$v;
        }
        return $out;
    }

    private function is_pairs(array $arr): bool {
        if (!$this->php_is_list($arr)) return false;
        foreach ($arr as $item) {
            if ($item === null) continue;
            return is_array($item) && $this->php_is_list($item) && count($item) >= 2;
        }
        return false;
    }

    private function php_is_list(array $arr): bool {
        if (function_exists('array_is_list')) return array_is_list($arr);
        if (empty($arr)) return true;
        return array_keys($arr) === range(0, count($arr) - 1);
    }

    private function str_ends_with(string $haystack, string $needle): bool {
        if (function_exists('str_ends_with')) return str_ends_with($haystack, $needle);
        if ($needle === '') return true;
        $len = mb_strlen($needle);
        return mb_substr($haystack, -$len) === $needle;
    }

    private function str_starts_with(string $haystack, string $needle): bool {
        if (function_exists('str_starts_with')) return str_starts_with($haystack, $needle);
        return mb_substr($haystack, 0, mb_strlen($needle)) === $needle;
    }

    private function filter_snippets(array $snippets, string $direction, string $stage): array {
        $result = [];
        foreach ($snippets as $s) {
            $s_stage = isset($s['hook_stage']) ? $s['hook_stage'] : '';
            $s_dir   = isset($s['direction'])  ? $s['direction']  : '';
            $active  = !empty($s['is_active']);
            if ($s_stage === $stage && ($s_dir === $direction || $s_dir === 'both') && $active) {
                $result[] = $s;
            }
        }
        return $result;
    }
}
