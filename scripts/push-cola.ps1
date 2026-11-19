# Sube a GitHub los commits que deja la tarea de Claude (Cowork no puede hacer git push).
# Se ejecuta cada 10 minutos con el Programador de tareas de Windows.
# Anota en scripts\push.log cada push y tambien cualquier error (nunca el token).

$log = Join-Path $PSScriptRoot "push.log"

function Escribir([string]$texto) {
    $limpio = $texto -replace 'github_pat_[A-Za-z0-9_]+', '***'
    $limpio = $limpio -replace 'https://[^@\s/]+@', 'https://***@'
    Add-Content -Path $log -Value "$(Get-Date -Format s) $limpio"
}

# Ejecuta git; si falla, anota el paso y el mensaje y devuelve $null.
function Ejecutar-Git([string]$paso, [string[]]$argumentos) {
    $salida = (& git @argumentos 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Escribir "ERROR $paso (codigo $LASTEXITCODE): $($salida -replace '\s+', ' ')"
        return $null
    }
    return $salida
}

try {
    Set-Location (Split-Path $PSScriptRoot -Parent)
    $env:GIT_TERMINAL_PROMPT = "0"
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Escribir "ERROR git no esta en el PATH de la tarea (usuario: $env:USERNAME)"
        exit 1
    }
    if ($null -eq (Ejecutar-Git "fetch" @("fetch", "-q", "origin", "main"))) { exit 1 }
    $cuenta = Ejecutar-Git "rev-list" @("rev-list", "--count", "origin/main..HEAD")
    if ($null -eq $cuenta) { exit 1 }
    $ahead = [int]$cuenta
    if ($ahead -gt 0) {
        $null = Ejecutar-Git "pull" @("pull", "-q", "--rebase", "--autostash", "origin", "main")
        if ($null -eq (Ejecutar-Git "push" @("push", "-q", "origin", "main"))) { exit 1 }
        Escribir "push $ahead commit(s): ok"
    }
}
catch {
    Escribir "ERROR inesperado: $($_.Exception.Message)"
    exit 1
}
