<#
.SYNOPSIS
    Builds the CuraFlow CHM help file.

.DESCRIPTION
    This script compiles the CuraFlow HTML Help Workshop project into a CHM file.
    It checks for the HTML Help Workshop compiler (hhc.exe) and runs the compilation.

.NOTES
    Requires HTML Help Workshop to be installed.
    Download: https://www.microsoft.com/en-us/download/details.aspx?id=21138
#>

param(
    [switch]$OpenAfterBuild
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$hhpFile = Join-Path $scriptDir "curaflow.hhp"
$chmFile = Join-Path $scriptDir "CuraFlow_Hilfe.chm"

Write-Host "=== CuraFlow CHM Build Script ===" -ForegroundColor Cyan
Write-Host ""

# Check if HHP file exists
if (-not (Test-Path $hhpFile)) {
    Write-Host "ERROR: HHP file not found: $hhpFile" -ForegroundColor Red
    exit 1
}

Write-Host "Project file: $hhpFile" -ForegroundColor Green

# Find hhc.exe
$hhcPaths = @(
    "C:\Program Files (x86)\HTML Help Workshop\hhc.exe",
    "C:\Program Files\HTML Help Workshop\hhc.exe",
    "C:\Windows\hhc.exe",
    "C:\Windows\System32\hhc.exe"
)

$hhcExe = $null
foreach ($path in $hhcPaths) {
    if (Test-Path $path) {
        $hhcExe = $path
        break
    }
}

# Also check PATH
if (-not $hhcExe) {
    $hhcExe = Get-Command hhc.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

if (-not $hhcExe) {
    Write-Host ""
    Write-Host "ERROR: HTML Help Workshop compiler (hhc.exe) not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install HTML Help Workshop:" -ForegroundColor Yellow
    Write-Host "  https://www.microsoft.com/en-us/download/details.aspx?id=21138" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Or add it to your PATH after installation." -ForegroundColor Yellow
    exit 1
}

Write-Host "Compiler found: $hhcExe" -ForegroundColor Green
Write-Host ""

# Delete existing CHM file if it exists
if (Test-Path $chmFile) {
    Write-Host "Removing existing CHM file..." -ForegroundColor Yellow
    Remove-Item $chmFile -Force
}

# Compile
Write-Host "Compiling CHM file..." -ForegroundColor Cyan
Write-Host ""

try {
    $result = & $hhcExe $hhpFile
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "ERROR: Compilation failed with exit code $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
} catch {
    Write-Host ""
    Write-Host "ERROR: Compilation failed: $_" -ForegroundColor Red
    exit 1
}

# Check if CHM file was created
if (Test-Path $chmFile) {
    $fileSize = (Get-Item $chmFile).Length
    $fileSizeKB = [math]::Round($fileSize / 1KB, 2)
    
    Write-Host ""
    Write-Host "=== Build Successful ===" -ForegroundColor Green
    Write-Host "CHM file created: $chmFile" -ForegroundColor Green
    Write-Host "File size: $fileSizeKB KB" -ForegroundColor Green
    Write-Host ""
    
    if ($OpenAfterBuild) {
        Write-Host "Opening CHM file..." -ForegroundColor Cyan
        Start-Process $chmFile
    }
} else {
    Write-Host ""
    Write-Host "ERROR: CHM file was not created." -ForegroundColor Red
    exit 1
}
