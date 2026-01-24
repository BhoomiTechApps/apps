<?php
header('Content-Type: application/json');

$q = $_GET['q'] ?? '';
if (!$q) {
    echo json_encode([]);
    exit;
}

$url = "https://nominatim.openstreetmap.org/search?format=json&q=" . urlencode($q);

$options = [
    "http" => [
        "header" => "User-Agent: MyMapApp/1.0 (bmsahitya.assam@gmail.com)\r\n"
    ],
    "ssl" => [
        "verify_peer" => false,
        "verify_peer_name" => false
    ]
];

$context = stream_context_create($options);
$result = file_get_contents($url, false, $context);

echo $result;
