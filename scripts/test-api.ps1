$ErrorActionPreference = 'Continue'
$B = 'http://127.0.0.1:3000'
$pass = 0; $fail = 0; $out = @()

function Check($name, $actual, $expect) {
  if ($actual -eq $expect) { $script:pass++; $script:out += "  PASS | $name | $actual" }
  else { $script:fail++; $script:out += "  FAIL | $name | dapat=$actual harap=$expect" }
}

function Json($raw) {
  try { return $raw | ConvertFrom-Json } catch { return $null }
}

Write-Output '=== 1. HEALTH & INDEX ==='
$h = curl.exe -s -o - -w '|%{http_code}' "$B/api/health"
Check "GET /api/health" ($h -split '\|')[-1] '200'
Check "health.status" (Json ($h -split '\|')[0]).status 'ok'

$idx = curl.exe -s -o - -w '|%{http_code}' "$B/"
Check "GET / (index.html)" ($idx -split '\|')[-1] '200'
$sw = curl.exe -s -o - -w '|%{http_code}' "$B/sw.js"
Check "GET /sw.js" ($sw -split '\|')[-1] '200'
$mf = curl.exe -s -o - -w '|%{http_code}' "$B/manifest.json"
Check "GET /manifest.json" ($mf -split '\|')[-1] '200'
$css = curl.exe -s -o - -w '|%{http_code}' "$B/css/styles.css"
Check "GET /css/styles.css" ($css -split '\|')[-1] '200'

Write-Output '=== 2. AUTH: SALAH & BENAR ==='
$bad = curl.exe -s -o - -w '|%{http_code}' -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"pin":"0000"}'
Check "login PIN salah -> 401" ($bad -split '\|')[-1] '401'
Check "login salah pesan" (Json ($bad -split '\|')[0]).error.code 'UNAUTHORIZED'

$bad2 = curl.exe -s -o - -w '|%{http_code}' -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"pin":""}'
Check "login PIN kosong -> 400" ($bad2 -split '\|')[-1] '400'

$ok = curl.exe -s -c cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"pin":"1234"}'
Check "login PIN benar -> 200" ($ok -split '\|')[-1] '200'
Check "login return authenticated=true" (Json ($ok -split '\|')[0]).authenticated 'True'
Check "cookie session tersimpan" ((Test-Path 'cookies.txt') -and ((Get-Content 'cookies.txt') -join ' ' -match 'cf_session')) 'True'

$ses = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' "$B/api/auth/session"
Check "GET /api/auth/session (dengan cookie) -> 200" ($ses -split '\|')[-1] '200'

Write-Output '=== 3. AUTH: TANPA SESI DITOLAK ==='
$n1 = curl.exe -s -o - -w '|%{http_code}' "$B/api/courses"
Check "GET /api/courses tanpa cookie -> 401" ($n1 -split '\|')[-1] '401'
$n2 = curl.exe -s -o - -w '|%{http_code}' "$B/api/tasks"
Check "GET /api/tasks tanpa cookie -> 401" ($n2 -split '\|')[-1] '401'
$n3 = curl.exe -s -o -w '|%{http_code}' -X DELETE "$B/api/tasks/1"
Check "DELETE /api/tasks/1 tanpa cookie -> 401" ($n3) '401'
$n4 = curl.exe -s -b cookies.txt -H 'Authorization: Bearer tokengalaks' -o - -w '|%{http_code}' "$B/api/activities"
Check "Bearer token salah -> 401" ($n4 -split '\|')[-1] '401'

Write-Output '=== 4. COURSES CRUD ==='
$c1 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/courses" -H 'Content-Type: application/json' -d '{"nama":"Basis Data","dosen":"Dr. Budi","sks":3,"hari":"Senin","jam_mulai":"08:00","jam_selesai":"10:00","warna":"#6366f1"}'
Check "POST /api/courses -> 201" ($c1 -split '\|')[-1] '201'
$cid = (Json ($c1 -split '\|')[0]).course.id
Check "course.id ada" ([bool]$cid) 'True'
Check "course.nama" (Json ($c1 -split '\|')[0]).course.nama 'Basis Data'

$c2 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/courses" -H 'Content-Type: application/json' -d '{"nama":""}'
Check "POST course nama kosong -> 400" ($c2 -split '\|')[-1] '400'

$c3 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/courses" -H 'Content-Type: application/json' -d '{"nama":"AI","warna":"#123456"}'
Check "warna di luar palet -> 400" ($c3 -split '\|')[-1] '400'

$c4 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X PATCH "$B/api/courses/$cid" -H 'Content-Type: application/json' -d '{"sks":4}'
Check "PATCH course -> 200" ($c4 -split '\|')[-1] '200'
Check "PATCH terapkan sks" (Json ($c4 -split '\|')[0]).course.sks '4'

$c5 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' "$B/api/courses"
Check "GET /api/courses -> 200" ($c5 -split '\|')[-1] '200'
Check "jumlah courses >= 1" (((Json ($c5 -split '\|')[0]).courses).Count -ge 1) 'True'

