$h = @{"Accept-Language"="ar"}
$total = 34805
$perPage = 50
$lastPage = [Math]::Ceiling($total / $perPage)
$testIds = @(37234, 17406, 344, 1, 18000)

foreach ($id in $testIds) {
    Write-Host "`n=== Testing ID=$id ===" -ForegroundColor Cyan
    $pos = $total - $id + 1
    $targetPage = [Math]::Max(1, [Math]::Min($lastPage, [Math]::Ceiling($pos / $perPage)))
    $tried = @{}
    $found = $false

    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        if ($tried.ContainsKey($targetPage)) { break }
        $tried[$targetPage] = $true
        Write-Host "  Attempt $($attempt+1): Page $targetPage"
        
        $r = Invoke-RestMethod -Uri "https://alkafeel.net/alkafeel_back_test/api/v1/articles/GetLast/$perPage/all?page=$targetPage" -Headers $h
        $items = $r.data
        if (-not $items -or $items.Count -eq 0) { break }

        $hit = $items | Where-Object { $_.id -eq "$id" }
        if ($hit) {
            Write-Host "  FOUND: $($hit.title)" -ForegroundColor Green
            $found = $true
            break
        }

        $pageIds = $items | ForEach-Object { [int]$_.id }
        $maxId = ($pageIds | Measure-Object -Maximum).Maximum
        $minId = ($pageIds | Measure-Object -Minimum).Minimum
        Write-Host "  Page IDs: $maxId..$minId"

        if ($id -gt $maxId) {
            $diff = [Math]::Max(1, [Math]::Ceiling(($id - $maxId) / $perPage))
            $targetPage = [Math]::Max(1, $targetPage - $diff)
        } elseif ($id -lt $minId) {
            $diff = [Math]::Max(1, [Math]::Ceiling(($minId - $id) / $perPage))
            $targetPage = [Math]::Min($lastPage, $targetPage + $diff)
        } else {
            Write-Host "  ID in range but gap - trying neighbors" -ForegroundColor Yellow
            break
        }
    }

    if (-not $found) { Write-Host "  NOT FOUND after all attempts" -ForegroundColor Red }
}
