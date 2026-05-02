param([string]$q = "عدد اخوة العباس")
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$payload = @{ messages = @(@{ role = "user"; content = $q }); useTools = $true } | ConvertTo-Json -Depth 5 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
try {
  $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/chat/site" -Method POST -Body $bytes -ContentType "application/json; charset=utf-8" -TimeoutSec 180 -UseBasicParsing
  Write-Host "=== Q: $q ==="
  Write-Host ([System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()))
} catch {
  Write-Host "ERROR: $($_.Exception.Message)"
}
