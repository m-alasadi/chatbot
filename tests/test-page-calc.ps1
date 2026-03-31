$h = @{"Accept-Language"="ar"}
$total = 34805
$testIds = @(37234, 17406, 344, 1)

foreach ($id in $testIds) {
    $pos = $total - $id + 1
    $page = [Math]::Ceiling($pos / 50)
    Write-Host "`n=== Testing ID=$id ==="
    Write-Host "Position=$pos Page=$page"
    
    $r = Invoke-RestMethod -Uri "https://alkafeel.net/alkafeel_back_test/api/v1/articles/GetLast/50/all?page=$page" -Headers $h
    $found = $r.data | Where-Object { $_.id -eq "$id" }
    
    if ($found) {
        Write-Host "FOUND: $($found.title)" -ForegroundColor Green
    } else {
        $ids = $r.data | ForEach-Object { $_.id }
        Write-Host "NOT FOUND in page $page. IDs range: $($ids[0])..$($ids[-1])" -ForegroundColor Yellow
        
        # Try nearby pages
        foreach ($offset in @(-1, 1, -2, 2)) {
            $tryPage = $page + $offset
            if ($tryPage -lt 1) { continue }
            $r2 = Invoke-RestMethod -Uri "https://alkafeel.net/alkafeel_back_test/api/v1/articles/GetLast/50/all?page=$tryPage" -Headers $h
            $found2 = $r2.data | Where-Object { $_.id -eq "$id" }
            if ($found2) {
                Write-Host "FOUND in page $tryPage (offset $offset): $($found2.title)" -ForegroundColor Green
                break
            }
        }
    }
}
