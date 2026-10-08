# protocol-check.ps1: enforces PROTOCOL.md (nothing made up, no personal data). Run from the repo root.
$ErrorActionPreference = 'Stop'
$fail = @()
$files = git ls-files --cached --others --exclude-standard | Where-Object { $_ -and (Test-Path $_) }

# 1. No fixture / mock / sample / preview-harness files.
$fail += $files | Where-Object { $_ -match '(?i)(fixture|mock|sample|seed|demo|fake|preview)' -and $_ -notmatch '^scripts/protocol-check\.ps1$' } | ForEach-Object { "made-up-data file: $_" }

# 2. No images outside icons/ (screenshots must not be committed).
$fail += $files | Where-Object { $_ -match '\.(png|jpe?g|gif|webp)$' -and $_ -notmatch '^icons/' } | ForEach-Object { "image outside icons/: $_" }

# 3. Personal-data patterns: real grades, names, section ids and course codes from the owner's own session.
#    Each pattern describes a FORMAT; none of them is an invented example.
$patterns = @(
  '(?i)\bcooper\b', '(?i)\bporter\b',
  '\b\d{4}_(FALL|SPRING|SUMMER|WINTER)_[A-Z]{2,5}_\d{4,5}_SEC\w+\b',   # full UARK section ids
  '\b[A-Z]{2,5} \d{5}-\d{3}\b',                                         # section codes like SUBJ NNNNN-NNN
  '"\d{1,3}\.\d{2}\s?%"',                                               # quoted two-decimal percents in comments
  '(?i)earned \d+(\.\d+)? out of \d+'                                   # quoted point totals
)
$text = $files | Where-Object { $_ -match '\.(js|md|html|css|json|txt)$' -and $_ -notmatch '^scripts/' }
foreach ($f in $text) {
  $n = 0
  foreach ($line in Get-Content $f) {
    $n++
    foreach ($p in $patterns) { if ($line -match $p) { $fail += "personal data? ${f}:${n}: $($Matches[0])" } }
  }
}

if ($fail.Count) { $fail | ForEach-Object { Write-Host "FAIL  $_" }; Write-Host "PROTOCOL FAILED ($($fail.Count))"; exit 1 }
Write-Host 'PROTOCOL OK'
