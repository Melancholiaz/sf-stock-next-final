/** SF Stock Desktop – ล็อกอิน, สิทธิ์แอดมิน, ประวัติการแก้ไข, สำรองข้อมูล */
const API_URL = "/api";
let state = { groups: [] };
let isHistoryMode = false;
let currentHistoryId = null;
let currentCalcTarget = null;

const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} },
    del: (k) => { try { localStorage.removeItem(k); } catch(e) {} },
};
// ปิดระบบล็อกอินชั่วคราว: ใช้ผู้ใช้เริ่มต้น (เซิร์ฟเวอร์ตัดสินสิทธิ์จริงจาก auth_default_role)
LS.del('sf_auth_desktop');
let auth = { token: '', nickname: 'ผู้ใช้', role: 'admin' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const $id = (x) => document.getElementById(x);

class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(action, body = null, extraQuery = '') {
    let res;
    try {
        res = await fetch(`${API_URL}?action=${action}${extraQuery}`, {
            method: body ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Auth-Token': auth.token } : {}) },
            body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
        });
    } catch (e) { throw new ApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 0); }
    let data = null; try { data = await res.json(); } catch(e) {}
    if (!res.ok || !data || data.status !== 'success') throw new ApiError(data?.msg || `เซิร์ฟเวอร์ผิดพลาด (${res.status})`, res.status);
    return data;
}

let toastTimer = null;
function toast(msg, isErr = false) {
    const t = $id('toast'); t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', isErr ? 4000 : 2000);
}

function applyRole() {
    document.body.classList.toggle('role-staff', auth?.role !== 'admin');
    $id('user-nick').textContent = auth?.nickname || '-';
    $id('user-role').textContent = auth?.role === 'admin' ? 'แอดมิน' : 'พนักงาน';
}
document.addEventListener('DOMContentLoaded', () => {
    applyRole(); loadData();
    setInterval(() => { if(!isHistoryMode && auth) loadData(); }, 3000);

    const btnAdd = $id('btn-add'); if(btnAdd) btnAdd.onclick = addRow;
    const btnSaveDaily = $id('btn-save-daily'); if(btnSaveDaily) btnSaveDaily.onclick = saveDailyStock;
    const btnHistory = $id('btn-history'); if(btnHistory) btnHistory.onclick = openHistoryModal;
    const btnDash = $id('btn-dashboard'); if(btnDash) btnDash.onclick = openDashboard;

    const dateEl = $id('current-date-display');
    if(dateEl) dateEl.textContent = new Date().toLocaleDateString('th-TH');
});

/** กำลังพิมพ์ในตารางหรือเปิดหน้าต่างอยู่ → ยังไม่วาดตารางใหม่ (กันค่าที่พิมพ์หาย) */
function isBusy() {
    const a = document.activeElement;
    if (a && a.closest && a.closest('#inventory-body') && a.tagName === 'INPUT') return true;
    return !$id('calc-modal').classList.contains('hidden');
}

async function loadData() {
    if(isHistoryMode || !auth) return;
    try {
        const data = await api('read');
        state.groups = data.groups;
        if (!state.isComparing && !isBusy()) renderTable();
    } catch(e) {}
}

async function updateDB(id, field, value) {
    let val = parseFloat(value) || 0;
    if(val < 0) val = 0;

    state.groups.forEach(g => g.items.forEach(i => {
        if(i.id === id) {
            if(field === 'unit_per_box') i.unitPerBox = val;
            else if(field === 'back_box') i.zones.back.boxQty = val;
            else if(field === 'back_piece') i.zones.back.pieceQty = val;
            else if(field === 'front_show') { if(!i.zones.front) i.zones.front={}; i.zones.front.show = val; }
            else if(field === 'c3') i.c3 = val;
            else if(field === 'daily') i.daily = val;
            else if(field === 'office') i.office = val;
            else if(field === 'booth') i.booth = val;
            else if(field === 'main') i.main = val;
        }
    }));

    if(field === 'unit_per_box') renderTable();
    if(!isHistoryMode) {
        try { await api('update', { id, field, value: val }); }
        catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, true); loadData(); }
    }
}

