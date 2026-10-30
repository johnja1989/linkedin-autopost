# linkedin-autopost

Publicador automático de mis posts de LinkedIn sobre agentes de IA.

- Una tarea programada de Claude genera cada post (texto + infografía) y lo deja en `cola/` como `NNN.txt` + `NNN.png`.
- Al hacer push, GitHub Actions ejecuta `scripts/publicar.py`, que usa la API oficial de LinkedIn
  (Images API + Posts API, permiso `w_member_social`) y mueve los archivos a `publicados/`.

Secretos necesarios en *Settings → Secrets and variables → Actions*:
`LINKEDIN_TOKEN` (token OAuth, caduca a los 60 días) y, opcional, `LINKEDIN_PERSON_URN`.

Prueba sin publicar: `DRY_RUN=1 python scripts/publicar.py`
