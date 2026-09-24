<#
    Подъём NMNH на чистом Windows Server - одной командой.

    Сервер переустановили, и всё, что лежало на системном диске, ушло вместе с
    ним: база, копии, .env, учётные данные туннеля. Репозиторий цел, но голого
    клона мало - нужны Python, Postgres и заполненное окружение. Набирать это
    руками в аварийной веб-консоли провайдера, где не работает вставка,
    невозможно, поэтому здесь всё, что делается без участия человека.

    Запуск на сервере (PowerShell от администратора):

        irm https://raw.githubusercontent.com/MrNaPaSS/MENTOR/main/deploy/bootstrap.ps1 | iex

    Первым делом скрипт включает RDP: дальше человек заходит обычным
    подключением, где работает буфер обмена, и дописывает ключи в .env
    спокойно, а не посимвольно через консоль.

    Повторный запуск безопасен: установленное не переставляется, готовый .env
    не перезаписывается, клон обновляется через git pull.

    Что скрипт НЕ делает намеренно - всё, что требует чужих секретов и
    решений: ключи бирж, токен бота, адрес приёма USDT, туннель Cloudflare.
    Их список он печатает в конце.
#>

[CmdletBinding()]
param(
    # Вне профиля пользователя: рабочий стол - первое, что теряется при
    # переустановке, и прошлую базу потеряли именно так.
    [string] $Root = 'C:\NMNH',
    [string] $Repo = 'https://github.com/MrNaPaSS/MENTOR.git',
    [string] $Branch = 'main',
    [string] $DbName = 'nmnh',
    [string] $DbUser = 'nmnh',
    [switch] $SkipRdp
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:StepNo = 0
$script:Notes = New-Object System.Collections.Generic.List[string]

function Write-Step {
    param([string] $Text)
    $script:StepNo++
    Write-Host ""
    Write-Host ("[{0}] {1}" -f $script:StepNo, $Text) -ForegroundColor Cyan
}

function Write-Ok {
    param([string] $Text)
    Write-Host ("    OK: {0}" -f $Text) -ForegroundColor Green
}

function Write-Skip {
    param([string] $Text)
    Write-Host ("    propusk: {0}" -f $Text) -ForegroundColor DarkGray
}

function Write-Warn {
    param([string] $Text)
    Write-Host ("    vnimanie: {0}" -f $Text) -ForegroundColor Yellow
    $script:Notes.Add($Text)
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# PATH в текущем процессе отстаёт от того, что записал установщик: без этого
# только что поставленные git и python не находятся до перезапуска консоли.
function Update-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = ($machine, $user | Where-Object { $_ }) -join ';'
}

function Test-Command {
    param([string] $Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    return $null -ne $cmd
}

# Секрет для .env: латиница, цифры, дефис и подчёркивание. Символы вроде # и $
# в .env и в строке подключения означают не себя, поэтому их здесь нет вовсе.
function New-Secret {
    param([int] $Bytes = 48)
    $buf = New-Object byte[] $Bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    $s = [Convert]::ToBase64String($buf)
    return $s.Replace('+', '-').Replace('/', '_').Replace('=', '')
}

# Правка одной строки .env: KEY=... меняется целиком, отсутствующий KEY
# дописывается в конец. Остальные строки, включая комментарии, не трогаем -
# в .env.example их больше, чем самих переменных, и они там не для красоты.
function Set-EnvValue {
    param(
        [string[]] $Lines,
        [string] $Key,
        [string] $Value
    )
    $found = $false
    $out = foreach ($line in $Lines) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=") {
            $found = $true
            "$Key=$Value"
        }
        else {
            $line
        }
    }
    if (-not $found) {
        $out = @($out) + @("$Key=$Value")
    }
    return @($out)
}

