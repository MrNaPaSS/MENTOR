<#
    Погасить процесс, который слушает порт, вместе с его окном.

    Перезапуск одного окна сервера: старое окно держит порт, и новое на нём не
    поднимется. Закрывать окно мышью каждый раз неудобно, поэтому это делает
    `restart.bat` - а здесь та часть, которую в batch написать нечем.

    Гасим не только сам процесс, но и цепочку его родителей до окна консоли:
    между `cmd` и слушающим процессом бывает обёртка (`uvicorn.exe`, лаунчер
    python), и если убить только слушающего, на экране останется пустое окно с
    приглашением - через полчаса не разобрать, где работающий сервер, а где
    остаток. Windows дочерние процессы за родителем не закрывает, поэтому
    гасим по списку, начиная с самого нижнего.
#>
param([Parameter(Mandatory = $true)][int]$Port)

$ErrorActionPreference = "SilentlyContinue"

function Owner([int]$port) {
    # Get-NetTCPConnection есть не везде, netstat - везде.
    $owner = (Get-NetTCPConnection -LocalPort $port -State Listen).OwningProcess |
        Select-Object -First 1
    if ($owner) { return [int]$owner }
    $line = netstat -ano -p tcp | Select-String ":$port\s" | Select-String "LISTENING" |
        Select-Object -First 1
    if (-not $line) { return 0 }
    return [int]($line.ToString().Trim() -split "\s+")[-1]
}

function Chain([int]$start) {
    <# Процесс, его родители и окно консоли над ними. Не глубже четырёх шагов:
       дальше начинается explorer или служба, и их трогать нельзя. #>
    $out = @($start)
    $at = $start
    for ($step = 0; $step -lt 4; $step++) {
        $info = Get-CimInstance Win32_Process -Filter "ProcessId=$at"
        if (-not $info -or -not $info.ParentProcessId) { break }
        $parent = [int]$info.ParentProcessId
        $name = (Get-Process -Id $parent).ProcessName
        if (-not $name) { break }
        if ($name -eq "explorer" -or $name -eq "services" -or $name -eq "svchost") { break }
        $out += $parent
        $at = $parent
        # Дошли до окна консоли - выше не поднимаемся.
        if ($name -eq "cmd") { break }
    }
    return $out
}

$target = Owner $Port
if (-not $target) {
    Write-Host "  Port $Port svoboden - gasit nechego."
    exit 0
}

foreach ($id in Chain $target) {
    Stop-Process -Id $id -Force
}

# Порт освобождается не мгновенно: ждём до пяти секунд, иначе новое окно
# поднимется и упадёт на "address already in use".
for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 200
    if (-not (Owner $Port)) {
        Write-Host "  Port $Port osvobozhden."
        exit 0
    }
}
Write-Host "  Port $Port vse eshche zanyat - zakroj okno vruchnuyu."
exit 1
