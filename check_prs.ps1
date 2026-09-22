$token = 'ghs_4997044_eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRobmQiLCJjdHgiOiJRN3FhZ3c5dVVPZUk0Wmw0WVhpbDJDWUdKNTZVQnBmMlp5T2NxN25SUHVzaFFxWEZzeXYzYl9xcmZnIiwiZXhwIjoxNzkwMDc5MDc1LCJpYXQiOjE3OTAwNzU0NzUsImlzcyI6ImdpdGh1YiIsImp0aSI6ImUxMDEwYTE4LTJhYmQtNDBiMS1iZGQ0LWVmZTczNGRjZWVhZiIsInZlciI6M30.GSEod2y4pstaTRpxcA0zFIxX9dAPJ5dgQRv3MGEjNWnQc7UwZKCD0qgqPzhd7MKXIoyYGe-EoLkKUBiJPEriBA'
$headers = @{
    'Authorization' = "Bearer $token"
    'Accept' = 'application/vnd.github+json'
}
$prs = Invoke-RestMethod -Method Get -Uri 'https://api.github.com/repos/nahcnuj/makamujo/pulls?state=open&head=nahcnuj:feat/voltage-persistence-v4' -Headers $headers
$prs | ForEach-Object { Write-Host "PR #$($_.number): $($_.title) - $($_.head.ref) -> $($_.base.ref)" }