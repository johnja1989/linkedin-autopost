# linkedin-autopost

Publicador automático de mis posts de LinkedIn sobre agentes de IA.

1. Una tarea programada de Claude genera cada post (texto + infografía) y lo deja en `cola/`
   como `NNN.txt` + `NNN.jpg`, y añade `NNN` a `cola/pendientes.json`.
2. Un Cloudflare Worker (`cloudflare/worker.js`, plan gratuito) se ejecuta cada 10 minutos,
   lee la cola desde este repositorio público y publica con la API oficial de LinkedIn
   (Images API + Posts API, permiso `w_member_social`). Guarda lo publicado en Workers KV para no repetir.

Rutas del Worker: `/verificar` (comprueba el token), `/estado` (última ejecución), `/publicar` (fuerza una ejecución).

El token (`LINKEDIN_TOKEN`) vive solo como secreto del Worker y caduca a los 60 días.
`scripts/publicar.py` es la versión equivalente en Python (para GitHub Actions u otro entorno).