# Где искать psql. Chocolatey кладёт Postgres не всегда туда, куда кладёт его
# родной установщик, а PATH в текущем процессе обновляется не сразу, поэтому
# смотрим сразу по нескольким местам, а не по одному.
function Find-Psql {
    if (Test-Command 'psql') {
        return (Get-Command 'psql').Source
    }
    $roots = @(
        'C:\Program Files\PostgreSQL\*\bin\psql.exe',
        'C:\Program Files (x86)\PostgreSQL\*\bin\psql.exe',
        'C:\PostgreSQL\*\bin\psql.exe',
        "$env:ProgramData\chocolatey\lib\postgresql*\tools\*\bin\psql.exe"
    )
    foreach ($root in $roots) {
        $found = Get-ChildItem $root -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($found) {
            return $found.FullName
        }
    }
    return $null
}

Write-Host ""
Write-Host "=======================================" -ForegroundColor White
Write-Host "  NMNH - razvertyvanie na chistom servere" -ForegroundColor White
Write-Host "=======================================" -ForegroundColor White

if (-not (Test-Admin)) {
    throw 'Nuzhen PowerShell ot imeni administratora.'
}

# ---------------------------------------------------------------- 1. RDP
Write-Step 'Udalennyj rabochij stol'
if ($SkipRdp) {
    Write-Skip 'zapros -SkipRdp'
}
else {
    Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' `
        -Name 'fDenyTSConnections' -Value 0 -Type DWord
    # Группа задана кодом, а не названием: на русской системе правило
    # называется по-русски, и английское имя не находится.
    try {
        Enable-NetFirewallRule -Group '@FirewallAPI.dll,-28752' -ErrorAction Stop
    }
    catch {
        Write-Warn 'pravilo brandmauera dlya RDP ne vklyuchilos - proverte vruchnuyu'
    }
    Write-Ok 'RDP vklyuchen, port 3389'
}

# -------------------------------------------------------- 2. Chocolatey
Write-Step 'Chocolatey (menedzher paketov)'
if (Test-Command 'choco') {
    Write-Skip 'uzhe ustanovlen'
}
else {
    Set-ExecutionPolicy Bypass -Scope Process -Force
    Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Update-Path
    Write-Ok 'ustanovlen'
}

# ------------------------------------------------------------- 3. Пакеты
# Пароль суперпользователя базы: нигде не записан заранее, поэтому если
# Postgres уже стоял с другим паролем - установщик пропускается, и строку
# подключения человек правит сам.
$pgPassword = New-Secret -Bytes 18

Write-Step 'Git, Python 3.11, PostgreSQL 17'
if (Test-Command 'git') {
    Write-Skip 'git uzhe est'
}
else {
    choco install git -y --no-progress | Out-Null
    Write-Ok 'git'
}

if (Test-Command 'python') {
    Write-Skip ('python uzhe est: ' + (python --version 2>&1))
}
else {
    choco install python311 -y --no-progress | Out-Null
    Write-Ok 'python 3.11'
}

