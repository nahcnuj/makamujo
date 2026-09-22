$token = 'ghs_4997044_eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRobmQiLCJjdHgiOiJRN3FhZ3c5dVVPZUk0Wmw0WVhpbDJDWUdKNTZVQnBmMlp5T2NxN25SUHVzaFFxWEZzeXYzYl9xcmZnIiwiZXhwIjoxNzkwMDc5MDc1LCJpYXQiOjE3OTAwNzU0NzUsImlzcyI6ImdpdGh1YiIsImp0aSI6ImUxMDEwYTE4LTJhYmQtNDBiMS1iZGQ0LWVmZTczNGRjZWVhZiIsInZlciI6M30.GSEod2y4pstaTRpxcA0zFIxX9dAPJ5dgQRv3MGEjNWnQc7UwZKCD0qgqPzhd7MKXIoyYGe-EoLkKUBiJPEriBA'
$headers = @{
    'Authorization' = "Bearer $token"
    'Accept' = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
}
$checks = Invoke-RestMethod -Method Get -Uri 'https://api.github.com/repos/nahcnuj/makamujo/commits/f2fdd15e374f48efddadc752d4b44dc526e0ce17/check-runs' -Headers $headers
$checks.check_runs | ForEach-Object {
    $c = if ($_.conclusion) { $_.conclusion } else { $_.status }
    Write-Host "$($_.name): $c"
    if ($_.conclusion -eq 'failure') {
        Write-Host "  URL: $($_.details_url)"
    }
}