// Publicador automático de LinkedIn — Cloudflare Worker (plan gratuito)
// Cada 10 minutos lee cola/pendientes.json del repositorio público y publica
// en LinkedIn los posts que aún no se han publicado (NNN.txt + NNN.jpg).
// Necesita: un espacio KV enlazado como PUBLICADOS, el secreto LINKEDIN_CLIENT_SECRET
// (para renovar el token con un clic en /renovar) y, opcional, LINKEDIN_TOKEN como token inicial.

const RAW = "https://raw.githubusercontent.com/johnja1989/linkedin-autopost/main/";
const API = "https://api.linkedin.com";
const VERSION = "202608"; // LinkedIn-Version (AAAAMM)
const CLIENT_ID = "77e0gc3q29gkmr"; // ID del cliente de la app de LinkedIn (no es secreto)
const SCOPES = "openid profile w_member_social";
const RESERVADOS = "\\|{}@[]()<>#*_~";

// Escapa el texto al "little text format" de LinkedIn. Los hashtags (# + letra) se
// dejan como #Palabra sin escapar: LinkedIn los convierte en hashtags clicables.
// La plantilla {hashtag|\\#|...} salía en el post tal cual, con llaves y barras.
// Un # seguido de número ("el agente #95") se queda escapado: se ve como texto.
function littleText(texto) {
  let out = "";
  for (const c of texto) out += RESERVADOS.includes(c) ? "\\" + c : c;
  return out.replace(/\\#(\p{L}[\p{L}\p{N}]*)/gu, "#$1");
}

// El token vigente: el renovado con /renovar (en KV) o, si no hay, el secreto inicial
async function token(env) {
  return (await env.PUBLICADOS.get("token")) || env.LINKEDIN_TOKEN;
}

async function linkedin(env, metodo, ruta, cuerpo, tk) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${tk || (await token(env))}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.status === 401) throw new Error("ERROR 401: el token de LinkedIn ha caducado o no es válido. Renuévalo con un clic en /renovar.");
  if (!r.ok) throw new Error(`ERROR ${r.status} en ${ruta.split("?")[0]}: ${(await r.text()).slice(0, 300)}`);
  return r;
}

async function persona(env, tk) {
  const j = await (await linkedin(env, "GET", "/v2/userinfo", null, tk)).json();
  if (!tk) await env.PUBLICADOS.put("sub", j.sub); // recuerda de quién es la cuenta
  return { urn: `urn:li:person:${j.sub}`, nombre: j.name, sub: j.sub };
}

function fecha(ms) {
  return new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
}

// Paso 1 de la renovación: manda a LinkedIn a pedir permiso
async function renovar(request, env) {
  const estado = crypto.randomUUID();
  await env.PUBLICADOS.put(`estado:${estado}`, "1", { expirationTtl: 600 });
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.search = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID, scope: SCOPES, state: estado,
    redirect_uri: new URL("/callback", request.url).toString(),
  }).toString();
  return Response.redirect(url.toString(), 302);
}

// Paso 2: LinkedIn vuelve con un código; lo cambiamos por un token y lo guardamos
async function callback(request, env) {
  const p = new URL(request.url).searchParams;
  if (p.get("error")) return new Response(`LinkedIn no dio permiso: ${p.get("error_description") || p.get("error")}`, { status: 400 });
  const estado = p.get("state") || "";
  if (!(await env.PUBLICADOS.get(`estado:${estado}`))) return new Response("Enlace caducado o no válido. Vuelve a abrir /renovar.", { status: 400 });
  await env.PUBLICADOS.delete(`estado:${estado}`);
  if (!env.LINKEDIN_CLIENT_SECRET) return new Response("Falta el secreto LINKEDIN_CLIENT_SECRET en el Worker.", { status: 500 });

  const r = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code: p.get("code") || "", client_id: CLIENT_ID,
      client_secret: env.LINKEDIN_CLIENT_SECRET, redirect_uri: new URL("/callback", request.url).toString(),
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) return new Response(`No se pudo obtener el token: ${JSON.stringify(j).slice(0, 300)}`, { status: 500 });

  // Seguridad: solo se acepta la misma cuenta de LinkedIn que ya publicaba
  const quien = await persona(env, j.access_token);
  const esperado = await env.PUBLICADOS.get("sub");
  if (esperado && esperado !== quien.sub) return new Response("Esa cuenta de LinkedIn no es la del publicador. No se ha cambiado nada.", { status: 403 });

  const caduca = Date.now() + (j.expires_in || 5184000) * 1000;
  await env.PUBLICADOS.put("token", j.access_token);
  await env.PUBLICADOS.put("token_caduca", String(caduca));
  await env.PUBLICADOS.put("sub", quien.sub);
  await registrar(env, `TOKEN RENOVADO para ${quien.nombre} | caduca el ${fecha(caduca)}`);
  return new Response(`Listo, ${quien.nombre}: token renovado. Caduca el ${fecha(caduca)}. Ya puedes cerrar esta pestaña.`);
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
    headers: { Authorization: `Bearer ${await token(env)}`, "Content-Type": "application/octet-stream" },
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
      if (ruta === "/renovar") return renovar(request, env);
      if (ruta === "/callback") return callback(request, env);
      if (ruta === "/verificar") {
        const p = await persona(env);
        const c = await env.PUBLICADOS.get("token_caduca");
        return new Response(`OK: token válido. Publicaré como ${p.nombre}.` + (c ? ` Caduca el ${fecha(Number(c))}.` : ""));
      }
      if (ruta === "/estado") {
        const c = await env.PUBLICADOS.get("token_caduca");
        const ultimo = (await env.PUBLICADOS.get("ultimo")) || "Todavía no hay ejecuciones.";
        return new Response(ultimo + (c ? `\nToken: caduca el ${fecha(Number(c))}. Renueva en /renovar.` : ""));
      }
      if (ruta === "/publicar") {
        return new Response(await procesar(env));
      }
      return new Response("Publicador de LinkedIn activo. Rutas: /verificar, /estado, /publicar, /renovar");
    } catch (e) {
      return new Response(await registrar(env, e.message), { status: 500 });
    }
  },
};
