<#
.SYNOPSIS
    Fixes all CuraFlow help files for bulletproof CHM viewer (hh.exe) compatibility.

.DESCRIPTION
    The Windows CHM viewer uses an old IE7-based engine that is very picky about:
    1. File encoding  - UTF-8 without BOM is unreliable; pure ASCII is bulletproof.
    2. Window Styles  - the hhc "Window Styles" param must be a NUMBER (0x800025),
       not a string like "NOHSCROLLBAR" (which makes hh.exe render the TOC as raw HTML).
    3. Doctype        - HTML 4.01 Transitional is the safest for the old IE engine.

    This script:
    - Converts all .html help pages to pure ASCII using HTML entities for umlauts
    - Replaces the HTML5 doctype with HTML 4.01 Transitional
    - Removes the X-UA-Compatible meta (unreliable in the CHM host)
    - Rewrites curaflow.hhc / curaflow.hhk in the canonical HTML Help Workshop format
    - Rewrites curaflow.hhp with a correct [WINDOWS] definition and binary TOC
#>

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== CuraFlow CHM Compatibility Fix ===" -ForegroundColor Cyan

# ---------------------------------------------------------------
# Step 1: Convert HTML pages to pure ASCII with HTML entities
# ---------------------------------------------------------------
Write-Host ""
Write-Host "Step 1: Converting HTML pages to ASCII + entities..." -ForegroundColor Yellow

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
}

$htmlFiles = Get-ChildItem -Path $scriptDir -Filter "*.html" -File
$converted = 0

foreach ($file in $htmlFiles) {
    $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)

    # Replace non-ASCII chars with entities
    foreach ($k in $charMap.Keys) {
        $text = $text.Replace([string]$k, [string]$charMap[$k])
    }

    # Detect any remaining non-ASCII characters
    $remaining = $text.ToCharArray() | Where-Object { [int]$_ -gt 127 } | Select-Object -Unique
    if ($remaining) {
        $chars = ($remaining | ForEach-Object { "U+{0:X4}" -f [int]$_ }) -join ", "
        Write-Warning "$($file.Name): remaining non-ASCII chars: $chars"
    }

    # Replace HTML5 doctype with HTML 4.01 Transitional
    $text = $text -replace '<!DOCTYPE html>', '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">'

    # Remove X-UA-Compatible meta (unreliable in CHM host)
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '(?is)\s*<meta http-equiv="X-UA-Compatible"[^>]*>', '')

    # Normalize Content-Type charset to iso-8859-1 (ASCII-compatible)
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '(?is)<meta http-equiv="Content-Type"[^>]*>', '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">')

    # Remove duplicate charset meta
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '(?is)\s*<meta charset="[^"]*">', '')

    # Write as pure ASCII (no BOM)
    [System.IO.File]::WriteAllText($file.FullName, $text, [System.Text.Encoding]::ASCII)
    Write-Host "  Converted: $($file.Name)" -ForegroundColor Green
    $converted++
}

Write-Host "Step 1 done: $converted files converted." -ForegroundColor Green

# ---------------------------------------------------------------
# Step 2: Rewrite curaflow.hhc in canonical HTML Help Workshop format
# ---------------------------------------------------------------
Write-Host ""
Write-Host "Step 2: Rewriting curaflow.hhc (canonical format)..." -ForegroundColor Yellow

