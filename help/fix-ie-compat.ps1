<#
.SYNOPSIS
    Makes all CuraFlow help HTML pages compatible with the CHM viewer (IE engine).

.DESCRIPTION
    The Windows CHM viewer (hh.exe) renders pages with an old IE engine.
    Without the correct meta tags, it uses IE7 rendering mode, which breaks
    modern CSS and blocks navigation links. This script inserts the required
    meta tags into all HTML help pages:

    - X-UA-Compatible: forces IE Edge mode
    - Content-Type with charset: correct UTF-8 handling for German umlauts
#>

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$htmlFiles = Get-ChildItem -Path $scriptDir -Filter "*.html" -File

$metaTags = @"
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
"@

$changed = 0

foreach ($file in $htmlFiles) {
    $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8

    $needsUpdate = $false

    # Add X-UA-Compatible if missing
    if ($content -notmatch 'X-UA-Compatible') {
        $content = $content -replace '<head>', "<head>`r`n    $($metaTags.Trim())"
        $needsUpdate = $true
    }

    if ($needsUpdate) {
        [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.UTF8Encoding]::new($false))
        Write-Host "Updated: $($file.Name)" -ForegroundColor Green
        $changed++
    } else {
        Write-Host "Already OK: $($file.Name)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "Done. $changed of $($htmlFiles.Count) files updated." -ForegroundColor Cyan
