<#
    Короткий адрес для аварийной консоли.

    Поднимает сервер тем же deploy\bootstrap.ps1, но лежит в корне, чтобы
    строку можно было набрать руками в веб-консоли провайдера, где не работает
    вставка. Каждый лишний символ в адресе - лишний шанс на опечатку, а
    ошибиться в "raw.githubusercontent.com" легко.

        irm https://raw.githubusercontent.com/MrNaPaSS/MENTOR/main/up.ps1 | iex

    Всё остальное описано в deploy\bootstrap.ps1.
#>

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$url = 'https://raw.githubusercontent.com/MrNaPaSS/MENTOR/main/deploy/bootstrap.ps1'
Write-Host "Skachivayu $url" -ForegroundColor DarkGray
Invoke-Expression (Invoke-RestMethod -Uri $url)
