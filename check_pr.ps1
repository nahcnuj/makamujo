$token = 'ghs_4997044_eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRobmQiLCJjdHgiOiJRN3FhZ3c5dVVPZUk0Wmw0WVhpbDJDWUdKNTZVQnBmMlp5T2NxN25SUHVzaFFxWEZzeXYzYl9xcmZnIiwiZXhwIjoxNzkwMDc5MDc1LCJpYXQiOjE3OTAwNzU0NzUsImlzcyI6ImdpdGh1YiIsImp0aSI6ImUxMDEwYTE4LTJhYmQtNDBiMS1iZGQ0LWVmZTczNGRjZWVhZiIsInZlciI6M30.GSEod2y4pstaTRpxcA0zFIxX9dAPJ5dgQRv3MGEjNWnQc7UwZKCD0qgqPzhd7MKXIoyYGe-EoLkKUBiJPEriBA'
$headers = @{
    'Authorization' = "Bearer $token"
    'Accept' = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
}
$checks = Invoke-RestMethod -Method Get -Uri 'https://api.github.com/repos/nahcnuj/makamujo/commits/fb928ab424f1be237b649dd0fc3fce163c88ed60/check-runs' -Headers $headers
foreach ($run in $checks.check_runs) {
    $c = if ($run.conclusion) { $run.conclusion } else { $run.status }
    Write-Host "$($run.name): $c"
}