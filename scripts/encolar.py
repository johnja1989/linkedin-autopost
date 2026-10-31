"""Deja un post en la cola para que el Worker de Cloudflare lo publique.

Uso: python3 scripts/encolar.py NUMERO post.txt infografia.png
Crea cola/NNN.txt y cola/NNN.jpg (JPG optimizado, máx. 1620 px de ancho)
y añade NNN a cola/pendientes.json.
"""
import sys, json, shutil, pathlib
from PIL import Image

RAIZ = pathlib.Path(__file__).resolve().parent.parent
COLA = RAIZ / "cola"

numero, texto, imagen = sys.argv[1], pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
nnn = f"{int(numero):03d}"
COLA.mkdir(exist_ok=True)
shutil.copyfile(texto, COLA / f"{nnn}.txt")

im = Image.open(imagen).convert("RGB")
if im.width > 1620:
    im = im.resize((1620, round(im.height * 1620 / im.width)), Image.LANCZOS)
im.save(COLA / f"{nnn}.jpg", "JPEG", quality=88, optimize=True, progressive=True)

pend_path = COLA / "pendientes.json"
pend = json.loads(pend_path.read_text()) if pend_path.exists() else []
if nnn not in pend:
    pend.append(nnn)
pend_path.write_text(json.dumps(pend) + "\n")
print(f"Encolado {nnn}: {(COLA / f'{nnn}.jpg').stat().st_size // 1024} KB · pendientes: {pend}")
