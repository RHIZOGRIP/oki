BeforeAll {
  $here = Split-Path -Parent $PSScriptRoot
  Import-Module (Join-Path $here 'Oki.psm1') -Force
  $shipped = Get-ChildItem -LiteralPath $here -File | Where-Object { $_.Extension -in '.ps1', '.psm1', '.cmd', '.sh' }
}

Describe 'the shipped files' {
  It 'are ASCII, which Windows PowerShell 5.1 reads the same in every code page' {
    foreach ($file in $shipped) {
      $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
      @($bytes | Where-Object { $_ -gt 127 }).Count | Should -Be 0 -Because $file.Name
    }
  }
  It 'parse as PowerShell without errors' {
    foreach ($file in $shipped | Where-Object { $_.Extension -in '.ps1', '.psm1' }) {
      $errors = $null
      [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$errors)
      $errors | Should -BeNullOrEmpty -Because $file.Name
    }
  }
  It 'Install Oki.cmd has CRLF line ends, as cmd.exe expects' {
    $text = [System.IO.File]::ReadAllText((Join-Path $here 'Install Oki.cmd'))
    $text | Should -Match "`r`n"
    $text -replace "`r`n", '' | Should -Not -Match "`n"
  }
  It 'never remove the shared folder: no Remove-Item names it' {
    foreach ($file in $shipped | Where-Object { $_.Extension -in '.ps1', '.psm1' }) {
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$null)
      $removals = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Remove-Item' }, $true)
      foreach ($removal in $removals) { $removal.Extent.Text | Should -Not -Match 'folder' -Because "$($file.Name): $($removal.Extent.Text)" }
    }
  }
}

Describe 'Get-OkiDistroName and Test-OkiDistroName' {
  It 'names release 0.1.0 Oki-0.1.0' { Get-OkiDistroName -Release '0.1.0' | Should -Be 'Oki-0.1.0' }
  It 'refuses what is not a release name' {
    foreach ($bad in '', '../x', 'a b', '-1', '0.1.0;rm') { { Get-OkiDistroName -Release $bad } | Should -Throw }
  }
  It 'knows Oki distributions and nothing else' {
    Test-OkiDistroName -Name 'Oki-0.1.0' | Should -BeTrue
    Test-OkiDistroName -Name 'Oki-0.2.0-rc.1' | Should -BeTrue
    foreach ($other in 'Ubuntu', 'oki-0.1.0', 'Oki-', 'Oki-x', 'Oki-0.1.0 x', 'docker-desktop', '') { Test-OkiDistroName -Name $other | Should -BeFalse -Because $other }
  }
}

Describe 'the port policy' {
  BeforeAll {
    $alice = 'S-1-5-21-3623811015-3361044348-30300820-1001'
    $bob = 'S-1-5-21-3623811015-3361044348-30300820-1002'
  }
  It 'gives an account the same ports every time, in 20000-29999' {
    $first = @(Get-OkiPortCandidate -Sid $alice)
    @(Get-OkiPortCandidate -Sid $alice) | Should -Be $first
    $first.Count | Should -Be 20
    @($first | Sort-Object -Unique).Count | Should -Be 20
    foreach ($port in $first) { $port | Should -BeGreaterOrEqual 20000; $port | Should -BeLessOrEqual 29999 }
  }
  It 'gives two accounts of one PC different ports' {
    (Get-OkiPortCandidate -Sid $alice)[0] | Should -Not -Be (Get-OkiPortCandidate -Sid $bob)[0]
  }
  It 'takes the first candidate when it is free' {
    Select-OkiPort -Sid $alice -Excluded @() -Listening @() | Should -Be (Get-OkiPortCandidate -Sid $alice)[0]
  }
  It 'passes over a port something listens on, and one Windows excludes' {
    $candidates = @(Get-OkiPortCandidate -Sid $alice)
    $excluded = @([pscustomobject]@{ Start = $candidates[1]; End = $candidates[1] })
    Select-OkiPort -Sid $alice -Excluded $excluded -Listening @($candidates[0]) | Should -Be $candidates[2]
  }
  It 'refuses when every candidate is taken' {
    { Select-OkiPort -Sid $alice -Excluded @([pscustomobject]@{ Start = 20000; End = 29999 }) -Listening @() } | Should -Throw '*free*'
  }
  It "reads netsh's excluded port ranges" {
    $netsh = @(
      '',
      'Protocol tcp Port Exclusion Ranges',
      '',
      'Start Port    End Port',
      '----------    --------',
      '      5357        5357',
      '     21037       21136',
      '     50000       50059     *',
      '',
      '* - Administered port exclusions.',
      ''
    ) -join "`r`n"
    $ranges = @(ConvertFrom-OkiExcludedPort -Text $netsh)
    $ranges.Count | Should -Be 3
    $ranges[1].Start | Should -Be 21037
    $ranges[1].End | Should -Be 21136
    $ranges[2].End | Should -Be 50059
  }
}

