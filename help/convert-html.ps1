<#
.SYNOPSIS
    Converts CuraFlow help HTML files to CHM-compatible format (ASCII + entities).

.DESCRIPTION
    The Windows CHM viewer uses an old IE engine. To be bulletproof:
    - All text is converted to pure ASCII using HTML entities for umlauts
    - Doctype is HTML 4.01 Transitional
    - Content-Type charset is set to iso-8859-1 (ASCII-compatible)
#>
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$charMap = @{
    [char]0x00E4 = '&auml;'   # ä
    [char]0x00F6 = '&ouml;'   # ö
    [char]0x00FC = '&uuml;'   # ü
    [char]0x00DF = '&szlig;'  # ß
    [char]0x00C4 = '&Auml;'   # Ä
    [char]0x00D6 = '&Ouml;'   # Ö
    [char]0x00DC = '&Uuml;'   # Ü
    [char]0x2013 = '&ndash;'  # –
    [char]0x2014 = '&mdash;'  # —
    [char]0x2018 = '&lsquo;'  # '
    [char]0x2019 = '&rsquo;'  # '
    [char]0x201C = '&ldquo;'  # "
    [char]0x201D = '&rdquo;'  # "
    [char]0x2026 = '&hellip;' # …
    [char]0x00B7 = '&middot;' # ·
    [char]0x00E9 = '&eacute;' # é
    [char]0x20AC = '&euro;'   # €
    [char]0x00D7 = '&times;'  # ×
    [char]0x2192 = '&rarr;'   # →
    [char]0x2265 = '&ge;'     # ≥
    [char]0x2264 = '&le;'     # ≤
}

$htmlFiles = Get-ChildItem -Path $scriptDir -Filter "*.html" -File
foreach ($file in $htmlFiles) {
    $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
    foreach ($k in $charMap.Keys) {
        $text = $text.Replace([string]$k, [string]$charMap[$k])
    }
    $remaining = $text.ToCharArray() | Where-Object { [int]$_ -gt 127 } | Select-Object -Unique
    if ($remaining) {
        $chars = ($remaining | ForEach-Object { "U+{0:X4}" -f [int]$_ }) -join ", "
        Write-Warning "$($file.Name): remaining non-ASCII chars: $chars"
    }
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '(?i)<meta charset="[^"]*">', '')
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '(?i)<meta http-equiv="Content-Type"[^>]*>', '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">')
    [System.IO.File]::WriteAllText($file.FullName, $text, [System.Text.Encoding]::ASCII)
    Write-Host "Converted: $($file.Name)" -ForegroundColor Green
}
Write-Host "Done." -ForegroundColor Cyan