function updateZoneTotal(gid, pid, zone, value) { 
    const group = state.groups.find(g => g.id === gid); 
    const item = group?.items.find(i => i.id === pid); 
    if(!item) return;
    
    let newTotal = parseFloat(value) || 0;
    if(zone === 'back') {
        const unit = item.unitPerBox || 1;
        const box = Math.floor(newTotal / unit);
        const piece = parseFloat((newTotal % unit).toFixed(4));
        updateDB(pid, 'back_box', box); 
        updateDB(pid, 'back_piece', piece);
    } 
}

function detectProductType(name) {
    const n = name.toLowerCase();
    if (n.includes('corn') || n.includes('popcorn')) return 'corn';
    if (n.includes('co2')) return 'co2';
    if (n.includes('syrup') || n.includes('fanta') || n.includes('coke') || n.includes('sprite')) {
        if (n.includes('20l') || n.includes('20 l')) return 'syrup20';
        return 'syrup10';
    }
    return null;
}

const ZONE_LABEL = { back_syrup: 'Syrup', back_component: 'Component', back_daily: 'Daily', front_1: 'เครื่อง 1', front_2: 'เครื่อง 2', front_3: 'เครื่อง 3', front_show: 'ตัวโชว์', booth: 'Booth', main: 'MAIN' };
function confBadge(item) {
    const z = item.confirmedZones && !Array.isArray(item.confirmedZones) ? Object.entries(item.confirmedZones) : [];
    if (!z.length || isHistoryMode) return '';
    const tip = z.map(([k, v]) => `${ZONE_LABEL[k] || k}: ${v.by || ''} ${v.at ? v.at.slice(11, 16) : ''}`).join('\n');
    return `<span class="conf-badge" title="${esc(tip)}">✓ ${z.length}</span>`;
}

function renderTable() {
    const tbody = document.getElementById('inventory-body'); if (!tbody) return; tbody.innerHTML = "";
    const compareHeader = document.getElementById('th-compare'); if (compareHeader && !state.isComparing) compareHeader.remove();

    state.groups.forEach(group => {
        const colSpan = state.isComparing ? 13 : 12;
        tbody.innerHTML += `<tr class="group-row"><td colspan="${colSpan}">${esc(group.name)}<span class="count">${group.items.length} รายการ</span></td></tr>`;
        
        group.items.forEach((item, index) => {
            const unit = item.unitPerBox || 1;
            
            const mShow = parseFloat(item.zones.front?.show || 0);
            const c1 = parseFloat(((item.zones.back.boxQty||0) * unit + (item.zones.back.pieceQty||0)).toFixed(4));
            
            const m1 = item.zones.front?.m1 || 0;
            const m2 = item.zones.front?.m2 || 0;
            const m3 = item.zones.front?.m3 || 0;
            const c2 = parseFloat((m1 + m2 + m3).toFixed(4)); // C2 คือผลรวมเครื่อง 1,2,3
            
            const c3 = parseFloat(item.c3) || 0;
            
            // TOTAL = C1 + C2 + C3 + SHOW (ตัวโชว์)
            const total = parseFloat((c1 + c2 + mShow + c3).toFixed(4));

            const calcType = detectProductType(item.name);
            let calcBtn = (calcType && !isHistoryMode) ? `<button type="button" class="btn-calc-tiny" onclick="openAutoCalc('${item.id}', '${calcType}', 'main')" title="คำนวณ ${esc(item.name)}">🧮</button>` : '';

            let compareHtml = '';
            if (state.isComparing && item.compare) { 
                const diff = item.compare.diff; const excelVal = item.compare.excel;
                if (diff === 0) compareHtml = `<td><div class="cmp cmp-eq">ตรงกัน (${excelVal})</div></td>`;
                else if (diff > 0) compareHtml = `<td><div class="cmp cmp-up">+${diff} (เก่า: ${excelVal})</div></td>`;
                else compareHtml = `<td><div class="cmp cmp-down">${diff} (เก่า: ${excelVal})</div></td>`;
            } else if (state.isComparing) { compareHtml = `<td style="text-align:center; color:#B6C0CD;">–</td>`; }

            const tr = document.createElement('tr');
            tr.className = isHistoryMode ? "item-row is-history" : "item-row";
            
            tr.innerHTML = `
                <td class="col-idx">${index+1}</td>
                <td class="col-name">
                    <div class="p-name">${esc(item.name)}${confBadge(item)}</div>
                    <div class="p-meta">1 ลัง = <input type="number" step="any" class="unit-input" value="${unit}" onchange="updateDB('${item.id}', 'unit_per_box', this.value)"> ชิ้น</div>
                </td>
                <td class="z-show"><input type="number" step="any" class="cell-input show" value="${mShow}" onchange="updateDB('${item.id}', 'front_show', this.value)"></td>
                <td class="z-c1"><input type="number" step="any" class="cell-input strong" value="${c1}" onchange="updateZoneTotal('${group.id}', '${item.id}', 'back', this.value)"></td>
                <td class="z-c2"><input type="number" step="any" class="cell-input strong" value="${c2}" readonly title="ยอดจากมือถือ C1: ${m1} | C2: ${m2} | C3: ${m3}"></td>
                <td class="z-c3"><input type="number" step="any" class="cell-input" value="${c3}" onchange="updateDB('${item.id}', 'c3', this.value)"></td>
                <td class="z-daily"><input type="number" step="any" class="cell-input" value="${item.daily||0}" onchange="updateDB('${item.id}', 'daily', this.value)"></td>
                <td class="z-office"><input type="number" step="any" class="cell-input" value="${item.office||0}" onchange="updateDB('${item.id}', 'office', this.value)"></td>
                <td class="z-booth"><input type="number" step="any" class="cell-input" value="${item.booth||0}" onchange="updateDB('${item.id}', 'booth', this.value)"></td>
                <td class="z-main"><div class="main-wrap"><input type="number" step="any" class="cell-input" value="${item.main||0}" onchange="updateDB('${item.id}', 'main', this.value)">${calcBtn}</div></td>
                <td class="z-total">${total}</td>
                <td style="text-align:center">${isHistoryMode ? '' : `<button onclick="deleteItem('${group.id}', '${item.id}')" class="btn-del admin-only" title="ลบสินค้า" aria-label="ลบสินค้า"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>`}</td>
                ${compareHtml}
            `;
            tbody.appendChild(tr);
        });
    });
}