$psql = Find-Psql
if ($psql) {
    Write-Skip 'PostgreSQL uzhe stoit'
    $pgPassword = $null
}
else {
    # Установщик Postgres распаковывает себя во временный каталог и падает,
    # когда в пути есть кириллица - а профиль на русском сервере называется
    # "Администратор". Временный каталог на время установки уводим в ASCII.
    $oldTemp = $env:TEMP
    $oldTmp = $env:TMP
    $asciiTemp = 'C:\Temp'
    if (-not (Test-Path $asciiTemp)) {
        New-Item -ItemType Directory -Path $asciiTemp -Force | Out-Null
    }
    $env:TEMP = $asciiTemp
    $env:TMP = $asciiTemp

    # Без библиотек Visual C++ сервер не стартует, а Chocolatey зовёт
    # установщик с --install_runtimes 0 и их не ставит.
    choco install vcredist140 -y --no-progress | Out-Null

    # Вывод установщика не глушим: когда Postgres не встаёт, причина видна
    # только здесь, а молчаливый провал уводит разбор на полчаса в сторону.
    choco install postgresql17 -y --no-progress --params "/Password:$pgPassword"
    Update-Path
    if (-not (Find-Psql)) {
        # Chocolatey на чистом сервере спотыкается о Postgres чаще прочего,
        # поэтому вторая попытка идёт родным установщиком EDB: он ставит в
        # известное место и слушается тех же ключей.
        Write-Warn 'choco ne postavil PostgreSQL - probuyu ustanovshchik EDB'
        $exe = Join-Path $env:TEMP 'postgresql-setup.exe'
        $url = 'https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64.exe'
        try {
            Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
            $setupArgs = @(
                '--mode', 'unattended',
                '--unattendedmodeui', 'none',
                '--superpassword', $pgPassword,
                '--servicename', 'postgresql-x64-17',
                '--serverport', '5432',
                '--disable-components', 'stackbuilder,pgAdmin'
            )
            Start-Process -FilePath $exe -ArgumentList $setupArgs -Wait -NoNewWindow
            Update-Path
        }
        catch {
            Write-Warn "ustanovshchik EDB ne skachalsya: $($_.Exception.Message)"
        }
    }
    $env:TEMP = $oldTemp
    $env:TMP = $oldTmp
    if (Find-Psql) {
        Write-Ok 'PostgreSQL 17'
    }
}
Update-Path
$psql = Find-Psql
# Отсутствие psql больше не обрывает работу: репозиторий, окружение и
# зависимости от базы не зависят, и доделать их полезно в любом случае.
# База и схема тогда пропускаются, а что делать - сказано в конце.
if (-not $psql) {
    Write-Warn 'psql ne najden - bazu i migracii propustim, ustanovite PostgreSQL vruchnuyu'
}

# ---------------------------------------------------------- 4. Репозиторий
Write-Step 'Repozitorij'
$project = Join-Path $Root 'MENTOR'
if (Test-Path (Join-Path $project '.git')) {
    Push-Location $project
    git fetch origin $Branch --quiet
    git checkout $Branch --quiet
    git pull --ff-only origin $Branch --quiet
    Pop-Location
    Write-Ok "obnovlen: $project"
}
else {
    if (-not (Test-Path $Root)) {
        New-Item -ItemType Directory -Path $Root -Force | Out-Null
    }
    git clone --branch $Branch $Repo $project
    Write-Ok "klonirovan: $project"
}

# ------------------------------------------------------------ 5. Окружение
Write-Step 'Virtualnoe okruzhenie i zavisimosti'
$venvPython = Join-Path $project 'venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    python -m venv (Join-Path $project 'venv')
}
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r (Join-Path $project 'requirements.txt') --quiet
Write-Ok 'zavisimosti ustanovleny'

# ----------------------------------------------------------------- 6. База
Write-Step 'Baza dannyh'
$dbPassword = New-Secret -Bytes 18
$dbReady = $false

if (-not $psql) {
    Write-Warn 'PostgreSQL ne ustanovlen - baza ne sozdana'
}
elseif ($null -eq $pgPassword) {
    Write-Warn 'PostgreSQL stoyal ranshe: parol superpolzovatelya neizvesten, bazu sozdajte sami'
}
else {
    $env:PGPASSWORD = $pgPassword
    $exists = & $psql -U postgres -h 127.0.0.1 -tAc "select 1 from pg_roles where rolname='$DbUser'" 2>$null
    if ($exists -ne '1') {
        & $psql -U postgres -h 127.0.0.1 -c "create role $DbUser login password '$dbPassword'" | Out-Null
    }
    else {
        & $psql -U postgres -h 127.0.0.1 -c "alter role $DbUser login password '$dbPassword'" | Out-Null
    }
    $hasDb = & $psql -U postgres -h 127.0.0.1 -tAc "select 1 from pg_database where datname='$DbName'" 2>$null
    if ($hasDb -ne '1') {
        & $psql -U postgres -h 127.0.0.1 -c "create database $DbName owner $DbUser encoding 'UTF8'" | Out-Null
    }
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    $dbReady = $true
    Write-Ok "baza $DbName, polzovatel $DbUser"
}

