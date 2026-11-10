<#
.SYNOPSIS
  Builds the Swift Playgrounds version of Noteboard so it can run on an iPad.

.DESCRIPTION
  Swift Playgrounds compiles a single module, so this script copies every .swift file
  from App/ and Packages/NoteboardKit/Sources/<Module>/ into
  Playground/Noteboard.swiftpm/Sources/<Module>/ and removes the
  `import Noteboard...` lines (everything is in one module there).

  Output:
    Playground/Noteboard.swiftpm       folder to open in Swift Playgrounds
    Playground/Noteboard.swiftpm.zip   same, zipped for transfer to the iPad

.PARAMETER Destination
  Optional folder to also copy Noteboard.swiftpm into, e.g. your iCloud Drive or
  OneDrive folder, so it shows up in the iPad's Files app.

.EXAMPLE
  ./scripts/build-playground.ps1
  ./scripts/build-playground.ps1 -Destination "$env:USERPROFILE\iCloudDrive"
#>
param(
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$playground = Join-Path $repo 'Playground'
$package = Join-Path $playground 'Noteboard.swiftpm'
$out = Join-Path $package 'Sources'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

# Collect (module, file) pairs.
$files = @()
foreach ($file in Get-ChildItem -Path (Join-Path $repo 'App') -Filter '*.swift' -Recurse) {
    $files += [pscustomobject]@{ Module = 'App'; File = $file }
}
$kitSources = Join-Path $repo 'Packages/NoteboardKit/Sources'
foreach ($moduleDir in Get-ChildItem -Path $kitSources -Directory) {
    foreach ($file in Get-ChildItem -Path $moduleDir.FullName -Filter '*.swift' -Recurse) {
        $files += [pscustomobject]@{ Module = $moduleDir.Name; File = $file }
    }
}

# One Swift module cannot contain two files with the same name.
$duplicates = $files | Group-Object { $_.File.Name } | Where-Object { $_.Count -gt 1 }
if ($duplicates) {
    $names = ($duplicates | ForEach-Object { $_.Name }) -join ', '
    throw "Duplicate Swift file names across modules (rename one of them): $names"
}

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force -Path $out | Out-Null

$importPattern = '^\s*(@testable\s+)?import\s+Noteboard\w+\s*$'
foreach ($entry in $files) {
    $targetDir = Join-Path $out $entry.Module
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    $lines = [System.IO.File]::ReadAllLines($entry.File.FullName)
    $kept = $lines | Where-Object { $_ -notmatch $importPattern }
    $header = "// GENERATED from $($entry.Module)/$($entry.File.Name) by scripts/build-playground.ps1. Do not edit."
    $text = (@($header) + $kept) -join "`n"
    [System.IO.File]::WriteAllText((Join-Path $targetDir $entry.File.Name), $text + "`n", $utf8NoBom)
}

$zip = Join-Path $playground 'Noteboard.swiftpm.zip'
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path $package -DestinationPath $zip

Write-Host "Generated $($files.Count) Swift files into $out"
Write-Host "Zip: $zip"

if ($Destination) {
    $target = Join-Path $Destination 'Noteboard.swiftpm'
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Copy-Item -Path $package -Destination $target -Recurse
    Write-Host "Copied to $target"
}