const CALC_CONFIG = {
    'syrup10': { title: "Syrup 10 ลิตร", tare: 0.45, net: 12.55, unit: "กล่อง" },
    'syrup20': { title: "Syrup 20 ลิตร", tare: 0.82, net: 25.2, unit: "กล่อง" },
    'co2':     { title: "CO2 (ถัง 9กก.)", tare: 11.5, net: 9.5, unit: "ถัง" },
    'corn':    { title: "Corn Chip", unit: "หน่วย (Each)" }
};

function openAutoCalc(id, type, field) {
    currentCalcTarget = { id, field, type };
    const config = CALC_CONFIG[type];
    document.getElementById('calc-title').innerText = config.title;
    document.getElementById('calc-unit-display').innerText = config.unit;
    document.getElementById('calc-modal').classList.remove('hidden');
    const container = document.getElementById('calc-inputs');
    container.innerHTML = (type === 'corn') ? 
        `<div class="calc-field"><label>จำนวนถาด (× 0.4)</label><input id="inp-tray" type="number" step="any" placeholder="0" oninput="liveCalc()"></div>
         <div class="calc-field"><label>จำนวนถุง</label><input id="inp-bag" type="number" step="any" placeholder="0" oninput="liveCalc()"></div>` :
        `<div class="calc-field"><label>น้ำหนักที่ชั่งได้ (กก.)</label><input id="inp-weight" type="number" step="any" placeholder="0.00" oninput="liveCalc()" autofocus></div>`;
    document.getElementById('calc-result').innerText = "0";
}

function liveCalc() {
    if (!currentCalcTarget) return;
    const type = currentCalcTarget.type;
    let result = 0;
    if (type === 'corn') {
        result = (parseFloat(document.getElementById('inp-tray').value) || 0) * 0.4 + (parseFloat(document.getElementById('inp-bag').value) || 0); 
    } else {
        const weight = parseFloat(document.getElementById('inp-weight').value) || 0;
        const cfg = CALC_CONFIG[type];
        if (weight > cfg.tare) result = (weight - cfg.tare) / cfg.net;
    }
    document.getElementById('calc-result').innerText = result > 0 ? result.toFixed(4) : "0";
}

