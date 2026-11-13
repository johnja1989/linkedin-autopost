# Sube a GitHub los commits que deja la tarea de Claude (Cowork no puede hacer git push).
# Se ejecuta cada 10 minutos con el Programador de tareas de Windows.
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:GIT_TERMINAL_PROMPT = "0"
git fetch -q origin main
$ahead = [int](git rev-list --count origin/main..HEAD)
if ($ahead -gt 0) {
    git pull -q --rebase --autostash origin main
    git push -q origin main 2>&1 | Out-Null
    $estado = if ($LASTEXITCODE -eq 0) { "ok" } else { "ERROR $LASTEXITCODE" }
    Add-Content -Path "scripts\push.log" -Value "$(Get-Date -Format s) push $ahead commit(s): $estado"
}
