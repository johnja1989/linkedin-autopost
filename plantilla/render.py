import sys, json, pathlib
from playwright.sync_api import sync_playwright
data = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
tpl = pathlib.Path(__file__).with_name("plantilla.html").read_text(encoding="utf-8")
html = tpl.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False))
out = pathlib.Path(sys.argv[2]); tmp = out.with_suffix(".html"); tmp.write_text(html, encoding="utf-8")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width":1080,"height":1000}, device_scale_factor=2)
    pg.goto(tmp.resolve().as_uri()); pg.wait_for_timeout(300)
    pg.screenshot(path=str(out), full_page=True); b.close()
print("ok", out)