function applyCalcResult() {
    if (!currentCalcTarget) return;
    updateDB(currentCalcTarget.id, currentCalcTarget.field, document.getElementById('calc-result').innerText);
    renderTable(); closeCalcModal();
}

function closeCalcModal() { document.getElementById('calc-modal').classList.add('hidden'); }

async function saveDailyStock(){
    if(isHistoryMode) return;
    if(!confirm("บันทึกยอดวันนี้?\n\nระบบจะเก็บยอดปัจจุบันเป็นประวัติ และล้างสถานะ \"ยืนยันแล้ว\" ทุกโซน เพื่อเริ่มนับรอบใหม่")) return;
    try { const d = await api('save_history', {}); toast(`✅ บันทึกวันที่ ${d.date} แล้ว · ล้างสถานะยืนยัน ${d.reset} รายการ`); loadData(); }
    catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, true); }
}

async function openHistoryModal(){ 
    document.getElementById('history-modal').classList.remove('hidden');
    api('get_history_list').then(d=>{
        const l=document.getElementById('history-list'); l.innerHTML="";
        d.list.forEach(h=>{ l.innerHTML+=`<button class="hist-item" onclick="loadHistoryItem(${h.id})"><span class="dot"></span>${new Date(h.record_date).toLocaleDateString('th-TH',{weekday:'short', day:'numeric', month:'short', year:'numeric'})}</button>` });
        if(!d.list.length) l.innerHTML = '<div style="color:var(--muted); padding:12px;">ยังไม่มีประวัติที่บันทึกไว้</div>';
    }); 
}

async function loadHistoryItem(id){ 
    api('get_history_detail', null, `&id=${encodeURIComponent(id)}`).then(d=>{
        if(d.status==='success'){
            state.groups=d.data; isHistoryMode=true;
            document.getElementById('history-modal').classList.add('hidden');
            document.getElementById('history-banner').classList.remove('hidden');
            document.getElementById('history-banner').innerHTML=`<span>กำลังดูประวัติวันที่ <b>${esc(d.date)}</b> (แก้ไขไม่ได้)</span><button onclick="exitHistoryMode()">กลับหน้าปัจจุบัน</button>`;
            renderTable();
        }
    }); 
}

function exitHistoryMode(){ isHistoryMode=false; document.getElementById('history-banner').classList.add('hidden'); loadData(); }
async function addRow(){
    const n = prompt("ชื่อสินค้า:"); if(!n || !n.trim()) return;
    const g = prompt("หมวดหมู่:", "สินค้าทั่วไป"); if(g === null) return;
    const u = prompt("บรรจุต่อลัง (ชิ้น):", "1"); if(u === null) return;
    try { await api('create', { id: 'p_' + Date.now(), group_name: g.trim() || 'สินค้าทั่วไป', name: n.trim(), sku: '-', unit_per_box: parseFloat(u) || 1 }); toast('เพิ่มสินค้าแล้ว'); loadData(); }
    catch (e) { toast(e.message, true); }
}
async function deleteItem(gid,pid){
    const item = state.groups.find(g => g.id === gid)?.items.find(i => i.id === pid);
    if(!confirm(`ลบ "${item?.name || 'สินค้านี้'}"?\n(ข้อมูลเดิมจะถูกเก็บไว้ในประวัติการแก้ไข)`)) return;
    try { await api('delete', { id: pid }); toast('ลบแล้ว'); loadData(); }
    catch (e) { toast(e.message, true); }
}

async function openDashboard(){ 
    document.getElementById('dashboard-modal').classList.remove('hidden'); 
    api('get_dashboard_data').then(d=>renderDashboard(d.history)).catch(e=>toast(e.message, true));
}