Describe 'the release checks' {
  BeforeEach {
    $release = Join-Path $TestDrive ([guid]::NewGuid())
    Copy-Item -Recurse -LiteralPath (Join-Path $PSScriptRoot 'release') -Destination $release
  }
  It "reads the SHA256SUMS sha256sum writes, release.sh's format" {
    $sums = ConvertFrom-OkiChecksum -Text ([System.IO.File]::ReadAllText((Join-Path $release 'SHA256SUMS')))
    @($sums.Keys) | Should -Be @('manifest.json', 'provision.sh', 'payload.tgz')
    $sums['provision.sh'] | Should -Be '6ecf06f6dbbab6a920b5b208bc7c4069ca266b150d6c00533a00b5975a8417ca'
  }
  It 'reads binary-mode lines and CRLF line ends' {
    $sums = ConvertFrom-OkiChecksum -Text ("{0} *a.tgz`r`n{1}  b c.json`r`n" -f ('a' * 64), ('b' * 64))
    $sums['a.tgz'] | Should -Be ('a' * 64)
    $sums['b c.json'] | Should -Be ('b' * 64)
  }
  It 'refuses a line that is not a checksum' {
    { ConvertFrom-OkiChecksum -Text "not a checksum`n" } | Should -Throw '*SHA256SUMS*'
  }
  It 'passes a whole release' {
    Test-OkiRelease -Directory $release -Need 'manifest.json', 'payload.tgz' | Should -BeNullOrEmpty
  }
  It 'names a changed file, a missing one, and one SHA256SUMS does not list' {
    Add-Content -LiteralPath (Join-Path $release 'provision.sh') -Value 'tampered'
    Remove-Item -LiteralPath (Join-Path $release 'payload.tgz')
    $problems = @(Test-OkiRelease -Directory $release -Need 'manifest.json', 'oki.ps1')
    $problems | Should -Contain 'SHA256SUMS does not list oki.ps1'
    $problems | Should -Contain 'provision.sh differs from its SHA256SUMS line'
    $problems | Should -Contain 'payload.tgz is missing'
    $problems.Count | Should -Be 3
  }
  It 'refuses a directory with no SHA256SUMS' {
    Remove-Item -LiteralPath (Join-Path $release 'SHA256SUMS')
    Test-OkiRelease -Directory $release -Need 'manifest.json' | Should -BeLike '*no SHA256SUMS*'
  }
  It 'checks a download against a sha256 or sha512 digest' {
    $file = Join-Path $TestDrive 'base'
    [System.IO.File]::WriteAllText($file, "oki`n")
    Test-OkiDigest -Path $file -Digest 'sha256:9e1174caf66692ebe075a64f1e56bae1b1171d48f4b7558990ddc35a90015b48' | Should -BeTrue
    Test-OkiDigest -Path $file -Digest 'sha512:15334a8e25387c4b0ba99bebe066d17a4ea0212d76c9d1fb331cae573ea49a5f5c0273d6dd3b8772a3ae47969760db68a9320e19eda88e35f92c2485ec72f4cc' | Should -BeTrue
    Test-OkiDigest -Path $file -Digest ('sha256:' + '0' * 64) | Should -BeFalse
    { Test-OkiDigest -Path $file -Digest 'md5:abc' } | Should -Throw
  }
}

