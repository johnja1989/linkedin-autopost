"""Publica en LinkedIn los posts que hay en cola/ (pares NNN.txt + NNN.png).

Usa la API oficial (Posts API + Images API) con el permiso w_member_social.
Variables de entorno (Secretos del repositorio en GitHub):
  LINKEDIN_TOKEN       token de acceso OAuth (dura 60 días)
  LINKEDIN_PERSON_URN  urn:li:person:XXXX (opcional: si falta se obtiene con /v2/userinfo)
  LINKEDIN_VERSION     opcional, formato AAAAMM (por defecto 202608)
  DRY_RUN=1            no llama a LinkedIn, solo muestra lo que haría
"""
import os, re, sys, json, shutil, pathlib, urllib.request, urllib.error

API = "https://api.linkedin.com"
RAIZ = pathlib.Path(__file__).resolve().parent.parent
COLA, PUBLICADOS = RAIZ / "cola", RAIZ / "publicados"
TOKEN = os.environ.get("LINKEDIN_TOKEN", "")
VERSION = os.environ.get("LINKEDIN_VERSION", "202608")
DRY = os.environ.get("DRY_RUN") == "1"

RESERVADOS = r"\|{}@[]()<>#*_~"


def a_little_text(texto: str) -> str:
    """Escapa el texto al 'little text format' de LinkedIn y mantiene los hashtags clicables."""
    out = "".join("\\" + c if c in RESERVADOS else c for c in texto)
    return re.sub(r"\\#(\w+)", r"{hashtag|\\#|\1}", out)


def llamar(metodo, url, cuerpo=None, datos=None, cabeceras=None):
    h = {"Authorization": f"Bearer {TOKEN}"}
    if cuerpo is not None:
        datos = json.dumps(cuerpo).encode()
        h.update({"Content-Type": "application/json", "LinkedIn-Version": VERSION,
                  "X-Restli-Protocol-Version": "2.0.0"})
    h.update(cabeceras or {})
    req = urllib.request.Request(url, data=datos, method=metodo, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode() or "{}"
            return r.status, dict(r.headers), json.loads(txt) if txt.strip().startswith("{") else {}
    except urllib.error.HTTPError as e:
        detalle = e.read().decode(errors="replace")
        if e.code == 401:
            sys.exit("ERROR 401: el token de LinkedIn ha caducado o no es válido. Genera uno nuevo "
                     "y actualiza el secreto LINKEDIN_TOKEN.")
        sys.exit(f"ERROR {e.code} en {url}: {detalle}")


def urn_persona():
    urn = os.environ.get("LINKEDIN_PERSON_URN", "").strip()
    if urn:
        return urn
    _, _, j = llamar("GET", f"{API}/v2/userinfo")
    return f"urn:li:person:{j['sub']}"


def subir_imagen(autor, ruta):
    _, _, j = llamar("POST", f"{API}/rest/images?action=initializeUpload",
                     cuerpo={"initializeUploadRequest": {"owner": autor}})
    url, imagen = j["value"]["uploadUrl"], j["value"]["image"]
    llamar("PUT", url, datos=ruta.read_bytes(), cabeceras={"Content-Type": "application/octet-stream"})
    return imagen


def publicar(autor, texto, imagen_urn, titulo):
    cuerpo = {
        "author": autor,
        "commentary": a_little_text(texto),
        "visibility": "PUBLIC",
        "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [],
                         "thirdPartyDistributionChannels": []},
        "content": {"media": {"title": titulo, "id": imagen_urn}},
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }
    if DRY:
        print(json.dumps(cuerpo, ensure_ascii=False, indent=2)[:1500]); return "DRY_RUN"
    _, cab, _ = llamar("POST", f"{API}/rest/posts", cuerpo=cuerpo)
    return cab.get("x-restli-id") or cab.get("X-RestLi-Id", "")


def main():
    pendientes = sorted(p for p in COLA.glob("*.txt"))
    if not pendientes:
        print("No hay posts en la cola."); return
    if not TOKEN and not DRY:
        sys.exit("Falta el secreto LINKEDIN_TOKEN.")
    autor = "urn:li:person:DRYRUN" if DRY else urn_persona()
    PUBLICADOS.mkdir(exist_ok=True)
    for txt in pendientes:
        img = next((txt.with_suffix(s) for s in (".png", ".jpg", ".jpeg") if txt.with_suffix(s).exists()), None)
        if img is None:
            print(f"{txt.name}: falta la imagen, se queda en cola."); continue
        texto = txt.read_text(encoding="utf-8").strip()
        imagen_urn = "urn:li:image:DRYRUN" if DRY else subir_imagen(autor, img)
        post = publicar(autor, texto, imagen_urn, f"Agente {txt.stem}")
        print(f"Publicado {txt.stem}: {post}")
        if not DRY:
            for f in (txt, img):
                shutil.move(str(f), PUBLICADOS / f.name)


if __name__ == "__main__":
    main()
