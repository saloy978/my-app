$ErrorActionPreference = 'Stop'
$body = @{ email='admin1@example.com'; password='Passw0rd!' } | ConvertTo-Json
$resp = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -Body $body -ContentType 'application/json'
$t = $resp.token
Invoke-RestMethod -Method Post -Uri http://localhost:5000/admin/srs/init -Headers @{ Authorization = "Bearer $t" }
Write-Host "SRS init done"