let myChart=null;
function renderDashboard(h){ 
    const l=[],t=[]; 
    h.reverse().forEach(r=>{
        let s=0;
        r.data.forEach(g=>g.items.forEach(i=>{
            const unit = i.unitPerBox || 1;
            const c1 = (i.zones.back.boxQty||0) * unit + (i.zones.back.pieceQty||0);
            const c2 = (i.zones.front?.m1||0) + (i.zones.front?.m2||0) + (i.zones.front?.m3||0);
            const mShow = i.zones.front?.show || 0;
            const c3 = parseFloat(i.c3) || 0;
            s += (c1 + c2 + mShow + c3);
        }));
        l.push(r.date); t.push(parseFloat(s.toFixed(2)));
    });
    document.getElementById('dash-total-current').innerText=t[t.length-1];
    const ctx=document.getElementById('stockChart').getContext('2d');
    if(myChart) myChart.destroy();
    myChart=new Chart(ctx,{type:'line',data:{labels:l,datasets:[{label:'ยอดสต็อกรวม',data:t,borderColor:'#1B63AF',backgroundColor:'rgba(27,99,175,0.10)',fill:true,pointBackgroundColor:'#1B63AF',pointRadius:4,borderWidth:2.5,tension:0.35}]},options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false}},y:{grid:{color:'#E1E8F1'}}}}});
}