# ------------------------------------------------------------------ 7. .env
Write-Step 'Fajl .env'
$envPath = Join-Path $project '.env'
if (Test-Path $envPath) {
    Write-Skip '.env uzhe est - ne trogaem'
}
else {
    $lines = @(Get-Content (Join-Path $project '.env.example') -Encoding UTF8)
    if ($dbReady) {
        $url = "postgresql+psycopg://${DbUser}:${dbPassword}@localhost:5432/$DbName"
        $lines = Set-EnvValue -Lines $lines -Key 'DATABASE_URL' -Value $url
    }
    # Секрет входа и мастер-ключ торговых ключей - всегда новые. Старые ушли
    # вместе с сервером, и расшифровывать ими всё равно нечего.
    $lines = Set-EnvValue -Lines $lines -Key 'JWT_SECRET' -Value (New-Secret)
    $lines = Set-EnvValue -Lines $lines -Key 'WEEX_KEYS_SECRET' -Value (New-Secret)
    $lines = Set-EnvValue -Lines $lines -Key 'ALLOWED_ORIGINS' -Value 'https://www.nmnh.trade,https://nmnh.trade'
    # Три процесса и рыночные данные - как было на прошлом сервере.
    $lines = Set-EnvValue -Lines $lines -Key 'NMNH_SPLIT' -Value '1'
    $lines = Set-EnvValue -Lines $lines -Key 'NMNH_MARKET' -Value '1'
    Set-Content -Path $envPath -Value $lines -Encoding UTF8
    Write-Ok '.env sobran iz .env.example'
}

# -------------------------------------------------------------- 8. Миграции
Write-Step 'Shema bazy'
if ($dbReady) {
    Push-Location $project
    & $venvPython 'migrate_db.py'
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -eq 0) {
        Write-Ok 'shema primenena'
    }
    else {
        Write-Warn 'migrate_db.py zavershilsya s oshibkoj - smotrite vyvod vyshe'
    }
}
else {
    Write-Skip 'baza ne gotova'
}

# ----------------------------------------------------------------- Итог
Write-Host ""
Write-Host "=======================================" -ForegroundColor White
Write-Host "  Gotovo" -ForegroundColor White
Write-Host "=======================================" -ForegroundColor White
Write-Host ""
Write-Host "  Proekt:  $project"
Write-Host "  RDP:     port 3389, polzovatel Administrator"
if ($pgPassword) {
    Write-Host "  Postgres superuser parol: $pgPassword" -ForegroundColor Yellow
    Write-Host "  (zapishite ego sejchas - bolshe nigde ego net)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Dalshe rukami, po RDP:" -ForegroundColor Cyan
Write-Host "    1. .env - zapolnit klyuchi:"
Write-Host "       BOT_TOKEN, ADMIN_TG_ID, SERVICE_API_KEY, FORUM_CHAT_ID,"
Write-Host "       NMNH_BSC_RECEIVER, ANTHROPIC_API_KEY, klyuchi birzh"
Write-Host "    2. Tunnel Cloudflare - uchetnye dannye ushli s proshlym serverom:"
Write-Host "         cloudflared tunnel login"
Write-Host "         cloudflared tunnel create nmnh-api"
Write-Host "       podrobno: docs\deploy\cloudflare-tunnel.md"
Write-Host "    3. Zapusk:  start.bat"
Write-Host "    4. Kopii bazy - srazu i NE na disk C:"
Write-Host "         python backup_db.py --out <vneshnee hranilishche>"
Write-Host "       proshluyu bazu poteryali imenno potomu, chto kopii lezhali ryadom s nej."
Write-Host ""

if ($script:Notes.Count -gt 0) {
    Write-Host "  Na chto posmotret:" -ForegroundColor Yellow
    foreach ($note in $script:Notes) {
        Write-Host "    - $note" -ForegroundColor Yellow
    }
    Write-Host ""
}
