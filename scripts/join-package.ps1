param(
  [string]$BaseName = "Mathorium-Desktop-10.0.0-Complete-Windows-x64.zip"
)
$ErrorActionPreference = "Stop"
$parts = Get-ChildItem -File -Filter "$BaseName.part*" | Sort-Object Name
if (-not $parts -or $parts.Count -lt 1) { throw "No package parts found for $BaseName" }
$expected = 1
foreach ($part in $parts) {
  $suffix = [int]($part.Name -replace "^.*\.part", "")
  if ($suffix -ne $expected) { throw "Missing package part $expected; found $($part.Name)" }
  $expected++
}
$output = [System.IO.File]::Create((Join-Path $PWD $BaseName))
try {
  foreach ($part in $parts) {
    $input = [System.IO.File]::OpenRead($part.FullName)
    try { $input.CopyTo($output) } finally { $input.Dispose() }
  }
} finally { $output.Dispose() }
$zip = Get-Item $BaseName
Write-Host "Reconstructed $($zip.Name): $($zip.Length) bytes"
Get-FileHash $zip.FullName -Algorithm SHA256
