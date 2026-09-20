(function(){
"use strict";
const api=window.HyperTechAuth.request;
const state={tab:"items",data:{},summary:{}};
const config={
 items:{title:"الأصناف",endpoint:"/foundation/items",fields:[["code","الكود","text"],["name","الاسم","text"],["itemType","نوع الصنف","select",[["raw_material","خامة"],["wip","تحت التشغيل"],["finished_good","منتج تام"],["packaging","تعبئة وتغليف"],["consumable","مستهلكات"]]],["baseUnit","الوحدة الأساسية","text"]],columns:[["code","الكود"],["name","الاسم"],["itemType","النوع"],["baseUnit","الوحدة"],["status","الحالة"]]},
 conversions:{title:"تحويلات الوحدات",endpoint:"/foundation/items",fields:[["fromUnit","من وحدة","text"],["toUnit","إلى وحدة","text"],["factor","المعامل","text"]],columns:[["fromUnit","من"],["toUnit","إلى"],["factor","المعامل"]]},
  locations:{title:"المواقع",endpoint:"/foundation/locations",fields:[["code","الكود","text"],["name","الاسم","text"],["locationType","النوع","text"]],columns:[["code","الكود"],["name","الاسم"],["locationType","النوع"],["active","الحالة"]]},
 "work-centers":{title:"مراكز العمل",endpoint:"/foundation/work-centers",fields:[["code","الكود","text"],["name","الاسم","text"]],columns:[["code","الكود"],["name","الاسم"],["active","الحالة"]]},
 machines:{title:"الماكينات",endpoint:"/foundation/machines",fields:[["code","الكود","text"],["name","الاسم","text"],["workCenterId","مركز العمل","select","__workcenters__"]],columns:[["code","الكود"],["name","الاسم"],["status","الحالة"]]},
 shifts:{title:"الورديات",endpoint:"/foundation/shifts",fields:[["code","الكود","text"],["name","الاسم","text"],["startTime","بداية الوردية","time"],["endTime","نهاية الوردية","time"]],columns:[["code","الكود"],["name","الاسم"],["startTime","من"],["endTime","إلى"]]},
 transitions:{title:"الانتقالات",endpoint:"/foundation/transitions",fields:[["entityType","نوع الكيان","select",[["production_order","أمر إنتاج"],["production_operation","عملية إنتاج"],["batch","دفعة"],["quality_lot","تشغيلة جودة"]]],["fromState","من حالة","text"],["toState","إلى حالة","text"]],columns:[["entityType","الكيان"],["fromState","من"],["toState","إلى"],["active","الحالة"]]},
 "number-sequences":{title:"عدادات المستندات",endpoint:"/foundation/number-sequences",fields:[["sequenceKey","المفتاح","select",[["production_order","أمر إنتاج (production_order)"],["production_batch","دفعة إنتاج (production_batch)"],["production_operation","عملية إنتاج (production_operation)"],["production_ncr","بلاغ عدم مطابقة (production_ncr)"],["production_plan","خطة إنتاج (production_plan)"],["purchase_requisition","طلب شراء (purchase_requisition)"],["operations_case","حالة تشغيلية (operations_case)"]]],["prefix","البادئة","text"],["nextValue","القيمة التالية","number"],["padding","عدد الخانات","number"]],columns:[["sequenceKey","المفتاح"],["prefix","البادئة"],["nextValue","التالي"],["padding","الخانات"],["active","الحالة"]]},
  audit:{title:"سجل التدقيق",endpoint:"/foundation/audit",fields:[],columns:[["entityType","الكيان"],["action","العملية"],["actorId","معرّف المستخدم"],["actorRole","الدور"],["createdAt","التاريخ"]]}
};
const $=id=>document.getElementById(id), esc=v=>window.escHtml(v??"");
// Phase 03 (delivery 3): governed lifecycle status labels for foundation_items.
const STATUS_LABELS={draft:"مسودة",pending_approval:"بانتظار الاعتماد",active:"نشط",superseded:"مستبدل",retired:"متقاعد"};
const ITEM_TYPE_LABELS={raw_material:"خامة",wip:"تحت التشغيل",finished_good:"منتج تام",packaging:"تعبئة وتغليف",consumable:"مستهلكات"};
function setStatus(text,type=""){ $("status").textContent=text;$("status").className="status "+type; }
async function loadSummary(){try{state.summary=await api("/foundation/summary");$("summary").innerHTML=Object.entries({items:"الأصناف",locations:"المواقع",workCenters:"مراكز العمل",machines:"الماكينات",shifts:"الورديات",transitions:"الانتقالات"}).map(([k,l])=>`<div class="summary-card"><strong>${esc(state.summary[k])}</strong><span>${l}</span></div>`).join("")}catch(e){setStatus(e.message,"error")}}
const TAB_NOTES={
  transitions:"ℹ️ الجدول ده أداة اختبار داخلية بس — بتتأكد لو قاعدة انتقال حالة معينة منطقية، لكنها مش متصلة فعليًا بتصرف الشاشات التانية (زي أمر الإنتاج) دلوقتي. مش لازم تضيف/تعدّل هنا في الاستخدام العادي.",
  "number-sequences":"ℹ️ ده بيتحكم في شكل أرقام المستندات التلقائية (زي PO-000001 لأمر الإنتاج). الـ7 عدادات الأساسية متظبطة تلقائيًا من الإعداد الأول، مش محتاج تضيف حاجة هنا في الاستخدام العادي — بس تقدر تعدّل البادئة أو عدد الخانات لو حبيت.",
};
async function load(){const c=config[state.tab];$("tableTitle").textContent=c.title;$("search").style.display=["audit","conversions"].includes(state.tab)?"none":"";$("conversionItem").hidden=state.tab!=="conversions";const isItems=state.tab==="items";$("duplicatesBtn").hidden=!isItems;$("importBtn").hidden=!isItems;$("exportBtn").hidden=!isItems;const note=TAB_NOTES[state.tab];$("tabNote").style.display=note?"":"none";$("tabNote").textContent=note||"";try{setStatus("جارٍ التحميل…");if(state.tab==="conversions"){const items=state.data.items||(await api("/foundation/items"));state.data.items=items;$("conversionItem").innerHTML=items.length?items.map(i=>`<option value="${esc(i.id)}">${esc(i.code)} — ${esc(i.name)}</option>`).join(""):`<option value="">لا توجد أصناف معرفة</option>`;$("conversionItem").disabled=!items.length;$("addBtn").disabled=!items.length;const itemId=$("conversionItem").value;state.data.conversions=itemId?await api(`/foundation/items/${encodeURIComponent(itemId)}/conversions`):[]}else{$("conversionItem").disabled=false;$("addBtn").disabled=false;const q=$("search").value.trim();state.data[state.tab]=await api(c.endpoint+(q?`?search=${encodeURIComponent(q)}`:""))}render();setStatus(`${(state.data[state.tab]||[]).length} سجل`,"success")}catch(e){setStatus(e.message,"error");$("tableBody").innerHTML=""}}
function render(){const c=config[state.tab],rows=state.data[state.tab]||[],canToggle=["items","locations","work-centers"].includes(state.tab),isItems=state.tab==="items";$("tableHead").innerHTML=`<tr>${c.columns.map(x=>`<th>${x[1]}</th>`).join("")}<th>إجراء</th></tr>`;$("tableBody").innerHTML=rows.length?rows.map(r=>`<tr>${c.columns.map(([k])=>`<td>${esc(k==="active"?(r[k]?"نشط":"غير نشط"):k==="status"?(STATUS_LABELS[r[k]]||r[k]):k==="itemType"?(ITEM_TYPE_LABELS[r[k]]||r[k]):r[k])}</td>`).join("")}<td>${["audit","conversions","transitions"].includes(state.tab)?"—":`<button class="button" data-edit="${esc(r.id)}">تعديل</button>`}${canToggle?` <button class="button" data-toggle="${esc(r.id)}">${r.active?"إلغاء تفعيل":"تفعيل"}</button>`:""}${isItems?` <button class="button" data-history="${esc(r.id)}">السجل</button> <button class="button" data-aliases="${esc(r.id)}">بدائل</button>`:""}${isItems&&r.status==="pending_approval"?` <button class="button primary" data-approve="${esc(r.id)}">اعتماد</button> <button class="button" data-reject="${esc(r.id)}">رفض</button>`:""}</td></tr>`).join(""):`<tr><td colspan="${c.columns.length+1}">لا توجد بيانات للعرض.</td></tr>`}
// Phase 03 (delivery 1): "Inactivation cannot silently break open work." The
// backend blocks true -> false when active references exist and returns
// code INACTIVATION_BLOCKED with details = [{type,count,label}]. This
// handler shows those blockers and lets the user supply an explicit
// overrideReason to proceed — never bypasses the check silently.
async function toggleActive(id){
  const c=config[state.tab];
  const row=(state.data[state.tab]||[]).find(x=>String(x.id)===String(id));
  if(!row)return;
  const turningOff=!!row.active;
  if(turningOff&&!confirm(`متأكد من إلغاء تفعيل "${row.name||row.code||id}"؟`))return;
  try{
    await api(`${c.endpoint}/${id}`,{method:"PATCH",body:JSON.stringify({active:!turningOff})});
    await Promise.all([load(),loadSummary()]);
    setStatus("تم تحديث الحالة بنجاح","success");
  }catch(err){
    if(err.code==="INACTIVATION_BLOCKED"&&Array.isArray(err.details)){
      const list=err.details.map(b=>`- ${b.label}: ${b.count}`).join("\n");
      const reason=prompt(`لا يمكن إلغاء التفعيل — توجد مراجع نشطة:\n${list}\n\nاكتب سببًا صريحًا لتأكيد القرار رغم ذلك، أو اترك الحقل فارغًا للإلغاء:`,"");
      if(!reason||!reason.trim()){setStatus("تم إلغاء العملية","");return}
      try{
        await api(`${c.endpoint}/${id}`,{method:"PATCH",body:JSON.stringify({active:false,overrideReason:reason.trim()})});
        await Promise.all([load(),loadSummary()]);
        setStatus("تم إلغاء التفعيل مع تسجيل سبب تجاوز التبعيات","success");
      }catch(err2){setStatus(err2.message,"error")}
      return;
    }
    setStatus(err.message,"error");
  }
}
function fmtDate(v){try{return new Date(v).toLocaleString("ar-EG")}catch{return v}}
async function approveChange(id){
  if(!confirm("اعتماد التغيير المقترح على هذا الصنف؟"))return;
  try{
    await api(`/foundation/items/${id}/approve`,{method:"POST",body:JSON.stringify({})});
    await Promise.all([load(),loadSummary()]);
    setStatus("تم اعتماد التغيير","success");
  }catch(err){setStatus(err.message,"error")}
}
async function rejectChange(id){
  const reason=prompt("سبب رفض التغيير المقترح (اختياري):","");
  if(reason===null)return;
  try{
    await api(`/foundation/items/${id}/reject`,{method:"POST",body:JSON.stringify(reason.trim()?{reason:reason.trim()}:{})});
    await Promise.all([load(),loadSummary()]);
    setStatus("تم رفض التغيير المقترح","success");
  }catch(err){setStatus(err.message,"error")}
}
async function showHistory(id){
  try{
    const rows=await api(`/foundation/items/${id}/history`);
    if(!rows.length){alert("لا يوجد سجل تغييرات سابق لهذا الصنف بعد.");return}
    alert(rows.map(v=>`إصدار ${v.version} — ${v.changedByName||v.changedById||"—"} — ${fmtDate(v.createdAt)}${v.changeReason?`\nالسبب: ${v.changeReason}`:""}`).join("\n\n"));
  }catch(err){setStatus(err.message,"error")}
}
async function manageAliases(id){
  try{
    const aliases=await api(`/foundation/items/${id}/aliases`);
    const list=aliases.length?aliases.map(a=>`#${a.id}: ${a.alias}`).join("\n"):"لا توجد أسماء بديلة بعد.";
    const action=prompt(`${list}\n\nاكتب اسمًا بديلًا لإضافته، أو "حذف:رقم" لحذف اسم موجود، أو اترك الحقل فارغًا للإلغاء:`,"");
    if(!action||!action.trim())return;
    const trimmed=action.trim();
    if(trimmed.startsWith("حذف:")){
      const aliasId=trimmed.slice(4).trim();
      await api(`/foundation/items/${id}/aliases/${encodeURIComponent(aliasId)}`,{method:"DELETE"});
      setStatus("تم حذف الاسم البديل","success");
    }else{
      await api(`/foundation/items/${id}/aliases`,{method:"POST",body:JSON.stringify({alias:trimmed})});
      setStatus("تمت إضافة الاسم البديل","success");
    }
  }catch(err){setStatus(err.message,"error")}
}
async function showDuplicates(){
  try{
    setStatus("جارٍ فحص التكرارات…");
    const r=await api("/foundation/items/duplicates");
    const lines=[];
    if(r.byName?.length)lines.push("تكرار بالاسم:\n"+r.byName.map(g=>`- ${g.names.join(" / ")} (أكواد: ${g.codes.join(", ")})`).join("\n"));
    if(r.byCode?.length)lines.push("تكرار بالكود (بصرف النظر عن حالة الأحرف):\n"+r.byCode.map(g=>`- معرّفات: ${g.item_ids.join(", ")}`).join("\n"));
    alert(lines.length?lines.join("\n\n"):"لم يتم العثور على أصناف مكررة محتملة.");
    setStatus("تم فحص التكرارات","success");
  }catch(err){setStatus(err.message,"error")}
}
async function runImport(){
  const text=prompt("الصق مصفوفة JSON من الأصناف (code, name, baseUnit إجباري لكل صف):","[]");
  if(!text||!text.trim())return;
  let rows;
  try{rows=JSON.parse(text)}catch{setStatus("النص ليس JSON صالحًا","error");return}
  if(!Array.isArray(rows)||!rows.length){setStatus("يجب أن يكون JSON مصفوفة غير فارغة","error");return}
  try{
    const preview=await api("/foundation/items/import",{method:"POST",body:JSON.stringify({rows,dryRun:true})});
    const errLines=preview.results.filter(x=>!x.ok).map(x=>`صف ${x.row}: ${x.errors.join("، ")}`);
    if(errLines.length){alert(`توجد أخطاء — لن يتم تنفيذ أي استيراد:\n\n${errLines.join("\n")}`);return}
    if(!confirm(`${preview.totalRows} صف جاهز للاستيراد (بدون أخطاء). تنفيذ الاستيراد فعليًا؟`))return;
    const applied=await api("/foundation/items/import",{method:"POST",body:JSON.stringify({rows,dryRun:false})});
    await Promise.all([load(),loadSummary()]);
    setStatus(`تم استيراد ${applied.applied.length} صف`,"success");
  }catch(err){setStatus(err.message,"error")}
}
async function runExport(){
  try{
    const rows=await api("/foundation/items/export");
    const blob=new Blob([JSON.stringify(rows,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);a.download="foundation-items.json";a.click();
    URL.revokeObjectURL(a.href);
    setStatus("تم تصدير الأصناف","success");
  }catch(err){setStatus(err.message,"error")}
}
async function openForm(id){const c=config[state.tab];if(!c.fields.length)return;const row=(state.data[state.tab]||[]).find(x=>String(x.id)===String(id))||{};$("dialogTitle").textContent=id?"تعديل سجل":"إضافة سجل";
  // بعض حقول الـselect (زي مركز العمل) بياناتها ديناميكية مش معروفة وقت
  // تعريف الإعدادات، فبنجيبها هنا أول ما اليوزر يفتح النموذج بدل ما
  // نسيب المستخدم يكتب رقم ID يدوي (كان كده قبل كده في حقل الماكينات).
  const resolvedFields=await Promise.all(c.fields.map(async([k,l,t,opts])=>{
    if(t==="select"&&opts==="__workcenters__"){
      try{
        const centers=await api("/foundation/work-centers");
        opts=(centers||[]).filter(wc=>wc.active).map(wc=>[String(wc.id),`${wc.code} — ${wc.name}`]);
      }catch(e){opts=[]}
    }
    return[k,l,t,opts];
  }));
  $("formFields").innerHTML=resolvedFields.map(([k,l,t,opts])=>t==="select"?`<label class="field">${l}<select name="${k}" required><option value="">-- اختار --</option>${(opts||[]).map(([v,ol])=>`<option value="${esc(v)}" ${String(row[k])===String(v)?"selected":""}>${esc(ol)}</option>`).join("")}</select></label>`:`<label class="field">${l}<input name="${k}" type="${t}" value="${esc(row[k])}" required></label>`).join("");$("entityDialog").dataset.id=id||"";$("entityDialog").showModal()}
async function save(e){e.preventDefault();const c=config[state.tab],id=$("entityDialog").dataset.id;const body=Object.fromEntries(new FormData($("entityForm")));Object.keys(body).forEach(k=>{if(body[k]==="")delete body[k];else if(["number","workCenterId"].includes(c.fields.find(f=>f[0]===k)?.[2]))body[k]=Number(body[k])});const selectedItem=$("conversionItem").value;if(state.tab==="conversions"&&!selectedItem){$("entityDialog").close();setStatus("أنشئ صنفًا أساسيًا أولًا قبل إضافة تحويل وحدات","error");return}const endpoint=state.tab==="conversions"?`/foundation/items/${encodeURIComponent(selectedItem)}/conversions`:c.endpoint+(id?`/${id}`:"");try{await api(endpoint,{method:id?"PATCH":"POST",body:JSON.stringify(state.tab==="conversions"?{...body,itemId:Number(selectedItem)}:body)});$("entityDialog").close();await Promise.all([load(),loadSummary()]);setStatus("تم حفظ السجل بنجاح","success")}catch(err){setStatus(err.message,"error")}}
document.addEventListener("DOMContentLoaded",()=>{document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelector(".tab.active").classList.remove("active");b.classList.add("active");state.tab=b.dataset.tab;load()});$("refreshBtn").onclick=()=>Promise.all([load(),loadSummary()]);$("search").oninput=()=>load();$("conversionItem").onchange=()=>load();$("addBtn").onclick=()=>openForm();$("entityForm").onsubmit=save;$("tableBody").onclick=e=>{
  const edit=e.target.closest("[data-edit]");if(edit){openForm(edit.dataset.edit);return}
  const toggle=e.target.closest("[data-toggle]");if(toggle){toggleActive(toggle.dataset.toggle);return}
  const approve=e.target.closest("[data-approve]");if(approve){approveChange(approve.dataset.approve);return}
  const reject=e.target.closest("[data-reject]");if(reject){rejectChange(reject.dataset.reject);return}
  const history=e.target.closest("[data-history]");if(history){showHistory(history.dataset.history);return}
  const aliases=e.target.closest("[data-aliases]");if(aliases){manageAliases(aliases.dataset.aliases);return}
};
$("duplicatesBtn").onclick=showDuplicates;$("importBtn").onclick=runImport;$("exportBtn").onclick=runExport;loadSummary();load()});
document.addEventListener("DOMContentLoaded",()=>{$("checkBtn").onclick=async()=>{const out=$("checkResult"),from=$("checkFrom").value.trim(),to=$("checkTo").value.trim();out.className="status";if(!from||!to){out.className="status error";out.textContent="أدخل الحالة الحالية والحالة المطلوبة أولًا.";return}if(from===to){out.className="status error";out.textContent="يجب أن تختلف الحالة المطلوبة عن الحالية.";return}out.textContent="جارٍ التحقق…";try{const r=await api("/foundation/validate-transition",{method:"POST",body:JSON.stringify({entityType:$("checkEntity").value,fromState:from,toState:to})});out.className="status success";out.textContent=r.allowed?"الانتقال مسموح وفق قاعدة الحوكمة الحالية.":"الانتقال غير مسموح."}catch(e){out.className="status error";out.textContent=e.message}}});
})();