param(
  [string]$CertPath = "certs/dev-cert.pfx",
  [string]$CerPath = "certs/dev-cert.cer",
  [string]$Passphrase = "superairhockey-dev"
)

$ErrorActionPreference = "Stop"

function Get-PrimaryIPv4Addresses {
  try {
    $addresses = Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*"
      } |
      Select-Object -ExpandProperty IPAddress -Unique

    if ($addresses) {
      return $addresses
    }
  } catch {
  }

  return @("127.0.0.1")
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedCertPath = Join-Path $repoRoot $CertPath
$resolvedCerPath = Join-Path $repoRoot $CerPath
$targetDir = Split-Path -Parent $resolvedCertPath

if (-not (Test-Path $targetDir)) {
  New-Item -ItemType Directory -Path $targetDir | Out-Null
}

$dnsNames = @("localhost")
if ($env:COMPUTERNAME) {
  $dnsNames += $env:COMPUTERNAME
}

$ipAddresses = Get-PrimaryIPv4Addresses
$subjectAltNames = $dnsNames + $ipAddresses

$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$hashAlgorithm = [System.Security.Cryptography.HashAlgorithmName]::SHA256
$padding = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
$subject = "CN=SuperAirHockey Dev"
$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new($subject, $rsa, $hashAlgorithm, $padding)

$sanBuilder = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
foreach ($dnsName in $dnsNames | Select-Object -Unique) {
  $sanBuilder.AddDnsName($dnsName)
}
foreach ($ipAddress in $ipAddresses | Select-Object -Unique) {
  $sanBuilder.AddIpAddress([System.Net.IPAddress]::Parse($ipAddress))
}

$request.CertificateExtensions.Add($sanBuilder.Build())
$request.CertificateExtensions.Add(
  [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $false)
)
$request.CertificateExtensions.Add(
  [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
    [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
    [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,
    $true
  )
)

$eku = [System.Security.Cryptography.OidCollection]::new()
$eku.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.1", "Server Authentication")) | Out-Null
$request.CertificateExtensions.Add(
  [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku, $true)
)

$notBefore = [System.DateTimeOffset]::Now.AddDays(-1)
$notAfter = [System.DateTimeOffset]::Now.AddYears(2)
$certificate = $request.CreateSelfSigned($notBefore, $notAfter)

$pfxBytes = $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $Passphrase)
[System.IO.File]::WriteAllBytes($resolvedCertPath, $pfxBytes)

$cerBytes = $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
[System.IO.File]::WriteAllBytes($resolvedCerPath, $cerBytes)

$certificate.Dispose()
$rsa.Dispose()

Write-Host "HTTPS dev certificate generated."
Write-Host "PFX: $resolvedCertPath"
Write-Host "CER: $resolvedCerPath"
Write-Host "Included names: $($subjectAltNames -join ', ')"
Write-Host "Passphrase: $Passphrase"
