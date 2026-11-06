const localStorage=window.parent.__skCandidateStorage; // 부모 앱의 격리된 영구 저장소

// 체크박스 저장
const checks = document.querySelectorAll('input[type="checkbox"]');
checks.forEach(chk => {
const key = 'travel_v4_' + chk.dataset.id;
chk.checked = localStorage.getItem(key) === '1';
chk.addEventListener('change', () => {
const previous=localStorage.getItem(key);try{const value=chk.checked?'1':'0';localStorage.setItem(key,value);if(localStorage.getItem(key)!==value)throw Error('readback');}catch(e){chk.checked=previous==='1';alert('체크 상태 저장을 확인하지 못했습니다. 다시 확인해 주세요.');}
});
});
function toggleAll(open) {
document.querySelectorAll('details').forEach(d => d.open = open);
}
function resetChecks() {
if (!confirm('체크한 항목을 모두 초기화할까요?')) return;
checks.forEach(chk => {
chk.checked = false;
localStorage.removeItem('travel_v4_' + chk.dataset.id);
});
}
// 메모 기능
const MEMO_KEY = 'travel_v4_memos';
function getMemos() {
const raw=localStorage.getItem(MEMO_KEY);if(raw===null)return [];
try{const data=JSON.parse(raw);if(!Array.isArray(data))throw Error('format');return data;}
catch(e){alert('기존 메모 형식을 읽을 수 없어 변경을 중단합니다.');throw e;}
}
function saveMemos(arr) {
const old=localStorage.getItem(MEMO_KEY),value=JSON.stringify(arr);try{localStorage.setItem(MEMO_KEY,value);if(localStorage.getItem(MEMO_KEY)!==value)throw Error('readback');}catch(e){try{if(old===null)localStorage.removeItem(MEMO_KEY);else localStorage.setItem(MEMO_KEY,old)}catch(_){}alert('메모 저장을 확인하지 못했습니다. 기존 내용을 확인하세요.');throw e;}
}
function renderMemos() {
const container = document.getElementById('savedMemos');
let memos;try{memos=getMemos()}catch(e){container.textContent='기존 메모를 읽지 못했습니다. 데이터는 변경하지 않았습니다.';return;}
if (memos.length === 0) {
container.innerHTML = '';
return;
}
container.innerHTML = memos.map((m, i) =>
'<div class="saved-memo-item">' +
'<span>' + String(m).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])) + '</span>' +
'<button class="del-btn" onclick="deleteMemo(' + i + ')">삭제</button>' +
'</div>'
).join('');
}
function addMemo() {
const input = document.getElementById('memoInput');
const text = input.value.trim();
if (!text) { alert('메모를 입력해 주세요.'); return; }
const memos = getMemos();
memos.push(text);
saveMemos(memos);
input.value = '';
renderMemos();
}
function deleteMemo(index) {
const memos = getMemos();
memos.splice(index, 1);
saveMemos(memos);
renderMemos();
}
function clearAllMemos() {
if (!confirm('저장된 메모를 모두 삭제할까요?')) return;
saveMemos([]);
renderMemos();
}
renderMemos();

 // ----- 사용자 추가 항목 (섹션 1~5) -----
 const EX_KEY = 'travel_v4_extras';
 function getEx(){const raw=localStorage.getItem(EX_KEY);if(raw===null)return {};try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('format');return value;}catch(e){alert('기존 추가 준비물 자료의 형식이 잘못되어 변경을 중단합니다.');throw e;}}
 function saveEx(o){ const old=localStorage.getItem(EX_KEY),v=JSON.stringify(o);try{localStorage.setItem(EX_KEY,v);if(localStorage.getItem(EX_KEY)!==v)throw Error('readback');}catch(e){try{if(old===null)localStorage.removeItem(EX_KEY);else localStorage.setItem(EX_KEY,old);}catch(_){}alert('추가 목록의 저장을 확인하지 못했습니다. 목록을 확인해 주세요.');throw e;} }
 function renderExtras(){
  document.querySelectorAll('details').forEach((d, idx) => {
   if (idx > 4) return;
   const content = d.querySelector('.content'); if (!content) return;
   const old = content.querySelector('.extras'); if (old) old.remove();
   const wrap = document.createElement('div');
   wrap.className = 'extras group';
   const list = getEx()[String(idx)] || [];
   if (list.length){
    const grid = document.createElement('div');
    grid.className = 'check-grid';
    list.forEach((it, i) => {
     const lb = document.createElement('label');
     lb.className = 'item span-2';
     const cb = document.createElement('input');
     cb.type = 'checkbox'; cb.dataset.id = it.id;
     cb.checked = localStorage.getItem('travel_v4_' + it.id) === '1';
     cb.addEventListener('change', () => { const k='travel_v4_'+it.id,old=localStorage.getItem(k);try{const v=cb.checked?'1':'0';localStorage.setItem(k,v);if(localStorage.getItem(k)!==v)throw Error('readback');}catch(e){cb.checked=old==='1';alert('체크 저장을 확인하지 못했습니다.');} });
     lb.appendChild(cb);
     const sp = document.createElement('span'); sp.textContent = it.text;
     lb.appendChild(sp);
     const del = document.createElement('button');
     del.type = 'button'; del.textContent = '✕'; del.title = '삭제';
     del.style.cssText = 'margin-left:auto;background:none;border:none;color:#aab3c5;font-size:12px;padding:2px 2px 2px 6px;cursor:pointer;flex:none;font-weight:bold';
     del.onclick = e => { e.preventDefault(); if(!confirm('이 추가 준비물을 삭제할까요?'))return;
      const o = getEx(); o[String(idx)].splice(i, 1); saveEx(o); renderExtras(); };
     const edit = document.createElement('button'); edit.type='button'; edit.textContent='수정';
     edit.onclick=e=>{e.preventDefault();const value=prompt('항목 이름 수정',it.text);if(value===null||!value.trim())return;const o=getEx();o[String(idx)][i].text=value.trim();saveEx(o);renderExtras();};
     lb.appendChild(edit); lb.appendChild(del);
     grid.appendChild(lb);
    });
    wrap.appendChild(grid);
   }
   const btn = document.createElement('button');
   btn.type = 'button'; btn.textContent = '＋ 항목 추가';
   btn.style.cssText = 'width:100%;margin-top:8px;background:#fff;color:#1f6feb;border:1.5px dashed #9cc0ff;padding:9px;font-size:14px';
   const form = document.createElement('div');
   form.style.cssText = 'display:none;margin-top:8px;gap:6px';
   const input = document.createElement('input');
   input.type = 'text'; input.placeholder = '추가할 준비물 이름';
   input.style.cssText = 'flex:1;border:1px solid #cce0ff;border-radius:8px;padding:9px;font-size:14px';
   const sv = document.createElement('button');
   sv.type = 'button'; sv.textContent = '저장'; sv.className = 'small';
   sv.onclick = () => {
    const txt = input.value.trim(); if (!txt) return;
    const o = getEx(); const k = String(idx);
    (o[k] = o[k] || []).push({ id: 'x' + idx + '_' + Date.now(), text: txt });
    saveEx(o); renderExtras();
   };
   input.addEventListener('keydown', e => { if (e.key === 'Enter') sv.click(); });
   btn.onclick = () => {
    const open = form.style.display === 'flex';
    form.style.display = open ? 'none' : 'flex';
    if (!open) input.focus();
   };
   form.appendChild(input); form.appendChild(sv);
   wrap.appendChild(btn); wrap.appendChild(form);
   content.appendChild(wrap);
  });
 }
 renderExtras();
 function parsePackingImport(raw){
  raw=String(raw||'').trim();if(!raw)return [];
  let vals;if(raw[0]==='['||raw[0]==='{'){const data=JSON.parse(raw);vals=Array.isArray(data)?data:data.items;if(!Array.isArray(vals))throw Error('JSON에는 items 배열이 필요합니다.');}
  else vals=raw.split(/\r?\n/).map(x=>x.replace(/^\s*[-*•]\s*/,''));
  return vals.map(x=>typeof x==='string'?x:(x&&typeof x.text==='string'?x.text:'')).map(x=>x.trim()).filter(Boolean);
 }
 function packingName(x){return x.replace(/\s+/g,' ').trim().toLocaleLowerCase();}
 document.getElementById('packCompare').onclick=()=>{
  const preview=document.getElementById('packImportPreview');preview.textContent='';let incoming;
  try{incoming=parsePackingImport(document.getElementById('packImportText').value);if(!incoming.length)throw Error('가져올 항목이 없습니다.');if(incoming.length>500)throw Error('한 번에 500개 이하로 입력하세요.');}catch(e){preview.textContent='입력 오류: '+e.message;return;}
  const original=localStorage.getItem(EX_KEY), existing=new Set();
  document.querySelectorAll('label.item').forEach(lb=>{const sp=lb.querySelector('span');const text=sp?sp.textContent:Array.from(lb.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('');if(text.trim())existing.add(packingName(text));});
  const seen=new Set(), choices=[];incoming.forEach(text=>{const key=packingName(text),duplicate=existing.has(key)||seen.has(key);seen.add(key);const label=document.createElement('label');label.style.cssText='display:block;padding:6px';const cb=document.createElement('input');cb.type='checkbox';cb.disabled=duplicate;label.appendChild(cb);label.appendChild(document.createTextNode((duplicate?' 중복 · ':' 신규 · ')+text));preview.appendChild(label);choices.push({text,cb});});
  const message=document.createElement('p');message.textContent='동일한 이름은 중복으로 분류합니다. 변경 추정은 하지 않으며, 신규 항목만 선택해 첫 번째 준비 섹션에 추가합니다.';preview.prepend(message);
  const apply=document.createElement('button');apply.type='button';apply.textContent='선택한 항목 추가';preview.appendChild(apply);
  apply.onclick=()=>{try{
   if(localStorage.getItem(EX_KEY)!==original)throw Error('목록이 변경되었습니다. 다시 비교하세요.');
   const selected=choices.filter(x=>x.cb.checked&&!x.cb.disabled);if(!selected.length)throw Error('신규 항목을 선택하세요.');
   const current=original===null?{}:JSON.parse(original);if(!current||typeof current!=='object'||Array.isArray(current))throw Error('기존 추가 항목 형식 오류');
   const a=current['0']||(current['0']=[]);if(!Array.isArray(a))throw Error('기존 목록 형식 오류');
   selected.forEach((x,i)=>a.push({id:'import_'+Date.now()+'_'+i+'_'+Math.random().toString(36).slice(2,8),text:x.text}));
   const val=JSON.stringify(current);try{localStorage.setItem(EX_KEY,val);if(localStorage.getItem(EX_KEY)!==val)throw Error('저장 재읽기 실패');}catch(err){try{if(original===null)localStorage.removeItem(EX_KEY);else localStorage.setItem(EX_KEY,original);}catch(_){}throw Error('저장 확인 실패. 목록 상태를 확인하세요.');}
   renderExtras();preview.textContent=selected.length+'개 추가 · 저장 재읽기 확인. 기존 체크 상태는 유지했습니다.';
  }catch(e){preview.textContent='적용 실패: '+e.message;}};
 };

 function startVoice() {
  if (!confirm('브라우저의 음성 인식은 음성 데이터를 브라우저 제공업체로 전송할 수 있습니다. 계속할까요?')) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('이 브라우저에서는 음성 입력이 안 돼요. 크롬에서 열어 보세요.'); return; }
  const rec = new SR();
  rec.lang = 'ko-KR';
  const btn = document.getElementById('micBtn');
  btn.textContent = '⏺️ 듣는 중…';
  rec.onresult = e => {
    let said = '';
    for (const r of e.results) said += r[0].transcript;
    const ta = document.getElementById('memoInput');
    ta.value = (ta.value ? ta.value + ' ' : '') + said;
  };
  rec.onend = () => { btn.textContent = '🎤 말로 입력'; };
  rec.onerror = () => { btn.textContent = '🎤 말로 입력'; alert('음성을 못 알아들었어요. 다시 말씀해 주세요.'); };
  rec.start();
 }