Describe 'the shared folder' {
  It 'is one fstab line mounting it at /folders, as uid 1000' {
    ConvertTo-OkiFstabLine -Folder 'C:\Users\Jean Dupont\Documents\Oki' |
      Should -Be 'C:\134Users\134Jean\040Dupont\134Documents\134Oki /folders drvfs uid=1000,gid=1000 0 0'
  }
  It 'escapes every byte that is not plain ASCII, so the line is ASCII' {
    ConvertTo-OkiFstabLine -Folder ('C:\Users\Zo' + [char]0xEB + '\Oki\') | Should -Be 'C:\134Users\134Zo\303\253\134Oki /folders drvfs uid=1000,gid=1000 0 0'
  }
  It 'refuses a folder that is not on a local drive' {
    foreach ($bad in '\\server\share\Oki', 'Oki', '/home/oki') { { ConvertTo-OkiFstabLine -Folder $bad } | Should -Throw '*local drive*' }
  }
  It 'reads back, through libmount, as the exact Windows path' -Skip:(-not (Get-Command findmnt -ErrorAction Ignore)) {
    $folder = 'C:\Users\Zo' + [char]0xEB + ' D' + [char]0x2019 + 'Arc\OneDrive - Contoso\Documents\Oki 2026'
    $fstab = Join-Path $TestDrive 'fstab'
    [System.IO.File]::WriteAllText($fstab, (ConvertTo-OkiFstabLine -Folder $folder) + "`n")
    $out = & findmnt --fstab --tab-file $fstab --noheadings --raw --output SOURCE,TARGET,FSTYPE,OPTIONS
    $LASTEXITCODE | Should -Be 0
    $fields = $out -split ' '
    $fields[1..3] | Should -Be @('/folders', 'drvfs', 'uid=1000,gid=1000')
    $raw = [regex]::Replace($fields[0], '\\x([0-9a-f]{2})', { param($m) [char][Convert]::ToInt32($m.Groups[1].Value, 16) })
    [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding(28591).GetBytes($raw)) | Should -Be $folder
  }
  It 'knows a folder inside OneDrive' {
    $roots = @('C:\Users\jean\OneDrive', $null, '')
    Test-OkiOneDrive -Path 'C:\Users\jean\OneDrive\Documents\Oki' -Root $roots | Should -BeTrue
    Test-OkiOneDrive -Path 'c:\users\JEAN\onedrive\Documents\Oki' -Root $roots | Should -BeTrue
    Test-OkiOneDrive -Path 'C:\Users\jean\OneDrive' -Root $roots | Should -BeTrue
    Test-OkiOneDrive -Path 'C:\Users\jean\OneDriveOld\Oki' -Root $roots | Should -BeFalse
    Test-OkiOneDrive -Path 'C:\Users\jean\Documents\Oki' -Root $roots | Should -BeFalse
    Test-OkiOneDrive -Path 'C:\Users\jean\Documents\Oki' -Root @($null, '') | Should -BeFalse
  }
  It 'is made, and what is already in it kept' {
    $folder = Join-Path $TestDrive 'Oki'
    Initialize-OkiFolder -Path $folder
    $folder | Should -Exist
    Set-Content -LiteralPath (Join-Path $folder 'report.txt') -Value 'kept'
    Initialize-OkiFolder -Path $folder
    Get-Content -LiteralPath (Join-Path $folder 'report.txt') | Should -Be 'kept'
  }
}

Describe 'Test-OkiRequirement' {
  BeforeAll {
    $pc = @{ Build = 26100; Architecture = 'x64'; MemoryGB = 16; FreeGB = 200; Virtualization = $true; Wsl = [version]'2.6.1.0' }
  }
  It 'passes a Windows 11 x64 PC with WSL 2' {
    $check = Test-OkiRequirement @pc
    $check.Problems | Should -BeNullOrEmpty
    $check.Wsl | Should -BeNullOrEmpty
  }
  It 'names each thing that is missing' {
    $bad = $pc.Clone()
    $bad.Build = 19045; $bad.Architecture = 'arm64'; $bad.MemoryGB = 2; $bad.FreeGB = 3.2; $bad.Virtualization = $false
    $problems = @((Test-OkiRequirement @bad).Problems)
    $problems.Count | Should -Be 5
    $problems[0] | Should -BeLike '*Windows 11*19045*'
    $problems[1] | Should -BeLike '*x64*arm64*'
    $problems[3] | Should -BeLike '*3.2 GB*'
  }
  It 'asks for WSL to be installed when it is missing, and updated before 2.0' {
    $none = $pc.Clone(); $none.Wsl = $null
    (Test-OkiRequirement @none).Wsl | Should -Be 'install'
    $old = $pc.Clone(); $old.Wsl = [version]'1.2.5.0'
    (Test-OkiRequirement @old).Wsl | Should -Be 'update'
    $edge = $pc.Clone(); $edge.Wsl = [version]'2.0.0'
    (Test-OkiRequirement @edge).Wsl | Should -BeNullOrEmpty
  }
}

Describe 'Get-OkiState' {
  It 'is stopped when the distribution does not run' {
    (Get-OkiState -Port 21000 -Running $false -Answering $false -HeldBy $null -KeptSeconds $null).State | Should -Be 'stopped'
  }
  It "is an error, naming the holder, when this account's port is held while Oki is stopped" {
    $state = Get-OkiState -Port 21000 -Running $false -Answering $false -HeldBy 'wslrelay (pid 4242)' -KeptSeconds $null
    $state.State | Should -Be 'error'
    $state.Reason | Should -BeLike '*21000*wslrelay (pid 4242)*'
  }
  It 'is running when it answers' {
    $state = Get-OkiState -Port 21000 -Running $true -Answering $true -HeldBy $null -KeptSeconds 3
    $state.State | Should -Be 'running'
    $state.Reason | Should -BeLike '*http://127.0.0.1:21000/oki/*'
  }
  It 'is starting for two minutes after the launcher started it, then an error' {
    (Get-OkiState -Port 21000 -Running $true -Answering $false -HeldBy $null -KeptSeconds 30).State | Should -Be 'starting'
    (Get-OkiState -Port 21000 -Running $true -Answering $false -HeldBy $null -KeptSeconds 121).State | Should -Be 'error'
  }
  It 'is an error when it runs without the launcher having started it, and does not answer' {
    (Get-OkiState -Port 21000 -Running $true -Answering $false -HeldBy $null -KeptSeconds $null).State | Should -Be 'error'
  }
}

Describe 'the launcher config' {
  It 'is written as UTF-8 without a BOM and read back' {
    $file = Join-Path $TestDrive 'oki.json'
    Write-OkiConfig -Path $file -Distro 'Oki-0.1.0' -Port 23456 -Folder 'C:\Users\Zo\Documents\Oki'
    [System.IO.File]::ReadAllBytes($file)[0] | Should -Be ([byte][char]'{')
    $config = Read-OkiConfig -Path $file
    $config.distro | Should -Be 'Oki-0.1.0'
    $config.port | Should -Be 23456
    $config.folder | Should -Be 'C:\Users\Zo\Documents\Oki'
  }
  It 'is nothing when not written yet' {
    Read-OkiConfig -Path (Join-Path $TestDrive 'none.json') | Should -BeNullOrEmpty
  }
}

Describe 'Test-OkiAnswering' {
  BeforeAll {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $answer = Start-ThreadJob -ArgumentList $listener -ScriptBlock {
      param($listener)
      $client = $listener.AcceptTcpClient()
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream)
      while ($reader.ReadLine()) { }
      $bytes = [System.Text.Encoding]::ASCII.GetBytes("HTTP/1.1 303 See Other`r`nLocation: http://127.0.0.1/oki/claim/`r`nContent-Length: 0`r`nConnection: close`r`n`r`n")
      $stream.Write($bytes, 0, $bytes.Length)
      $client.Close()
    }
  }
  AfterAll {
    $listener.Stop()
    $answer | Remove-Job -Force
  }
  It "is true when Oki answers, a redirect to the claim screen included" {
    Test-OkiAnswering -Port $port | Should -BeTrue
  }
  It 'is false when nothing listens' {
    $free = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $free.Start()
    $closed = $free.LocalEndpoint.Port
    $free.Stop()
    Test-OkiAnswering -Port $closed | Should -BeFalse
  }
}
