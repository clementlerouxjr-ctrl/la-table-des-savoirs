const $ = s => document.querySelector(s);
const messages = $("#messages");
const form = $("#chatForm"), input = $("#question");
function addMessage(text, who="assistant", time="JUST NOW") {
  const wrap=document.createElement("div"); wrap.className=`message ${who}`;
  const bubble=document.createElement("div"); bubble.className="bubble"; bubble.textContent=text;
  const stamp=document.createElement("span"); stamp.className="message-time"; stamp.textContent=time;
  wrap.append(bubble,stamp); messages.append(wrap); messages.scrollTop=messages.scrollHeight;
}
async function sendQuestion(text) {
  if(!text.trim()) return;
  addMessage(text,"user"); input.value=""; $("#suggestions").style.display="none";
  const pending=document.createElement("div"); pending.className="message assistant"; pending.innerHTML='<div class="bubble">Let me check that for you…</div>'; messages.append(pending); messages.scrollTop=messages.scrollHeight;
  try {
    const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text})});
    const data=await r.json(); pending.remove(); addMessage(data.answer || data.error || "Please ask the canteen team.");
    $("#modeLabel").textContent=data.mode==="llm"?"AI-powered answers":data.mode==="fallback"?"Fallback answers":"Prototype mode";
    if(data.notice) addMessage(data.notice);
  } catch(e) { pending.remove(); addMessage("I’m having trouble connecting. Please ask the canteen team directly."); }
}
form.addEventListener("submit",e=>{e.preventDefault();sendQuestion(input.value)});
document.querySelectorAll(".suggestion").forEach(b=>b.addEventListener("click",()=>sendQuestion(b.textContent)));
async function refreshStatus(){
  try {const d=await (await fetch("/api/status")).json();$("#publicUpdated").textContent=d.updatedAt?new Date(d.updatedAt).toLocaleString():"No staff update recorded";$("#modeLabel").textContent=d.llmEnabled?"AI-powered answers":"Prototype mode";}
  catch(e){}
}
refreshStatus();

let staffToken=null;
const options=["Availability","Sold out","Special","Price","Menu change","Opening hours","Other"];
function addRow(change={type:"Availability",item:"",value:""}) {
  const row=document.createElement("div");row.className="change-row";
  const sel=document.createElement("select"); options.forEach(o=>{const x=document.createElement("option");x.value=o;x.textContent=o;sel.append(x)});sel.value=change.type||"Availability";
  const item=document.createElement("input");item.placeholder="Dish / subject";item.value=change.item||"";
  const value=document.createElement("input");value.placeholder="Describe the change";value.value=change.value||"";
  const remove=document.createElement("button");remove.className="remove-row";remove.type="button";remove.textContent="×";remove.title="Remove change";remove.onclick=()=>row.remove();
  row.append(sel,item,value,remove);$("#changeRows").append(row);
}
$("#loginButton").onclick=async()=>{
  $("#loginError").textContent="";
  try {const r=await fetch("/api/staff/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:$("#staffPassword").value})});const d=await r.json();if(!r.ok)throw new Error(d.error);
    staffToken=d.token;$("#staffLogin").classList.add("hidden");$("#staffEditor").classList.remove("hidden");await loadStaff();
  } catch(e){$("#loginError").textContent=e.message;}
};
async function loadStaff(){
  const r=await fetch("/api/staff/data",{headers:{Authorization:`Bearer ${staffToken}`}});if(!r.ok)throw new Error("Please sign in again.");
  const d=await r.json();$("#changeRows").innerHTML="";(d.daily.changes||[]).forEach(c=>addRow(c));if(!d.daily.changes?.length)addRow();
  $("#lastUpdated").textContent=d.daily.updatedAt?`Last updated: ${new Date(d.daily.updatedAt).toLocaleString()} · ${d.daily.updatedBy||"Staff"}`:"Last updated: No staff update yet";
  $("#staffName").value=d.daily.updatedBy||"";
  $("#staffNote").value=d.daily.note||"";
}
$("#addChange").onclick=()=>addRow();
$("#publishButton").onclick=async()=>{
  const changes=[...document.querySelectorAll(".change-row")].map(row=>({type:row.children[0].value,item:row.children[1].value.trim(),value:row.children[2].value.trim()})).filter(c=>c.value);
  $("#publishMessage").textContent="";
  try {const r=await fetch("/api/staff/update",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${staffToken}`},body:JSON.stringify({changes,updatedBy:$("#staffName").value,note:$("#staffNote").value})});const d=await r.json();if(!r.ok)throw new Error(d.error);
    $("#publishMessage").style.color="#456d48";$("#publishMessage").textContent="Daily update published successfully.";await loadStaff();await refreshStatus();
  }catch(e){$("#publishMessage").style.color="#9a473d";$("#publishMessage").textContent=e.message;}
};
$("#logoutButton").onclick=async()=>{await fetch("/api/staff/logout",{method:"POST",headers:{Authorization:`Bearer ${staffToken}`}});staffToken=null;$("#staffEditor").classList.add("hidden");$("#staffLogin").classList.remove("hidden");$("#staffPassword").value="";};
if(location.hash==="#staff") setTimeout(()=>$("#staff").scrollIntoView(),100);