# Build hhc content programmatically from a simple definition
$toc = @"
<LI><OBJECT type="text/sitemap">
<param name="Name" value="CuraFlow - Benutzerhandbuch">
<param name="Local" value="index.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Erste Schritte">
<param name="Local" value="getting_started.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Anmeldung">
<param name="Local" value="getting_started.html#anmeldung">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Erste Anmeldung und Passwortänderung">
<param name="Local" value="getting_started.html#erste_anmeldung">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Die Hauptnavigation">
<param name="Local" value="getting_started.html#navigation">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Benutzerprofil und Einstellungen">
<param name="Local" value="getting_started.html#profil">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Rechte und Rollen">
<param name="Local" value="getting_started.html#rollen">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Dienstplan">
<param name="Local" value="schedule.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Ansicht des Dienstplans">
<param name="Local" value="schedule.html#ansicht">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Navigation im Dienstplan">
<param name="Local" value="schedule.html#navigation">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Dienste mit Drag-and-Drop zuweisen">
<param name="Local" value="schedule.html#dragdrop">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Rückgängig und Wiederholen">
<param name="Local" value="schedule.html#undo">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Freitextzellen">
<param name="Local" value="schedule.html#freitext">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Feiertage und Schulferien">
<param name="Local" value="schedule.html#feiertage">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Export des Dienstplans">
<param name="Local" value="schedule.html#export">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Tastaturkürzel">
<param name="Local" value="schedule.html#tastatur">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Erweiterte Dienstplan-Funktionen">
<param name="Local" value="schedule_advanced.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="KI-gestützter Planungsassistent">
<param name="Local" value="schedule_advanced.html#ki">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Timeslots (Zeitbasierte Teilbesetzung)">
<param name="Local" value="schedule_advanced.html#timeslots">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Validierung und Warnungen">
<param name="Local" value="schedule_advanced.html#validierung">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Arbeitsplatzkonfiguration">
<param name="Local" value="schedule_advanced.html#arbeitsplaetze">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Vorschau-Modus">
<param name="Local" value="schedule_advanced.html#vorschau">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Gesperrte Zellen">
<param name="Local" value="schedule_advanced.html#gesperrt">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Dienstplan-Notizen">
<param name="Local" value="schedule_advanced.html#notizen">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Sprachsteuerung">
<param name="Local" value="schedule_advanced.html#sprache">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Mein Dashboard">
<param name="Local" value="mydashboard.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Übersicht">
<param name="Local" value="mydashboard.html#uebersicht">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Navigation vom Dashboard">
<param name="Local" value="mydashboard.html#navigation">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="CoWork - Videozusammenarbeit">
<param name="Local" value="mydashboard.html#cowork">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Dienstwünsche">
<param name="Local" value="wishlist.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Ansichten">
<param name="Local" value="wishlist.html#ansichten">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Neuen Wunsch einreichen">
<param name="Local" value="wishlist.html#neuer_wunsch">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Wunsch bearbeiten oder löschen">
<param name="Local" value="wishlist.html#bearbeiten">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Wunschgenehmigung (für Administratoren)">
<param name="Local" value="wishlist.html#genehmigung">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Erfüllungsstatistik">
<param name="Local" value="wishlist.html#statistik">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="E-Mail-Erinnerungen">
<param name="Local" value="wishlist.html#erinnerungen">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Urlaubsplanung">
<param name="Local" value="vacation.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Ansichten">
<param name="Local" value="vacation.html#ansichten">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Urlaub planen">
<param name="Local" value="vacation.html#planen">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Konfliktprüfung">
<param name="Local" value="vacation.html#konflikte">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Schulferien und Feiertage">
<param name="Local" value="vacation.html#schulferien">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Urlaubssimulation">
<param name="Local" value="vacation.html#simulation">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Weiterbildungsplanung">
<param name="Local" value="training.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Ansichten">
<param name="Local" value="training.html#ansichten">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Verfügbare Modalitäten">
<param name="Local" value="training.html#modalitaeten">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Rotation planen">
<param name="Local" value="training.html#rotation">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Übertragung in den Dienstplan">
<param name="Local" value="training.html#uebertragung">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Personalverwaltung">
<param name="Local" value="staff.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Mitarbeiter verwalten">
<param name="Local" value="staff.html#mitarbeiter">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Rollen">
<param name="Local" value="staff.html#rollen">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Qualifikationen">
<param name="Local" value="staff.html#qualifikationen">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Personalplan (VK/FTE)">
<param name="Local" value="staff.html#personalplan">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Zentrale Mitarbeiterverknüpfung">
<param name="Local" value="staff.html#zentral">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Zertifikatsverwaltung">
<param name="Local" value="staff.html#zertifikate">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Statistiken und Berichte">
<param name="Local" value="statistics.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Dashboard">
<param name="Local" value="statistics.html#dashboard">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Filter und Zeitraum">
<param name="Local" value="statistics.html#filter">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Export">
<param name="Local" value="statistics.html#export">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Detaillierte Berichte">
<param name="Local" value="statistics.html#berichte">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Systemadministration">
<param name="Local" value="admin.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Benutzerverwaltung">
<param name="Local" value="admin.html#benutzer">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Berechtigungen">
<param name="Local" value="admin.html#berechtigungen">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Einstellungen">
<param name="Local" value="admin.html#einstellungen">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Datenbankverwaltung">
<param name="Local" value="admin.html#datenbank">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Protokolle">
<param name="Local" value="admin.html#protokolle">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Admin-Tools">
<param name="Local" value="admin.html#tools">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Konzepte und Grundlagen">
<param name="Local" value="concepts.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Berechtigungen und Rollen">
<param name="Local" value="concepts.html#berechtigungen">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Qualifikationssystem (4-Stufen)">
<param name="Local" value="concepts.html#qualifikationen">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Teamrollen">
<param name="Local" value="concepts.html#rollen">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Arbeitsplätze">
<param name="Local" value="concepts.html#arbeitsplaetze">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Multi-Tenant-Architektur">
<param name="Local" value="concepts.html#multitenant">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Sicherheit">
<param name="Local" value="concepts.html#sicherheit">
</OBJECT>
</LI>
</UL>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Häufige Probleme">
<param name="Local" value="troubleshooting.html">
</OBJECT>
<UL>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Anmeldeprobleme">
<param name="Local" value="troubleshooting.html#anmeldung">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Dienstplan-Probleme">
<param name="Local" value="troubleshooting.html#dienstplan">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Wunsch-Probleme">
<param name="Local" value="troubleshooting.html#wuesche">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Urlaubs-Probleme">
<param name="Local" value="troubleshooting.html#urlaub">
</OBJECT>
</LI>
<LI><OBJECT type="text/sitemap">
<param name="Name" value="Allgemeine Probleme">
<param name="Local" value="troubleshooting.html#allgemein">
</OBJECT>
</LI>
</UL>
</LI>
"@