$c6 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/courses" -H 'Content-Type: application/json' -d '{"nama":"Coba","warna":"#6366f1","jahat":1}'
Check "field tak dikenal -> 400" ($c6 -split '\|')[-1] '400'

Write-Output '=== 5. TASKS CRUD + VALIDASI ==='
$dl = (Get-Date).AddHours(20).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.000Z')
$t1 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/tasks" -H 'Content-Type: application/json' -d "{`"course_id`":$cid,`"judul`":`"Esai Struktur Data`",`"deadline`":`"$dl`",`"prioritas`":`"tinggi`",`"deskripsi`":`"_Bab_1_ dan [tautan]`"}"
Check "POST /api/tasks -> 201" ($t1 -split '\|')[-1] '201'
$tid = (Json ($t1 -split '\|')[0]).task.id
Check "task.created default status todo" (Json ($t1 -split '\|')[0]).task.status 'todo'
Check "task.notify_stage=0" (Json ($t1 -split '\|')[0]).task.notify_stage '0'
Check "task.deadline disimpan UTC (Z)" ((Json ($t1 -split '\|')[0]).task.deadline -match 'Z$') 'True'

$t2 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/tasks" -H 'Content-Type: application/json' -d "{`"course_id`":$cid,`"judul`":`"x`",`"deadline`":`"bukan-tanggal`"}"
Check "deadline rusak -> 400" ($t2 -split '\|')[-1] '400'

$t3 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/tasks" -H 'Content-Type: application/json' -d "{`"course_id`":99999,`"judul`":`"x`",`"deadline`":`"$dl`"}"
Check "course_id tak ada -> 400" ($t3 -split '\|')[-1] '400'

$t4 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/tasks" -H 'Content-Type: application/json' -d "{`"course_id`":$cid,`"judul`":`"x`",`"deadline`":`"$dl`",`"prioritas`":`"gila`"}"
Check "prioritas di luar enum -> 400" ($t4 -split '\|')[-1] '400'

$t5 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X PATCH "$B/api/tasks/$tid" -H 'Content-Type: application/json' -d '{"status":"progress"}'
Check "PATCH status -> 200" ($t5 -split '\|')[-1] '200'
Check "PATCH status terapkan" (Json ($t5 -split '\|')[0]).task.status 'progress'

$t6 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/tasks/$tid/status" -H 'Content-Type: application/json' -d '{"status":"selesai"}'
Check "POST status selesai -> 200" ($t6 -split '\|')[-1] '200'
Check "completed_at terisi" ([bool](Json ($t6 -split '\|')[0]).task.completed_at) 'True'

$t7 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X PATCH "$B/api/tasks/$tid" -H 'Content-Type: application/json' -d "{`"deadline`":`"$( (Get-Date).AddHours(40).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.000Z') )`"}"
Check "ubah deadline -> 200" ($t7 -split '\|')[-1] '200'
Check "ubah deadline reset notify_stage=0" (Json ($t7 -split '\|')[0]).task.notify_stage '0'

$t8 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' "$B/api/tasks?open=1"
Check "GET tasks?open=1 -> 200" ($t8 -split '\|')[-1] '200'
$t9 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' "$B/api/tasks?status=invalid"
Check "tasks?status=invalid -> 400" ($t9 -split '\|')[-1] '400'
$t10 = curl.exe -s -b cookies.txt -o -w '|%{http_code}' "$B/api/tasks/99999"
Check "GET task id tak ada -> 404" ($t10) '404'

Write-Output '=== 6. ACTIVITIES CRUD ==='
$adate = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.000Z')
$a1 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/activities" -H 'Content-Type: application/json' -d "{`"nama`":`"Bimbingan skripsi`",`"tanggal`":`"$adate`",`"kategori`":`"Kuliah`",`"lokasi`":`"Ruang 302`"}"
Check "POST /api/activities -> 201" ($a1 -split '\|')[-1] '201'
$aid = (Json ($a1 -split '\|')[0]).activity.id
Check "activity.selesai default false" (Json ($a1 -split '\|')[0]).activity.selesai 'False'

$a2 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/activities/$aid/toggle"
Check "POST toggle -> 200" ($a2 -split '\|')[-1] '200'
Check "toggle jadi selesai=true" (Json ($a2 -split '\|')[0]).activity.selesai 'True'

$a3 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X PATCH "$B/api/activities/$aid" -H 'Content-Type: application/json' -d '{"lokasi":"Ruang 401"}'
Check "PATCH activity -> 200" ($a3 -split '\|')[-1] '200'
$a4 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' "$B/api/activities?done=true"
Check "GET activities?done=true -> 200" ($a4 -split '\|')[-1] '200'
Check "filter done berisi 1" ((Json ($a4 -split '\|')[0]).activities.Count -ge 1) 'True'

Write-Output '=== 7. DASHBOARD & PENGATURAN ==='
$d1 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' "$B/api/dashboard/summary"
Check "GET /api/dashboard/summary -> 200" ($d1 -split '\|')[-1] '200'
$sum = Json ($d1 -split '\|')[0]
Check "summary.stats ada" ([bool]$sum.stats) 'True'
Check "summary.stats.openTotal >= 0" ($sum.stats.openTotal -ge 0) 'True'
Check "summary.timezone Asia/Jakarta" $sum.timezone 'Asia/Jakarta'

$s1 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' "$B/api/settings/public"
Check "GET /api/settings/public -> 200" ($s1 -split '\|')[-1] '200'
Check "telegram.configured false (tanpa token)" (Json ($s1 -split '\|')[0]).telegram.configured 'False'
Check "notify threshold H-24,3,1" ((Json ($s1 -split '\|')[0]).notify.thresholdsHours -join ',') '24,3,1'

$s2 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/settings/telegram/link"
Check "POST telegram/link tanpa token -> 400" ($s2 -split '\|')[-1] '400'

$s3 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' "$B/api/scheduler"
Check "GET /api/scheduler -> 200" ($s3 -split '\|')[-1] '200'
Check "scheduler aktif (stopped=False)" (Json ($s3 -split '\|')[0]).scheduler.stopped 'False'

Write-Output '=== 8. NOTIF & KEAMANAN ==='
$n5 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/notify/test"
Check "POST /api/notify/test tanpa token -> 502" ($n5 -split '\|')[-1] '502'
Check "pesan upstream dijelaskan" ((Json ($n5 -split '\|')[0]).error.code) 'UPSTREAM_ERROR'

$n6 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/notify/run"
Check "POST /api/notify/run -> 200" ($n6 -split '\|')[-1] '200'
Check "summary.checked terbaca" ([bool](Json ($n6 -split '\|')[0]).summary) 'True'

$e1 = curl.exe -s -o - -D headers.txt -w '|%{http_code}' "$B/api/health"
$csp = ((Get-Content headers.txt -Raw) -match "Content-Security-Policy")
Check "header CSP ada" $csp 'True'
Check "nosniff ada" ((Get-Content headers.txt -Raw) -match 'X-Content-Type-Options: nosniff') 'True'
Check "X-Frame-Options DENY" ((Get-Content headers.txt -Raw) -match 'X-Frame-Options: DENY') 'True'

$j = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/tasks" -H 'Content-Type: application/json' -d '{rusak'
Check "JSON rusak -> 400 BAD_JSON" ($j -split '\|')[-1] '400'

$u = curl.exe -s -o -w '|%{http_code}' "$B/api/tidak-ada-endpoint"
Check "endpoint tak dikenal -> 404" ($u) '404'

Write-Output '=== 9. XSS TERSIMPAN DITOLKAN ==='
$xi = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/tasks" -H 'Content-Type: application/json' -d "{`"course_id`":$cid,`"judul`":`"\<img src=x onerror=alert(1)\>`",`"deadline`":`"$dl`"}"
Check "judul berisi <img onerror> -> 201 (disimpan, bukan dieksekusi)" ($xi -split '\|')[-1] '201'
$xc = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/tasks" -H 'Content-Type: application/json' -d "{`"course_id`":$cid,`"judul`":`"x\u0000y`",`"deadline`":`"$dl`"}"
Check "NUL byte di judul -> 400" ($xc -split '\|')[-1] '400'

Write-Output '=== 10. DELETE CASCADE & LOGOUT ==='
$x1 = curl.exe -s -b cookies.txt -o -w '|%{http_code}' -X DELETE "$B/api/courses/$cid"
Check "DELETE course -> 204" ($x1) '204'
Start-Sleep -Milliseconds 300
$x2 = curl.exe -s -b cookies.txt -o -w '|%{http_code}' -X DELETE "$B/api/tasks/$tid"
Check "task ikut terhapus (cascade) -> 404" ($x2) '404'
$x3 = curl.exe -s -b cookies.txt -o -w '|%{http_code}' -X DELETE "$B/api/activities/$aid"
Check "DELETE activity -> 204" ($x3) '204'
$x4 = curl.exe -s -b cookies.txt -o -w '|%{http_code}' -X DELETE "$B/api/tasks/$tid"
Check "DELETE task tak ada -> 404" ($x4) '404'

$x5 = curl.exe -s -b cookies.txt -o - -w '|%{http_code}' -X POST "$B/api/auth/logout"
Check "POST logout -> 204" ($x5 -split '\|')[-1] '204'
$x6 = curl.exe -s -b cookies.txt -o -w '|%{http_code}' "$B/api/courses"
Check "sesi logout -> 401" ($x6) '401'

Write-Output ''
Write-Output "=========================================="
Write-Output "  TOTAL: $($pass + $fail) | LULUS: $pass | GAGAL: $fail"
Write-Output "=========================================="
$out | ForEach-Object { Write-Output $_ }
if ($fail -gt 0) { exit 1 } else { exit 0 }
