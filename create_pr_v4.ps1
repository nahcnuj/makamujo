$token = 'ghs_4997044_eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRobmQiLCJjdHgiOiJabmNwamQ3ckxUMTl2SlQ0YVdzLVVCZk9MZDRzdTN4bWpWeWJjYi1yOHo1SERXY2V5cVVST2FPMEpRIiwiZXhwIjoxNzkwMDgyMDk5LCJpYXQiOjE3OTAwNzg0OTksImlzcyI6ImdpdGh1YiIsImp0aSI6ImM3YmRlYTQ1LTgwODEtNDZlMi1iMTM1LTFjZDE4ZGMxOTk3OSIsInZlciI6M30.kheZAYJNmRKEyP2agLRuoorEJOenoBX3QtH_2Ds482hx13jBvFx0Gr4QYhs8S205xc01FFvJfKMdzWPbBFUtPQ'
$headers = @{
    'Authorization' = "Bearer $token"
    'Accept' = 'application/vnd.github+json'
}
$bodyFile = 'C:\Users\nahcnuj\ghq\github.com\nahcnuj\makamujo\pr_body_v4.json'
Invoke-RestMethod -Method Post -Uri 'https://api.github.com/repos/nahcnuj/makamujo/pulls' -Headers $headers -InFile $bodyFile -ContentType 'application/json'