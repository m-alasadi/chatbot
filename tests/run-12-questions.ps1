$qs = @(
    "الفيلم الوثائقي حين وصل",
    "الفيلم القصير الذاهبون الى الجنة",
    "فيلم وثائقي عن اعمار العتبة العباسية",
    "ما هي اخر فعاليات مهرجان ربيع الشهادة",
    "اخبار مشاريع العتبة العباسية المقدسة",
    "ما هو تاريخ بناء مرقد الامام عباس عليه السلام",
    "من هو العباس بن علي عليه السلام",
    "خطبة الجمعة الاخيرة",
    "ما معنى كلمة الايثار في القران الكريم",
    "ما هي اقسام الفيديو في موقع العتبة العباسية",
    "هل لدى العتبة العباسية مصانع",
    "هل لدى العتبة العباسية جامعة"
)
$outDir = "c:\Users\alasa\OneDrive\Documents\GitHub\chatbot\tests\eval-results"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$outFile = Join-Path $outDir "12-questions-test-$(Get-Date -Format 'yyyy-MM-dd').txt"
$out = "Test Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`r`n==========================================`r`n`r`n"
for ($i = 0; $i -lt $qs.Length; $i++) {
    $q = $qs[$i]
    Write-Host "[$($i+1)/12] $q" -ForegroundColor Yellow
    $bodyObj = @{ messages = @(@{ role = "user"; content = $q }); lang = "ar" }
    $body = $bodyObj | ConvertTo-Json -Depth 5
    $t0 = Get-Date
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/api/chat/site" -Method POST -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 120
        $ms = [int]((Get-Date) - $t0).TotalMilliseconds
        $ans = $resp.Content
    } catch {
        $ms = [int]((Get-Date) - $t0).TotalMilliseconds
        $ans = "ERROR: $($_.Exception.Message)"
    }
    Write-Host "   -> $ms ms" -ForegroundColor Gray
    $out += "[$($i+1)] Q: $q`r`nTime: $ms ms`r`nAnswer:`r`n$ans`r`n------------------------------------------`r`n`r`n"
}
[System.IO.File]::WriteAllText($outFile, $out, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Saved: $outFile" -ForegroundColor Green