function exportExactExcel() {
    if(!state.groups || state.groups.length === 0) return alert("ไม่มีข้อมูล");
    const ws_data = [
        ["#", "PRODUCTS (รายการสินค้า)", "SHOW (ตัวโชว์)", "C1 (หลังร้าน)", "C2 (หน้าร้าน)", "C3", "DAILY (ขาย)", "OFFICE", "BOOTH", "MAIN (สต็อก)", "TOTAL (รวม)"]
    ];
    let rowCount = 1;
    state.groups.forEach(group => {
        ws_data.push([group.name, "", "", "", "", "", "", "", "", "", ""]);
        group.items.forEach((item) => {
            const unit = item.unitPerBox || 1;
            const mShow = parseFloat(item.zones.front?.show || 0);
            const c1 = parseFloat(((item.zones.back.boxQty||0) * unit + (item.zones.back.pieceQty||0)).toFixed(4));
            const m1 = item.zones.front?.m1 || 0;
            const m2 = item.zones.front?.m2 || 0;
            const m3 = item.zones.front?.m3 || 0;
            const c2 = parseFloat((m1 + m2 + m3).toFixed(4));
            const c3 = parseFloat(item.c3) || 0;
            const total = parseFloat((c1 + c2 + mShow + c3).toFixed(4));

            ws_data.push([
                rowCount++, item.name, mShow, c1, c2, c3, item.daily||0, item.office||0, item.booth||0, item.main||0, total
            ]);
        });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const range = XLSX.utils.decode_range(ws['!ref']);
    const colors = { header: "F3F4F6", group: "E5E7EB", show: "F3E8FF", c1_c2: "EFF6FF", c3: "FEFCE8", daily: "FEF08A", office: "DBEAFE", booth: "FEE2E2", main: "F9FAFB", total: "DBEAFE" };

    for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const addr = XLSX.utils.encode_cell({r: R, c: C});
            if (!ws[addr]) continue;
            let style = { font: { name: "Sarabun", sz: 11 }, border: { top: {style:"thin",color:{rgb:"E5E7EB"}}, bottom: {style:"thin",color:{rgb:"E5E7EB"}}, left: {style:"thin",color:{rgb:"E5E7EB"}}, right: {style:"thin",color:{rgb:"E5E7EB"}} }, alignment: { vertical: "center", horizontal: "center" } };
            if (C === 1) style.alignment.horizontal = "left";
            if (R === 0) { style.fill = { fgColor: { rgb: colors.header } }; style.font = { bold: true }; }
            else if (ws[XLSX.utils.encode_cell({r: R, c: 1})].v && !ws[XLSX.utils.encode_cell({r: R, c: 0})].v) { style.fill = { fgColor: { rgb: colors.group } }; style.font = { bold: true }; style.alignment.horizontal = "left"; }
            else {
                if (C === 2) style.fill = { fgColor: { rgb: colors.show } };
                else if (C === 3 || C === 4) style.fill = { fgColor: { rgb: colors.c1_c2 } };
                else if (C === 5) style.fill = { fgColor: { rgb: colors.c3 } };
                else if (C === 6) style.fill = { fgColor: { rgb: colors.daily } };
                else if (C === 7) style.fill = { fgColor: { rgb: colors.office } };
                else if (C === 8) style.fill = { fgColor: { rgb: colors.booth } };
                else if (C === 9) style.fill = { fgColor: { rgb: colors.main } };
                else if (C === 10) { style.fill = { fgColor: { rgb: colors.total } }; style.font = { bold: true, color: { rgb: "1E40AF" } }; }
            }
            ws[addr].s = style;
        }
    }
    ws['!cols'] = [{wch:5}, {wch:40}, {wch:12}, {wch:12}, {wch:12}, {wch:12}, {wch:12}, {wch:12}, {wch:12}, {wch:12}, {wch:15}];
    XLSX.utils.book_append_sheet(wb, ws, "StockData");
    XLSX.writeFile(wb, `SF_Stock_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function importAndCompareExcel(input) { const file = input.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = function(e) { const data = new Uint8Array(e.target.result); const workbook = XLSX.read(data, {type: 'array'}); const firstSheet = workbook.Sheets[workbook.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(firstSheet, {header: 1}); let headerRowIndex = -1; for(let i = 0; i < Math.min(rows.length, 20); i++) { const row = rows[i]; if (row && row.some(cell => cell && (cell.toString().toUpperCase().includes("PRODUCT") || cell.toString().includes("รายการสินค้า")))) { headerRowIndex = i; break; } } if (headerRowIndex === -1) { alert("❌ ไม่พบตารางสินค้า"); input.value = ""; return; } const jsonData = XLSX.utils.sheet_to_json(firstSheet, { range: headerRowIndex, defval: "" }); if(jsonData.length > 0) compareDataWithSystem(jsonData); else alert("❌ ไม่พบข้อมูล"); input.value = ""; }; reader.readAsArrayBuffer(file); }
function compareDataWithSystem(excelData) { let matchCount = 0; const excelMap = {}; excelData.forEach(row => { const nameKey = Object.keys(row).find(k => k.toUpperCase().includes("PRODUCT") || k.includes("รายการสินค้า")); const totalKey = Object.keys(row).find(k => k.toUpperCase().includes("TOTAL") || k.includes("นับได้")); if (nameKey && row[nameKey]) { let productName = row[nameKey].toString().trim().replace(/\s+/g, ' ').trim(); let totalVal = parseFloat(row[totalKey]) || 0; excelMap[productName] = totalVal; } }); state.groups.forEach(g => { g.items.forEach(item => { const c1 = parseFloat(((item.zones.back.boxQty||0)*(item.unitPerBox||1) + (item.zones.back.pieceQty||0)).toFixed(4)); const c2 = parseFloat(((item.zones.front?.m1||0)+(item.zones.front?.m2||0)+(item.zones.front?.m3||0)).toFixed(4)); const mShow = parseFloat(item.zones.front?.show || 0); const sysTotal = parseFloat((c1 + c2 + mShow + parseFloat(item.c3||0)).toFixed(4)); const cleanName = item.name.trim().replace(/\s+/g, ' '); const excelTotal = excelMap[cleanName]; if (excelTotal !== undefined) { matchCount++; item.compare = { excel: excelTotal, diff: parseFloat((sysTotal - excelTotal).toFixed(4)) }; } else item.compare = null; }); }); state.isComparing = true; const headerRow = document.querySelector("#inventory-table thead tr"); if (!document.getElementById('th-compare')) headerRow.insertAdjacentHTML('beforeend', `<th id="th-compare" class="h-compare">COMPARE<small>เทียบไฟล์เก่า</small></th>`); renderTable(); alert(`✅ เปรียบเทียบเรียบร้อย! เจอ: ${matchCount} รายการ`); }

// ===================================================================
// 🛡️ เครื่องมือแอดมิน: ประวัติการแก้ไข / สำรองข้อมูล / เปลี่ยนรหัส
// ===================================================================
const ACTION_LABEL = { update: 'แก้ตัวเลข', confirm: 'ยืนยัน', unconfirm: 'ยกเลิกยืนยัน', create: 'เพิ่มสินค้า', delete: 'ลบสินค้า',
    save_history: 'บันทึกวันนี้', login: 'เข้าสู่ระบบ', backup: 'สำรองข้อมูล', change_pin: 'เปลี่ยน PIN', change_admin_password: 'เปลี่ยนรหัสแอดมิน', install: 'ติดตั้งระบบ', edit_history: 'แก้ประวัติ' };
const FIELD_LABEL = { back_box: 'หลังร้าน (ลัง)', back_piece: 'หลังร้าน (เศษ)', front_1: 'เครื่อง 1', front_2: 'เครื่อง 2', front_3: 'เครื่อง 3', front_show: 'ตัวโชว์',
    fg_open: 'OPEN', fg_add: 'ADD', c3: 'C3', daily: 'DAILY', office: 'OFFICE', booth: 'BOOTH', main: 'MAIN', unit_per_box: 'ต่อลัง', ...ZONE_LABEL };
let auditRows = [];

function openAdmin(tab) {
    $id('admin-modal').classList.remove('hidden');
    document.querySelectorAll('#admin-modal .tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    const body = $id('admin-body');
    if (tab === 'audit') {
        body.innerHTML = `<div class="audit-tools"><input id="audit-q" placeholder="ค้นหาชื่อสินค้า หรือชื่อเล่นคนแก้" onkeydown="if(event.key==='Enter')loadAudit(true)"><button class="btn" onclick="loadAudit(true)">ค้นหา</button></div>
            <table class="audit"><thead><tr><th>เวลา</th><th>ใคร</th><th>ทำอะไร</th><th>สินค้า</th><th>ช่อง</th><th>ค่าเดิม</th><th>ค่าใหม่</th></tr></thead><tbody id="audit-body"></tbody></table>
            <div style="text-align:center; margin-top:12px;"><button class="btn" id="audit-more" onclick="loadAudit(false)">โหลดเพิ่ม</button></div>`;
        loadAudit(true);
    } else {
        body.innerHTML = `<p class="muted" style="margin-top:0">ข้อมูลเก็บอยู่ในฐานข้อมูลบนคลาวด์ · กดดาวน์โหลดไฟล์สำรอง (JSON) เก็บไว้ในเครื่องได้ก่อนทำอะไรสำคัญ</p>
            <button class="btn btn-primary" onclick="downloadBackup(this)">ดาวน์โหลดไฟล์สำรอง</button>`;
    }
}

async function loadAudit(reset) {
    if (reset) auditRows = [];
    const q = $id('audit-q')?.value.trim() || '';
    const before = auditRows.length ? auditRows[auditRows.length - 1].id : 0;
    try {
        const d = await api('audit_log', null, `&limit=200&before=${before}&q=${encodeURIComponent(q)}`);
        auditRows = auditRows.concat(d.rows);
        $id('audit-body').innerHTML = auditRows.map(r => `<tr>
            <td class="muted" style="white-space:nowrap">${esc(r.at)}</td><td>${esc(r.nickname)}${r.role === 'staff+adm' ? ' <span class="muted">(ใช้รหัสแอดมิน)</span>' : ''}</td>
            <td>${esc(ACTION_LABEL[r.action] || r.action)}</td><td>${esc(r.product_name || '')}</td>
            <td>${esc(FIELD_LABEL[r.field] || r.field || '')}</td>
            <td class="old">${r.action === 'delete' ? '<span class="muted">(เก็บข้อมูลเดิมไว้)</span>' : (/confirm/.test(r.action) ? '' : esc(r.old_value ?? ''))}</td>
            <td class="new">${/confirm/.test(r.action) ? '' : esc(r.new_value ?? '')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">ไม่มีรายการ</td></tr>';
        $id('audit-more').style.display = d.rows.length < 200 ? 'none' : '';
    } catch (e) { toast(e.message, true); }
}

async function downloadBackup(btn) {
    if (btn) btn.disabled = true;
    try {
        const res = await fetch(`${API_URL}?action=backup_export`, { cache: 'no-store' });
        if (!res.ok) throw new Error('ดาวน์โหลดไม่สำเร็จ');
        const cd = res.headers.get('Content-Disposition') || '';
        const name = (cd.match(/filename="([^"]+)"/) || [])[1] || 'sf-stock-backup.json';
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast('ดาวน์โหลดไฟล์สำรองแล้ว');
    } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
}