$hhcContent = @"
<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
<HTML>
<HEAD>
<meta name="GENERATOR" content="Microsoft&reg; HTML Help Workshop 4.1">
<!-- Sitemap 1.0 -->
</HEAD>
<BODY>
<OBJECT type="text/site properties">
<param name="ImageType" value="Folder">
<param name="Window Styles" value="0x800025">
</OBJECT>
<UL>
$toc</UL>
</BODY>
</HTML>
"@

[System.IO.File]::WriteAllText((Join-Path $scriptDir "curaflow.hhc"), $hhcContent, [System.Text.Encoding]::GetEncoding(1252))
Write-Host "  curaflow.hhc rewritten (Window Styles = 0x800025)" -ForegroundColor Green

# ---------------------------------------------------------------
# Step 3: Rewrite curaflow.hhk in canonical format
# ---------------------------------------------------------------
Write-Host ""
Write-Host "Step 3: Rewriting curaflow.hhk (canonical format)..." -ForegroundColor Yellow

$keywords = @"
<LI><OBJECT type="text/index">
<param name="Keyword" value="CuraFlow">
<param name="Local" value="index.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Anmeldung">
<param name="Local" value="getting_started.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Login">
<param name="Local" value="getting_started.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Passwort">
<param name="Local" value="getting_started.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Einstellungen">
<param name="Local" value="getting_started.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Rollen">
<param name="Local" value="getting_started.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Berechtigungen">
<param name="Local" value="getting_started.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Dienstplan">
<param name="Local" value="schedule.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Drag-and-Drop">
<param name="Local" value="schedule.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Rückgängig">
<param name="Local" value="schedule.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Export">
<param name="Local" value="schedule.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Feiertage">
<param name="Local" value="schedule.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="KI-Planungsassistent">
<param name="Local" value="schedule_advanced.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Timeslots">
<param name="Local" value="schedule_advanced.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Validierung">
<param name="Local" value="schedule_advanced.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Sprachsteuerung">
<param name="Local" value="schedule_advanced.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Dashboard">
<param name="Local" value="mydashboard.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="CoWork">
<param name="Local" value="mydashboard.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Dienstwünsche">
<param name="Local" value="wishlist.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Urlaub">
<param name="Local" value="vacation.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Schulferien">
<param name="Local" value="vacation.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Weiterbildung">
<param name="Local" value="training.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Personal">
<param name="Local" value="staff.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Qualifikationen">
<param name="Local" value="staff.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Zertifikate">
<param name="Local" value="staff.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Statistiken">
<param name="Local" value="statistics.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Berichte">
<param name="Local" value="statistics.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Administration">
<param name="Local" value="admin.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Benutzerverwaltung">
<param name="Local" value="admin.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Datenbank">
<param name="Local" value="admin.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Backup">
<param name="Local" value="admin.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Probleme">
<param name="Local" value="troubleshooting.html">
</OBJECT>
</LI>
<LI><OBJECT type="text/index">
<param name="Keyword" value="Fehlerbehebung">
<param name="Local" value="troubleshooting.html">
</OBJECT>
</LI>
"@

$hhkContent = @"
<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
<HTML>
<HEAD>
<meta name="GENERATOR" content="Microsoft&reg; HTML Help Workshop 4.1">
<!-- Sitemap 1.0 -->
</HEAD>
<BODY>
<UL>
$keywords</UL>
</BODY>
</HTML>
"@

[System.IO.File]::WriteAllText((Join-Path $scriptDir "curaflow.hhk"), $hhkContent, [System.Text.Encoding]::GetEncoding(1252))
Write-Host "  curaflow.hhk rewritten" -ForegroundColor Green

# ---------------------------------------------------------------
# Step 4: Rewrite curaflow.hhp with canonical options
# ---------------------------------------------------------------
Write-Host ""
Write-Host "Step 4: Rewriting curaflow.hhp..." -ForegroundColor Yellow

$hhpContent = @"
[OPTIONS]
Compatibility=1.1 or later
Compiled file=CuraFlow_Hilfe.chm
Contents file=curaflow.hhc
Default topic=index.html
Display compile progress=No
Full-text search=Yes
Index file=curaflow.hhk
Language=0x407 German (Germany)
Title=CuraFlow - Benutzerhandbuch
Binary TOC=Yes
Binary Index=Yes

[WINDOWS]
Main="CuraFlow - Benutzerhandbuch","curaflow.hhc","index.html","curaflow.hhk",,,,,0x23520,0x20,,,,,,1

[FILES]
index.html
getting_started.html
schedule.html
schedule_advanced.html
mydashboard.html
wishlist.html
vacation.html
training.html
staff.html
statistics.html
admin.html
concepts.html
troubleshooting.html
"@

[System.IO.File]::WriteAllText((Join-Path $scriptDir "curaflow.hhp"), $hhpContent, [System.Text.Encoding]::ASCII)
Write-Host "  curaflow.hhp rewritten" -ForegroundColor Green

Write-Host ""
Write-Host "=== Fix complete. Now recompile with build-chm.ps1 ===" -ForegroundColor Cyan
