// Publicador automático de LinkedIn — Cloudflare Worker (plan gratuito)
// Cada 10 minutos lee cola/pendientes.json del repositorio público y publica
// en LinkedIn los posts que aún no se han publicado (NNN.txt + NNN.jpg).
// Necesita: secreto LINKEDIN_TOKEN y un espacio KV enlazado como PUBLICADOS.

const RAW = "https://raw.githubusercontent.com/johnja1989/linkedin-autopost/main/";
const API = "https://api.linkedin.com";
const VERSION = "202608"; // LinkedIn-Version (AAAAMM)
const RESERVADOS = "\\|{}@[]()<>#*_~";

// Escapa el texto al "little text format" de LinkedIn y deja los hashtags clicables
function littleText(texto) {
  let out = "";
  for (const c of texto) out += RESERVADOS.includes(c) ? "\\" + c : c;
  return out.replace(/\\#([\p{L}\p{N}_]+)/gu, "{hashtag|\\#|$1}");
}

async function linkedin(env, metodo, ruta, cuerpo) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${env.LINKEDIN_TOKEN}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.status === 401) throw new Error("ERROR 401: el token de LinkedIn ha caducado o no es válido. Genera uno nuevo y actualiza el secreto LINKEDIN_TOKEN.");
  if (!r.ok) throw new Error(`ERROR ${r.status} en ${ruta.split("?")[0]}: ${(await r.text()).slice(0, 300)}`);
  return r;
}

async function persona(env) {
  const j = await (await linkedin(env, "GET", "/v2/userinfo")).json();
  return { urn: `urn:li:person:${j.sub}`, nombre: j.name };
}

async function registrar(env, mensaje) {
  const linea = `${new Date().toISOString()} | ${mensaje}`;
  console.log(linea);
  await env.PUBLICADOS.put("ultimo", linea);
  return linea;
}

async function publicarUno(env, id, autor) {
  const txt = await fetch(`${RAW}cola/${id}.txt`);
  const img = await fetch(`${RAW}cola/${id}.jpg`);
  if (!txt.ok || !img.ok) return registrar(env, `${id}: faltan archivos en cola/ (txt ${txt.status}, jpg ${img.status})`);
  const texto = (await txt.text()).trim();
  const bytes = await img.arrayBuffer();

  const init = await (await linkedin(env, "POST", "/rest/images?action=initializeUpload",
    { initializeUploadRequest: { owner: autor } })).json();
  const subida = await fetch(init.value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${env.LINKEDIN_TOKEN}`, "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  if (!subida.ok) throw new Error(`ERROR ${subida.status} subiendo la imagen de ${id}`);

  const post = await linkedin(env, "POST", "/rest/posts", {
    author: autor,
    commentary: littleText(texto),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { title: `Agente ${id}`, id: init.value.image } },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  });
  const urn = post.headers.get("x-restli-id") || "";
  await env.PUBLICADOS.put(`post:${id}`, urn || new Date().toISOString());
  return registrar(env, `PUBLICADO ${id} | ${urn}`);
}

// Publica como máximo UN post por ejecución (los siguientes salen en las próximas)
async function procesar(env) {
  const r = await fetch(`${RAW}cola/pendientes.json`, { cf: { cacheTtl: 60 } });
  if (!r.ok) return registrar(env, "Sin cola/pendientes.json");
  const ids = await r.json();
  for (const id of ids) {
    if (await env.PUBLICADOS.get(`post:${id}`)) continue;
    const { urn } = await persona(env);
    return publicarUno(env, String(id), urn);
  }
  return "Nada pendiente.";
}

export default {
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(procesar(env).catch((e) => registrar(env, e.message)));
  },
  async fetch(request, env) {
    const ruta = new URL(request.url).pathname;
    try {
      if (ruta === "/verificar") {
        const p = await persona(env);
        return new Response(`OK: token válido. Publicaré como ${p.nombre}.`);
      }
      if (ruta === "/estado") {
        return new Response((await env.PUBLICADOS.get("ultimo")) || "Todavía no hay ejecuciones.");
      }
      if (ruta === "/publicar") {
        return new Response(await procesar(env));
      }
      return new Response("Publicador de LinkedIn activo. Rutas: /verificar, /estado, /publicar");
    } catch (e) {
      return new Response(await registrar(env, e.message), { status: 500 });
    }
  },
};
