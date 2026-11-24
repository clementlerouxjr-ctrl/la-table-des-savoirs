const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PORT = process.env.PORT || 5000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const sessions = new Map();

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const writeJson = (p, value) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(value, null, 2), "utf8");
const restaurant = () => readJson("data/restaurant.json");
const daily = () => readJson("data/daily-update.json");

function send(res, status, body, type="application/json; charset=utf-8") {
  res.writeHead(status, {"Content-Type": type, "Cache-Control":"no-store"});
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; if (data.length > 100000) reject(new Error("Request too large")); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch(e) { reject(e); } });
  });
}
function authed(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return token && sessions.has(token);
}
function effectiveInfo() {
  const base = restaurant();
  const update = daily();
  return {base, update};
}
function updateFacts(update) {
  if (!update.changes?.length) return "No active daily changes have been entered.";
  return update.changes.map(c => `- ${c.type}: ${c.item || "General"} — ${c.value}`).join("\n");
}
function simpleAnswer(question) {
  const q = question.toLowerCase();
  const {base, update} = effectiveInfo();
  const allMenus = base.menus;
  const changes = update.changes || [];
  const matchingChanges = changes.filter(c => c.item && q.includes(String(c.item).toLowerCase()));
  const today = new Date().toLocaleDateString("en-CA", {timeZone:"Europe/Paris"});
  const requestedDate = Object.keys(allMenus).find(d => {
    const [y,m,day] = d.split("-").map(Number);
    const date = new Date(Date.UTC(y,m-1,day));
    const names = [date.toLocaleDateString("en-US",{weekday:"long",timeZone:"UTC"}), d, date.toLocaleDateString("en-GB",{day:"numeric",month:"long",timeZone:"UTC"})];
    return names.some(n => q.includes(n.toLowerCase()));
  });
  if (matchingChanges.length && /available|sold.?out|price|cost|special|change|still have|left/.test(q)) {
    return matchingChanges.map(c => `${c.item}: ${c.value} (staff update: ${c.type}).`).join("\n");
  }
  if (/allerg|gluten|lactose|dairy|milk|nut|vegan|vegetarian|dietary/.test(q)) {
    if (/vegetarian/.test(q) && !/vegan/.test(q)) return "A vegetarian option changes every day. The supplied information says vegetarian, not vegan. Please ask the canteen team which option is available today.";
    return "Full ingredient lists, allergen declarations and cross-contact information have not been supplied. I can't confirm whether a dish is safe for your dietary requirement. Please speak to canteen staff before ordering.";
  }
  if (/price|cost|how much|€|euro/.test(q)) {
    const priceChanges = changes.filter(c => c.type === "Price" && !c.item);
    return priceChanges.length ? priceChanges.map(c => c.value).join("\n") : `The supplied information lists a price of ${base.price}. Any item-specific price changes should be confirmed with canteen staff.`;
  }
  if (/hour|open|opening|service time/.test(q)) return `La Table des Savoirs is open from ${base.opening_hours_raw}.`;
  if (/payment|card|cash/.test(q)) return "Accepted payment methods have not been provided. Please check with the canteen team.";
  if (/book|reserv|pre.?order|order/.test(q)) return "Booking and pre-order arrangements have not been supplied. I can't place an order or reservation. Please contact the canteen team.";
  if (/available|sold.?out|left|still have/.test(q)) return "I don't have live availability or sold-out information. Please check with the canteen team.";
  if (/who can|public|visitor|external guest|access|can i eat/.test(q)) return "La Table des Savoirs is open to students, Institut Lyfe staff and external guests.";
  if (/where|address|location|directions/.test(q)) return "La Table des Savoirs is the school canteen of Institut Lyfe in Écully, France. The exact building and directions have not been supplied; please ask Institut Lyfe staff.";
  if (/beef|boeuf/.test(q)) return "Beef is explicitly named in Tuesday 24 November's main course: beef bourguignon with creamy polenta, mushrooms, pearl onions and carrots. The full recipe and cross-contact information are not available.";
  if (/menu|eat|dish|food|special|today|tomorrow|monday|tuesday|wednesday|thursday|friday/.test(q)) {
    const key = requestedDate || (allMenus[today] ? today : null);
    if (!key) return "I have dated menus for 23–27 November 2026 only. Please specify a date in that range, or ask the canteen team for the current menu.";
    const m = allMenus[key];
    const menuChanges = changes.filter(c => ["Special","Menu change","Sold out","Availability"].includes(c.type));
    const updateText = menuChanges.length ? `\n\nStaff updates:\n${menuChanges.map(c => `- ${c.item ? c.item + ": " : ""}${c.value}`).join("\n")}` : "";
    return `${m.day}\n\nStarters: ${m.starters.join("; ")}.\n\nMain course(s): ${m.mains.join("; ")}.\n\nDesserts: ${m.desserts.join("; ")}.${updateText}\n\nPlease check with staff for last-minute changes or availability.`;
  }
  return "I can help with the dated menus, prices, opening information and dietary questions. What date or dish would you like to know about?";
}
async function answerWithLLM(question) {
  const {base, update} = effectiveInfo();
  if (!OPENAI_API_KEY) return {answer: simpleAnswer(question), mode:"demo"};
  const instructions = `You are the guest-facing menu assistant for La Table des Savoirs, the school canteen of Institut Lyfe in Écully, France.
Answer briefly, warmly and only from the supplied JSON. Do not invent facts. Daily changes override base information only for the exact facts they explicitly change. If information is missing, conflicting or ambiguous, say so and refer the guest to canteen staff. Ask one short clarifying question if needed.
ALLERGIES: Never declare a dish safe. Only repeat explicitly supplied ingredient/allergen facts, and always tell the guest to confirm ingredients and cross-contact with staff before ordering.
Never claim to book, order, or check real-time stock. The current availability must be confirmed by staff.
If asked for today's menu, use today's date in Europe/Paris and only use a menu whose date matches. If no dated menu matches, say the menu is unavailable.`;
  const input = `RESTAURANT BASE INFORMATION:\n${JSON.stringify(base)}\n\nDATED STAFF UPDATE:\n${JSON.stringify(update)}\n\nGUEST QUESTION:\n${question}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{"Authorization":`Bearer ${OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:MODEL,instructions,input,temperature:0.2})
  });
  if (!response.ok) throw new Error(`LLM request failed (${response.status})`);
  const data = await response.json();
  const answer = (data.output || []).flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text).join("\n");
  return {answer: answer || simpleAnswer(question), mode:"llm"};
}

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      const d = daily();
      return send(res,200,{updatedAt:d.updatedAt, updatedBy:d.updatedBy, llmEnabled:!!OPENAI_API_KEY, hasStaffPassword:!!ADMIN_PASSWORD});
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(req);
      if (!body.message || typeof body.message !== "string" || body.message.length > 1500) return send(res,400,{error:"Please enter a question (maximum 1,500 characters)."});
      try { return send(res,200,await answerWithLLM(body.message.trim())); }
      catch(e) { console.error(e); return send(res,200,{answer:simpleAnswer(body.message.trim()),mode:"fallback",notice:"The AI service is temporarily unavailable; this answer uses the prototype's built-in information rules."}); }
    }
    if (req.method === "POST" && url.pathname === "/api/staff/login") {
      if (!ADMIN_PASSWORD) return send(res,503,{error:"Staff access is not configured. Set ADMIN_PASSWORD on the server."});
      const body = await readBody(req);
      if (body.password !== ADMIN_PASSWORD) return send(res,401,{error:"Incorrect password."});
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token,true);
      return send(res,200,{token});
    }
    if (req.method === "GET" && url.pathname === "/api/staff/data") {
      if (!authed(req)) return send(res,401,{error:"Staff login required."});
      return send(res,200,{restaurant:restaurant(),daily:daily()});
    }
    if (req.method === "POST" && url.pathname === "/api/staff/update") {
      if (!authed(req)) return send(res,401,{error:"Staff login required."});
      const body = await readBody(req);
      if (!Array.isArray(body.changes)) return send(res,400,{error:"Changes must be a list."});
      const allowed = new Set(["Availability","Sold out","Special","Price","Menu change","Opening hours","Other"]);
      for (const c of body.changes) {
        if (!allowed.has(c.type) || typeof c.value !== "string" || c.value.length > 500 || (c.item && c.item.length > 120)) return send(res,400,{error:"Please check each update type, item and value."});
      }
      const next = {updatedAt:new Date().toISOString(),updatedBy:String(body.updatedBy || "Authorised staff").slice(0,80),changes:body.changes,note:body.note || ""};
      writeJson("data/daily-update.json",next);
      return send(res,200,{ok:true, daily:next});
    }
    if (req.method === "POST" && url.pathname === "/api/staff/logout") {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (token) sessions.delete(token);
      return send(res,200,{ok:true});
    }
    const filePath = path.join(ROOT,"public",url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
    if (!filePath.startsWith(path.join(ROOT,"public"))) return send(res,403,{error:"Forbidden"});
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const types = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml"};
      return send(res,200,fs.readFileSync(filePath),types[ext] || "application/octet-stream");
    }
    return send(res,404,{error:"Not found"});
  } catch(e) { console.error(e); return send(res,500,{error:"Something went wrong."}); }
});
server.listen(PORT, "0.0.0.0", ()=>console.log(`La Table des Savoirs running on port ${PORT}`));
