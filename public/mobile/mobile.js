/** SF Stock Mobile – ล็อกอินด้วย PIN, ส่งข้อมูลแบบมีคิว (ใช้ได้ตอนเน็ตหลุด), ยืนยันแยกตามโซน */
const API_URL = "/api";
const $ = (s) => document.querySelector(s);
let state = { groups: [] };

let zone = "menu"; 
let query = "";
let currentEdit = null;
let currentMachine = 1; 
let isEditingField = false; 
let collapsedGroups = new Set(); 
let statusFilter = 'all';            // 'all' | 'todo' | 'done' (ใช้แค่กรองการแสดงผล)
let lastCounts = { total: 0, done: 0 };

const showLoading = () => { try { $("#loadingOverlay").style.display = "flex"; } catch(e){} };
const hideLoading = () => { try { $("#loadingOverlay").style.display = "none"; } catch(e){} };

try { $("#todayLabel").textContent = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' }); } catch(e){}

// ===================================================================
// 🔐 ล็อกอิน + เรียก API + คิวส่งข้อมูล (เก็บในเครื่องเมื่อเน็ตหลุด แล้วส่งทีหลัง)
// ===================================================================
const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} },
    del: (k) => { try { localStorage.removeItem(k); } catch(e) {} },
};
LS.del('sf_auth');
let auth = { token: '', nickname: 'ผู้ใช้', role: 'admin' };   // ปิดล็อกอินชั่วคราว: เซิร์ฟเวอร์ตัดสินสิทธิ์จริง
let queue = LS.get('sf_queue', []);          // [{ key, action, body }]
let netOk = true;
let flushing = false;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const findItem = (id) => { for (const g of state.groups) for (const i of g.items) if (i.id === id) return i; return null; };

class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function api(action, body = null, extraQuery = '') {
    let res;
    try {
        res = await fetch(`${API_URL}?action=${action}${extraQuery}`, {
            method: body ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Auth-Token': auth.token } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            cache: 'no-store',
        });
    } catch (e) { netOk = false; updateSyncPill(); throw new ApiError('offline', 0); }
    netOk = true;
    let data = null; try { data = await res.json(); } catch(e) {}
    if (!res.ok || !data || data.status !== 'success') throw new ApiError(data?.msg || `เซิร์ฟเวอร์ผิดพลาด (${res.status})`, res.status);
    return data;
}

/** เพิ่มงานเข้าคิว (งานเดียวกันที่ยังไม่ได้ส่งจะถูกแทนที่ด้วยค่าล่าสุด) */
function enqueue(item) {
    const i = queue.findIndex(q => q.key === item.key);
    if (i >= 0) queue.splice(i, 1);
    queue.push(item);
    LS.set('sf_queue', queue);
    updateSyncPill();
    flushQueue();
}

async function flushQueue() {
    if (flushing || !auth || !queue.length) { updateSyncPill(); return; }
    flushing = true; updateSyncPill();
    try {
        while (queue.length && auth) {
            const item = queue[0];
            try {
                await api(item.action, item.body);
            } catch (e) {
                if (e.status === 0 || e.status === 401 || e.status === 429 || e.status >= 500) break;   // ไว้ลองใหม่ทีหลัง
                showToast('ส่งไม่สำเร็จ: ' + e.message);                                                  // ข้อมูลผิด/สินค้าถูกลบ → ทิ้ง
            }
            const idx = queue.indexOf(item); if (idx >= 0) queue.splice(idx, 1);
            LS.set('sf_queue', queue);
        }
    } finally { flushing = false; updateSyncPill(); }
}
setInterval(flushQueue, 5000);
window.addEventListener('online', () => { netOk = true; flushQueue(); loadData(); });
window.addEventListener('offline', () => { netOk = false; updateSyncPill(); });

function updateSyncPill() {
    const pill = $('#syncPill'); if (!pill) return;
    const n = queue.length;
    const offline = !netOk || navigator.onLine === false;
    pill.className = '';
    if (!auth) return;
    if (offline) { pill.className = 'offline'; $('#syncText').textContent = n ? `ออฟไลน์ · รอส่ง ${n} รายการ` : 'ออฟไลน์ · ข้อมูลจะส่งเมื่อเน็ตกลับมา'; }
    else if (n) { pill.className = 'sending'; $('#syncText').textContent = `กำลังส่ง ${n} รายการ…`; }
}

/** ใส่ค่าที่ยังรอส่งกลับลงไปบนข้อมูลจากเซิร์ฟเวอร์ ไม่ให้ตัวเลขเด้งกลับ */
function applyQueueToState() {
    queue.forEach(q => {
        if (q.action === 'update') applyLocal(q.body.id, q.body.field, q.body.value);
        else if (q.action === 'confirm') applyConfirm(q.body.id, q.body.zone, q.body.value);
    });
}

function showScreen(id) {
    ['loginScreen', 'menuScreen', 'backSubMenuScreen', 'frontSubMenuScreen', 'appScreen'].forEach(s => { const el = document.getElementById(s); if (el) el.style.display = 'none'; });
    const el = document.getElementById(id); if (el) el.style.display = id === 'appScreen' ? 'block' : 'flex';
}

function showUser() {
    $('#userNick').textContent = auth?.nickname || '-';
    $('#userRole').textContent = auth?.role === 'admin' ? 'แอดมิน' : 'พนักงาน';
}

// ---------- เริ่มต้นแอป ----------
const cached = LS.get('sf_cache', null);
if (cached?.groups) { state.groups = cached.groups; applyQueueToState(); }
showUser(); showScreen('menuScreen'); showLoading(); loadData().then(() => { hideLoading(); flushQueue(); });
updateSyncPill();
setInterval(loadData, 3000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/mobile/sw.js', { scope: '/mobile/' }).catch(() => {});

window.toggleGroup = (groupId) => {
    if (collapsedGroups.has(groupId)) collapsedGroups.delete(groupId);
    else collapsedGroups.add(groupId);
    render(); 
};

window.openZone = (selectedZone) => {
    if (selectedZone === 'back') {
        $("#menuScreen").style.display = "none";
        $("#backSubMenuScreen").style.display = "flex";
        zone = "menu_back";
        return;
    }
    if (selectedZone === 'front') {
        $("#menuScreen").style.display = "none";
        $("#frontSubMenuScreen").style.display = "flex";
        zone = "menu_front";
        return;
    }
    zone = selectedZone;
    $("#menuScreen").style.display = "none";
    $("#appScreen").style.display = "block";
    const titles = {booth: "Booth", main: "MAIN"};
    $("#zoneTitle").innerText = titles[zone];
    render();
};

window.openBackSubZone = (subZone) => {
    zone = subZone;
    $("#backSubMenuScreen").style.display = "none";
    $("#appScreen").style.display = "block";
    const titles = {back_syrup: "Syrup & CO2", back_component: "ComponenT", back_daily: "DAILY"};
    $("#zoneTitle").innerText = titles[zone];
    render();
};

window.openFrontSubZone = (val) => {
    if (val === 'show') {
        zone = 'front_show';
        $("#zoneTitle").innerText = "ตัวโชว์ (หน้าร้าน)";
    } else {
        zone = 'front';
        currentMachine = val;
        $("#zoneTitle").innerText = `หน้าร้าน - C${val}`;
    }
    $("#frontSubMenuScreen").style.display = "none";
    $("#appScreen").style.display = "block";
    render();
};

window.goBackMenu = () => {
    if (zone.startsWith('back_')) {
        $("#appScreen").style.display = "none";
        $("#backSubMenuScreen").style.display = "flex";
        zone = "menu_back";
    } else if (zone === 'front' || zone === 'front_show') {
        $("#appScreen").style.display = "none";
        $("#frontSubMenuScreen").style.display = "flex";
        zone = "menu_front";
    } else {
        $("#appScreen").style.display = "none";
        $("#menuScreen").style.display = "flex";
        zone = "menu";
    }
};

window.goBackToMainMenu = () => {
    $("#backSubMenuScreen").style.display = "none";
    $("#frontSubMenuScreen").style.display = "none";
    $("#menuScreen").style.display = "flex";
    zone = "menu";
};

async function loadData() {
    if (!auth) return;
    try {
        const data = await api('read');
        state.groups = data.groups;
        LS.set('sf_cache', { groups: data.groups, at: Date.now() });
        applyQueueToState();
        if (!isEditingField && !zone.startsWith('menu')) render();
    } catch(e) { /* ออฟไลน์: ใช้ข้อมูลล่าสุดในเครื่องต่อ */ }
}

/** โซนปัจจุบันสำหรับสถานะยืนยัน (หน้าร้านแยกตามเครื่อง) */
const zoneKey = () => zone === 'front' ? 'front_' + currentMachine : zone;
const isConfirmed = (p) => !!(p.confirmedZones && p.confirmedZones[zoneKey()]);

function applyLocal(id, field, val) {
    const i = findItem(id); if (!i) return;
    if(field === 'back_box') i.zones.back.boxQty = val;
    else if(field === 'back_piece') i.zones.back.pieceQty = val;
    else if(field === 'fg_open') i.fg_open = val;
    else if(field === 'fg_add') i.fg_add = val;
    else if(field === 'front_1') i.zones.front.m1 = val;
    else if(field === 'front_2') i.zones.front.m2 = val;
    else if(field === 'front_3') i.zones.front.m3 = val;
    else if(field === 'front_show') { if(!i.zones.front) i.zones.front={}; i.zones.front.show = val; }
    else if(field === 'booth') i.booth = val;
    else if(field === 'main') i.main = val;
}
function applyConfirm(id, zk, on) {
    const i = findItem(id); if (!i) return;
    if (!i.confirmedZones || Array.isArray(i.confirmedZones)) i.confirmedZones = {};
    if (on) i.confirmedZones[zk] = { by: auth?.nickname || '', at: '' }; else delete i.confirmedZones[zk];
}

function updateDB(id, field, value) {
    let val = parseFloat(value) || 0;
    if(val < 0) val = 0;
    val = Math.round(val * 10000) / 10000;
    applyLocal(id, field, val);
    enqueue({ key: `u:${id}:${field}`, action: 'update', body: { id, field, value: val } });
}

// ---------- ตัวช่วยสร้าง HTML (หน้าตาเท่านั้น) ----------
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 7"/></svg>`;
const stepperRow = (p, field, label, qty) => `<div class="step-row"><span class="lbl">${label}</span><div class="stepper"><button class="minus" onclick="adj('${p.id}','${field}',-1)" aria-label="ลด">−</button><div class="val" onclick="openSmartEdit('${p.id}', '${field}', ${qty})">${qty}</div><button class="plus" onclick="adj('${p.id}','${field}',1)" aria-label="เพิ่ม">+</button></div></div>`;
const confirmBtn = (p) => isConfirmed(p)
    ? `<button class="confirm-btn done" onclick="confirmItem('${p.id}')">${ICON_CHECK}บันทึกแล้ว</button>`
    : `<button class="confirm-btn" onclick="confirmItem('${p.id}')">แตะเพื่อยืนยัน</button>`;
const cardHtml = (p, totalDisplay, contentHtml) => `<article class="card ${isConfirmed(p)?'confirmed':''}"><div class="card-head"><div class="card-name">${esc(p.name)}${p.sku && p.sku!=='-' ? `<span class="card-sku">${esc(p.sku)}</span>` : ''}</div><div class="total-pill">${totalDisplay}</div></div><div class="card-body">${contentHtml}${confirmBtn(p)}</div></article>`;
const soloInput = (p, label, field, value) => `<div class="solo"><span>${label}</span><input type="number" inputmode="decimal" step="any" value="${value}" onfocus="isEditingField = true" onblur="isEditingField = false" onchange="updateDB('${p.id}', '${field}', this.value)"></div>`;

// ---------- ความคืบหน้า + ตัวกรองสถานะ (แสดงผลเท่านั้น) ----------
function updateProgress(total, done) {
    lastCounts = { total, done };
    const pct = total ? Math.round(done / total * 100) : 0;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('cnt-all', total); set('cnt-done', done); set('cnt-todo', total - done);
    const fill = document.getElementById('progressFill'); if (fill) fill.style.width = pct + '%';
    set('progressText', total ? (done === total ? 'ครบแล้ว' : `${pct}%`) : '–');
    const box = document.getElementById('progressBox'); if (box) box.classList.toggle('complete', total > 0 && done === total);
    document.querySelectorAll('.chip').forEach(c => { const on = c.dataset.f === statusFilter; c.classList.toggle('on', on); c.setAttribute('aria-selected', on); });
}
window.setStatusFilter = (f) => { statusFilter = f; render(); window.scrollTo({ top: 0 }); };

function render() {
    if (zone.startsWith('menu')) return;

    const root = $("#groups"); root.innerHTML = "";
    const q = query.trim().toLowerCase();
    let flatItemsForComponent = [];
    let zoneTotal = 0, zoneDone = 0;

    state.groups.forEach(g => {
        const groupName = g.name.toUpperCase();
        let itemsToRender = g.items; // กรองตามโซนก่อน แล้วค่อยกรองคำค้น/สถานะ (เพื่อให้นับความคืบหน้าทั้งโซน)

        const isFrontGroup = groupName.includes('FG') || groupName.includes('COMBO') || groupName.includes('KIOS') || groupName.includes('PROMOTION');

        if (zone === 'front' || zone === 'front_show') {
            if (!isFrontGroup && !groupName.includes('CON-STD')) return; 
        } 
        else if (zone.startsWith('back_')) {
            if (isFrontGroup) return; 
            itemsToRender = itemsToRender.filter(p => {
                const n = p.name.toUpperCase();
                if (zone === 'back_syrup') {
                    return n.includes('SYRUP') || n.includes('CO2') || n.includes('FUZE') || n.includes('10L') || n.includes('20L') || n.includes('BIB') || n.includes('TANK');
                }
                if (zone === 'back_component') {
                    return n.includes('CORN') || n.includes('OIL') || n.includes('SALT') || n.includes('CHEESE') || n.includes('PAPRIKA') || n.includes('CARAMEL') || n.includes('BUTTER') || n.includes('KAPRAO') || n.includes('CHICKEN') || n.includes('KANGSOM') || groupName.includes('COMPONENT') || groupName.includes('INGREDIENT');
                }
                if (zone === 'back_daily') {
                    return n.includes('CUP') || n.includes('LID') || n.includes('BOX') || n.includes('BAG') || n.includes('ZIPLOCK') || n.includes('BUCKET') || n.includes('BOWL') || n.includes('CARD') || n.includes('MINT') || n.includes('JELLY') || groupName.includes('DAILY') || groupName.includes('PACKAGING');
                }
                return true;
            });
        }

        if(itemsToRender.length === 0) return;

        // นับความคืบหน้าทั้งโซน (ไม่ขึ้นกับคำค้น/ตัวกรอง)
        const groupTotal = itemsToRender.length;
        const groupDone = itemsToRender.filter(isConfirmed).length;
        zoneTotal += groupTotal; zoneDone += groupDone;

        // กรองคำค้น + สถานะ
        itemsToRender = itemsToRender.filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q)));
        if (statusFilter === 'todo') itemsToRender = itemsToRender.filter(p => !isConfirmed(p));
        else if (statusFilter === 'done') itemsToRender = itemsToRender.filter(isConfirmed);
        if(itemsToRender.length === 0) return;

        if (zone === 'back_component') {
            flatItemsForComponent.push(...itemsToRender);
            return;
        }

        const html = itemsToRender.map(p => {
            let contentHtml = '';
            let totalDisplay = 0;

            if (zone.startsWith('back_')) {
                const totalBack = (p.zones.back.boxQty * p.unitPerBox) + p.zones.back.pieceQty;
                totalDisplay = parseFloat(totalBack.toFixed(4));
                contentHtml = stepperRow(p, 'back_box', 'ลัง', p.zones.back.boxQty) + stepperRow(p, 'back_piece', 'เศษ', p.zones.back.pieceQty);
            } 
            else if (zone === 'front') {
                const fgOpen = p.fg_open || 0; const fgAdd = p.fg_add || 0;
                const m1 = p.zones.front?.m1 || 0; const m2 = p.zones.front?.m2 || 0; const m3 = p.zones.front?.m3 || 0; const mShow = p.zones.front?.show || 0;
                totalDisplay = parseFloat((m1 + m2 + m3 + mShow).toFixed(4)); 
                const currentMachineQty = p.zones.front?.['m' + currentMachine] || 0;
                contentHtml = `<div class="fg-grid">
                    <div class="fg-cell"><span>OPEN</span><input type="number" inputmode="decimal" step="any" value="${fgOpen}" onfocus="isEditingField = true" onblur="isEditingField = false" onchange="updateDB('${p.id}', 'fg_open', this.value)"></div>
                    <div class="fg-cell"><span>ADD</span><input type="number" inputmode="decimal" step="any" value="${fgAdd}" onfocus="isEditingField = true" onblur="isEditingField = false" onchange="updateDB('${p.id}', 'fg_add', this.value)"></div>
                    <div class="fg-cell machine"><span>C${currentMachine}</span><input type="number" inputmode="decimal" step="any" value="${currentMachineQty}" onfocus="isEditingField = true" onblur="isEditingField = false" onchange="updateDB('${p.id}', 'front_${currentMachine}', this.value)"></div>
                </div><div class="fg-sum">ยอด CLOSE รวม <b>${totalDisplay}</b></div>`;
            } 
            else if (zone === 'front_show') {
                totalDisplay = p.zones.front?.show || 0;
                contentHtml = soloInput(p, 'จำนวนตัวโชว์', 'front_show', totalDisplay);
            }
            else if (zone === 'booth') {
                totalDisplay = p.booth || 0;
                contentHtml = soloInput(p, 'จำนวนใน Booth', 'booth', totalDisplay);
            } 
            else if (zone === 'main') {
                totalDisplay = p.main || 0;
                contentHtml = soloInput(p, 'จำนวนใน MAIN', 'main', totalDisplay);
            }

            return cardHtml(p, totalDisplay, contentHtml);
        }).join('');

        const isCollapsed = collapsedGroups.has(g.id);
        const displayStyle = isCollapsed ? 'none' : 'block';
        root.innerHTML += `<div class="grp-head ${isCollapsed ? 'collapsed' : ''}" onclick="toggleGroup('${g.id}')"><span class="name">${esc(g.name)}</span><span class="meta">${groupDone === groupTotal ? '✓ ครบ' : 'เหลือ ' + (groupTotal - groupDone)} · ${groupDone}/${groupTotal}<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></span></div><div style="display: ${displayStyle};">${html}</div>`;
    });

    if (zone === 'back_component' && flatItemsForComponent.length > 0) {
        const flatHtml = flatItemsForComponent.map(p => {
            const totalBack = (p.zones.back.boxQty * p.unitPerBox) + p.zones.back.pieceQty;
            const totalDisplay = parseFloat(totalBack.toFixed(4));
            return cardHtml(p, totalDisplay, stepperRow(p, 'back_box', 'Store Daily', p.zones.back.boxQty) + stepperRow(p, 'back_piece', 'ชั่งกิโล (เศษ)', p.zones.back.pieceQty));
        }).join('');
        root.innerHTML = '<div style="height:12px"></div>' + flatHtml;
    }

    updateProgress(zoneTotal, zoneDone);

    if (!root.innerHTML) {
        if (q) root.innerHTML = `<div class="empty">ไม่พบสินค้าที่ค้นหา</div>`;
        else if (zoneTotal === 0) root.innerHTML = `<div class="empty">ยังไม่มีสินค้าในหมวดนี้ — แตะ "เพิ่ม" ด้านบนเพื่อเพิ่มสินค้า</div>`;
        else if (statusFilter === 'todo') root.innerHTML = `<div class="all-done"><div class="big">${ICON_CHECK}</div><h4>นับครบทุกรายการแล้ว</h4><p>ยืนยันแล้ว ${zoneDone} จาก ${zoneTotal} รายการ</p><button onclick="setStatusFilter('all')">ดูรายการทั้งหมด</button></div>`;
        else if (statusFilter === 'done') root.innerHTML = `<div class="empty">ยังไม่มีรายการที่ยืนยัน</div>`;
    }
}

window.adj = (id, field, d) => { let current = 0; state.groups.forEach(g => g.items.forEach(i => { if(i.id===id) { if(field === 'back_box') current = i.zones.back.boxQty; else if(field === 'back_piece') current = i.zones.back.pieceQty; }})); updateDB(id, field, current + d); render(); };
window.confirmItem = (id) => {
    const p = findItem(id); if (!p) return;
    const zk = zoneKey(); const nowConfirmed = !isConfirmed(p);
    applyConfirm(id, zk, nowConfirmed);
    enqueue({ key: `c:${id}:${zk}`, action: 'confirm', body: { id, zone: zk, value: nowConfirmed ? 1 : 0 } });
    render();
    const left = lastCounts.total - lastCounts.done;
    showToast(!nowConfirmed ? "ยกเลิกการยืนยันแล้ว" : (left === 0 ? "นับครบทุกรายการแล้ว ✅" : `ยืนยันแล้ว · เหลืออีก ${left} รายการ`));
};
function showToast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("is-show"); setTimeout(() => t.classList.remove("is-show"), 1500); }

$("#q").oninput = (e) => { query = e.target.value; render(); };
$("#q").onfocus = () => { isEditingField = true; };
$("#q").onblur = () => { isEditingField = false; };

const CALC_CONFIG = { 'syrup10': { title: "Syrup 10 ลิตร", tare: 0.6, net: 12.0, unit: "กล่อง" }, 'syrup20': { title: "Syrup 20 ลิตร", tare: 0.82, net: 25.0, unit: "กล่อง" }, 'co2': { title: "CO2 (ถัง 9กก.)", tare: 11.5, net: 9.5, unit: "ถัง" }, 'fuze': { title: "Fuze Tea (10Kg)", tare: 0.6, net: 10.0, unit: "กล่อง" }, 'corn': { title: "Corn Chip", unit: "หน่วย (Each)" } };
function detectType(name) { const n = name.toLowerCase(); if ((n.includes('corn') || n.includes('popcorn')) && !n.includes('oil')) return 'corn'; if (n.includes('co2')) return 'co2'; if (n.includes('fuze')) return 'fuze'; if (n.includes('syrup') || n.includes('fanta') || n.includes('coke') || n.includes('sprite') || n.includes('10l') || n.includes('20l')) return (n.includes('20l') || n.includes('20 l')) ? 'syrup20' : 'syrup10'; return null; }

window.openSmartEdit = (id, field, currentVal, name) => { name = name ?? (findItem(id)?.name || ''); isEditingField = true; currentEdit = { id, field }; const type = detectType(name); $("#modalTitle").innerText = name; $("#smartModal").style.display = 'flex'; const content = $("#modalContent"); content.innerHTML = ""; if (type) { const cfg = CALC_CONFIG[type]; if(type === 'corn') { content.innerHTML = `<div class="calc-panel two"><div><label>ถาด (× 0.4)</label><input id="inp-tray" type="number" inputmode="decimal" step="any" placeholder="0" oninput="runMobileCalc('${type}')"></div><div><label>ถุง (× 1)</label><input id="inp-bag" type="number" inputmode="decimal" step="any" placeholder="0" oninput="runMobileCalc('${type}')"></div></div>`; } else { content.innerHTML = `<div class="calc-panel"><label>น้ำหนักที่ชั่งได้ (กก.) → แปลงเป็น${cfg.unit}</label><input id="inp-weight" type="number" step="any" placeholder="0.00" inputmode="decimal" oninput="runMobileCalc('${type}')"></div>`; } } content.innerHTML += `<div class="calc-result-box" onclick="focusHugeInput()"><div class="calc-result-unit">จำนวนที่นับได้ (แตะเพื่อแก้)</div><input id="inp-final" type="number" step="any" class="calc-input-huge" value="${currentVal}" inputmode="decimal" autofocus><div class="calc-result-unit u">${type ? CALC_CONFIG[type].unit : 'ชิ้น'}</div></div>`; setTimeout(() => { const input = document.getElementById("inp-final"); if(input.value === '0') input.value = ''; input.focus(); }, 50); };
window.focusHugeInput = () => { const i = document.getElementById("inp-final"); if(i) { if(i.value === '0') i.value = ''; i.focus(); } };
window.runMobileCalc = (type) => { let res = 0; if(type === 'corn') { const t = parseFloat($("#inp-tray").value)||0; const b = parseFloat($("#inp-bag").value)||0; res = (t * 0.4) + b; } else { const w = parseFloat($("#inp-weight").value)||0; const cfg = CALC_CONFIG[type]; if(w > cfg.tare) res = (w - cfg.tare) / cfg.net; } $("#inp-final").value = res > 0 ? res.toFixed(4) : 0; };
window.clearAllInputs = () => { const inputs = ["inp-weight", "inp-tray", "inp-bag"]; inputs.forEach(id => { const el = document.getElementById(id); if(el) el.value = ""; }); const final = document.getElementById("inp-final"); if(final) { final.value = ""; final.focus(); } };
window.saveSmartValue = () => { const finalVal = parseFloat($("#inp-final").value) || 0; if(!isNaN(finalVal)) { updateDB(currentEdit.id, currentEdit.field, finalVal); isEditingField = false; render(); closeSmartModal(); } };
window.closeSmartModal = () => { isEditingField = false; $("#smartModal").style.display = 'none'; };

// ==========================================
// 🔥 ระบบเพิ่มสินค้าใหม่ + แสกนบาร์โค้ด
// ==========================================
let html5QrcodeScanner = null;
let scanTarget = 'search'; // เก็บสถานะว่าแสกนเพื่อค้นหา หรือ แสกนเพื่อผูกบาร์โค้ด

window.openAddProductModal = () => {
    if (!netOk || navigator.onLine === false) return alert('เพิ่มสินค้าต้องต่ออินเทอร์เน็ตก่อนครับ');
    isEditingField = true;
    $("#adminPwField").style.display = auth?.role === 'admin' ? 'none' : 'block';
    $("#new_admin_pw").value = '';
    $("#addProductModal").style.display = 'flex';
    
    let defaultGroup = "General";
    if(zone.startsWith('back_syrup')) defaultGroup = "BK - Syrup";
    else if(zone.startsWith('back_component')) defaultGroup = "BK - Component";
    else if(zone.startsWith('back_daily')) defaultGroup = "BK - Daily";
    else if(zone === 'front' || zone === 'front_show') defaultGroup = "CON-STD FG ";
    
    $("#new_group").value = defaultGroup;
};

window.closeAddProductModal = () => {
    isEditingField = false;
    $("#addProductModal").style.display = 'none';
};

window.saveNewProduct = async () => {
    const g = $("#new_group").value.trim() || "General";
    const n = $("#new_name").value.trim();
    const s = $("#new_sku").value.trim() || "-";
    const u = parseFloat($("#new_unit").value) || 1;
    const pw = $("#new_admin_pw").value;

    if(!n) return alert("กรุณาระบุชื่อสินค้าครับ");
    if(auth?.role !== 'admin' && !pw) return alert("กรุณาให้แอดมินใส่รหัสยืนยันครับ");

    showLoading();
    try {
        const body = { id: 'p_' + Date.now(), group_name: g, name: n, sku: s, unit_per_box: u };
        if (auth?.role !== 'admin') body.admin_password = pw;
        await api('create', body);
        showToast("เพิ่มสินค้าสำเร็จ ✅");
        closeAddProductModal();
        $("#new_name").value = ""; $("#new_sku").value = ""; $("#new_admin_pw").value = "";
        await loadData();
        render();
    } catch(e) {
        alert(e.status === 0 ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" : e.message);
    }
    hideLoading();
};

// 🔥 ฟังก์ชันเปิดกล้องแสกน
window.startScan = (target = 'search') => {
    scanTarget = target;
    isEditingField = true;
    $("#scanModal").style.display = 'flex';
    
    // ตั้งค่าตัวแสกน
    html5QrcodeScanner = new Html5QrcodeScanner(
        "reader", { fps: 10, qrbox: {width: 250, height: 150} }, false
    );
    
    html5QrcodeScanner.render((decodedText) => {
        showToast("สแกนสำเร็จ!");
        if (scanTarget === 'sku') {
            $("#new_sku").value = decodedText; // ใส่ในช่องเพิ่มสินค้า
        } else {
            $("#q").value = decodedText; // ใส่ในช่องค้นหา
            query = decodedText;
            render();
        }
        closeScan();
    }, (error) => { /* ignore */ });
};

window.closeScan = () => {
    isEditingField = false;
    $("#scanModal").style.display = 'none';
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear();
        html5QrcodeScanner = null;
    }
};

// ===================================================================
// 🎤 ระบบสั่งเพิ่ม/ลดสต็อกด้วยเสียงและข้อความผ่าน AI (เชื่อมกับ updateDB โดยตรง)
// ===================================================================
(function initSfVoiceAI() {
    if (typeof window === 'undefined') return;

    // ดึงรายชื่อสินค้าตามโซนที่เปิดอยู่ (ถ้าอยู่หน้าเมนูจะดึงทั้งหมด)
    function getItemsForAI() {
        const list = [];
        const all = [];
        state.groups.forEach(g => {
            const groupName = g.name.toUpperCase();
            const isFrontGroup = groupName.includes('FG') || groupName.includes('COMBO') || groupName.includes('KIOS') || groupName.includes('PROMOTION');

            g.items.forEach(p => {
                const basic = { id: p.id, name: p.name, sku: p.sku !== '-' ? p.sku : undefined };
                all.push(basic);

                if (zone === 'front' || zone === 'front_show') {
                    if (isFrontGroup || groupName.includes('CON-STD')) list.push(basic);
                } else if (zone.startsWith('back_')) {
                    if (isFrontGroup) return;
                    const n = p.name.toUpperCase();
                    if (zone === 'back_syrup' && (n.includes('SYRUP') || n.includes('CO2') || n.includes('FUZE') || n.includes('10L') || n.includes('20L') || n.includes('BIB') || n.includes('TANK'))) list.push(basic);
                    else if (zone === 'back_component' && (n.includes('CORN') || n.includes('OIL') || n.includes('SALT') || n.includes('CHEESE') || n.includes('PAPRIKA') || n.includes('CARAMEL') || n.includes('BUTTER') || n.includes('KAPRAO') || n.includes('CHICKEN') || n.includes('KANGSOM') || groupName.includes('COMPONENT') || groupName.includes('INGREDIENT'))) list.push(basic);
                    else if (zone === 'back_daily' && (n.includes('CUP') || n.includes('LID') || n.includes('BOX') || n.includes('BAG') || n.includes('ZIPLOCK') || n.includes('BUCKET') || n.includes('BOWL') || n.includes('CARD') || n.includes('MINT') || n.includes('JELLY') || groupName.includes('DAILY') || groupName.includes('PACKAGING'))) list.push(basic);
                } else if (zone === 'booth' || zone === 'main') {
                    list.push(basic);
                }
            });
        });
        return list.length > 0 ? list : all;
    }

    // หาชื่อ Field และค่าปัจจุบันของสินค้าตามโซนที่เปิดอยู่
    function resolveFieldAndCurrentVal(item, unitType) {
        if (zone.startsWith('back_') || zone.startsWith('menu')) {
            if (unitType === 'box') {
                return { field: 'back_box', current: parseFloat(item.zones?.back?.boxQty) || 0 };
            }
            return { field: 'back_piece', current: parseFloat(item.zones?.back?.pieceQty) || 0 };
        }
        if (zone === 'front') {
            if (unitType === 'open') return { field: 'fg_open', current: parseFloat(item.fg_open) || 0 };
            if (unitType === 'fg_add') return { field: 'fg_add', current: parseFloat(item.fg_add) || 0 };
            const mKey = 'm' + currentMachine;
            return { field: 'front_' + currentMachine, current: parseFloat(item.zones?.front?.[mKey]) || 0 };
        }
        if (zone === 'front_show') {
            return { field: 'front_show', current: parseFloat(item.zones?.front?.show) || 0 };
        }
        if (zone === 'booth') {
            return { field: 'booth', current: parseFloat(item.booth) || 0 };
        }
        if (zone === 'main') {
            return { field: 'main', current: parseFloat(item.main) || 0 };
        }
        return { field: 'back_piece', current: parseFloat(item.zones?.back?.pieceQty) || 0 };
    }

    // ประมวลผลคำสั่งที่ได้จาก AI แล้วอัปเดตลงระบบทันที
    async function executeAiCommand(spokenText, uiStatus) {
        const products = getItemsForAI();
        if (!products.length) {
            showToast('ยังไม่มีข้อมูลสินค้าในระบบ');
            return;
        }

        uiStatus('🤖 AI กำลังวิเคราะห์: "' + spokenText + '"...');

        try {
            const res = await fetch('/api/ai-stock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: spokenText,
                    zone: zone,
                    productList: products
                })
            });

            const data = await res.json();
            if (!res.ok || !data.items || data.items.length === 0) {
                uiStatus('❌ ไม่พบสินค้าที่ตรงกับคำพูด ลองพูดใหม่อีกครั้งครับ');
                return;
            }

            let updatedCount = 0;
            data.items.forEach(cmd => {
                // ค้นหาสินค้าจาก ID หรือเทียบชื่อ
                let target = findItem(cmd.id);
                if (!target && cmd.name) {
                    const searchName = cmd.name.toLowerCase();
                    for (const g of state.groups) {
                        for (const i of g.items) {
                            if (i.name.toLowerCase().includes(searchName) || searchName.includes(i.name.toLowerCase())) {
                                target = i;
                                break;
                            }
                        }
                        if (target) break;
                    }
                }

                if (target) {
                    const { field, current } = resolveFieldAndCurrentVal(target, cmd.unitType);
                    const qty = parseFloat(cmd.quantity) || 0;
                    let newVal = current;

                    if (cmd.mode === 'add') newVal = current + qty;
                    else if (cmd.mode === 'remove') newVal = Math.max(0, current - qty);
                    else if (cmd.mode === 'set') newVal = Math.max(0, qty);

                    // อัปเดตค่าและส่งเข้าคิวเซิร์ฟเวอร์ทันที
                    updateDB(target.id, field, newVal);

                    // ยืนยันรายการในโซนปัจจุบันให้อัตโนมัติ
                    if (!zone.startsWith('menu')) {
                        const zk = zoneKey();
                        applyConfirm(target.id, zk, true);
                        enqueue({ key: `c:${target.id}:${zk}`, action: 'confirm', body: { id: target.id, zone: zk, value: 1 } });
                    }
                    updatedCount++;
                }
            });

            if (updatedCount > 0) {
                render();
                uiStatus('✅ ' + (data.summary || `อัปเดตสำเร็จ ${updatedCount} รายการ`));
                showToast(data.summary || `อัปเดตแล้ว ${updatedCount} รายการ ✅`);
            } else {
                uiStatus('❌ หาชื่อสินค้าไม่เจอในหมวดนี้ครับ');
            }
        } catch (err) {
            uiStatus('❌ เชื่อมต่อ AI ไม่สำเร็จ (ต้องต่อเน็ตเพื่อใช้ AI)');
        }
    }

    // สร้างปุ่มลอยบนหน้าจอมือถือ
    function mountVoiceUI() {
        if (document.getElementById('sf-ai-voice-bar')) return;

        const bar = document.createElement('div');
        bar.id = 'sf-ai-voice-bar';
        bar.style.cssText = `
            position: fixed;
            bottom: 16px;
            right: 16px;
            left: 16px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 6px;
            pointer-events: none;
            font-family: inherit;
        `;

        const statusBubble = document.createElement('div');
        statusBubble.style.cssText = `
            align-self: flex-end;
            background: rgba(15, 23, 42, 0.92);
            color: #fff;
            padding: 8px 14px;
            border-radius: 12px;
            font-size: 13px;
            max-width: 100%;
            display: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            pointer-events: auto;
        `;

        const controls = document.createElement('div');
        controls.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
        `;

        const textBtn = document.createElement('button');
        textBtn.type = 'button';
        textBtn.innerHTML = '⌨️ พิมพ์สั่ง AI';
        textBtn.style.cssText = `
            pointer-events: auto;
            background: #334155;
            color: #fff;
            border: none;
            padding: 12px 14px;
            border-radius: 50px;
            font-size: 13px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            cursor: pointer;
        `;

        const micBtn = document.createElement('button');
        micBtn.type = 'button';
        micBtn.innerHTML = '🎤 พูดเพิ่มของ';
        micBtn.style.cssText = `
            pointer-events: auto;
            background: #2563eb;
            color: #fff;
            border: none;
            padding: 12px 18px;
            border-radius: 50px;
            font-size: 14px;
            font-weight: 700;
            box-shadow: 0 4px 14px rgba(37, 99, 235, 0.45);
            cursor: pointer;
            transition: all 0.2s ease;
        `;

        let hideTimer = null;
        const setStatus = (msg) => {
            statusBubble.style.display = 'block';
            statusBubble.textContent = msg;
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => { statusBubble.style.display = 'none'; }, 6000);
        };

        textBtn.onclick = () => {
            const txt = prompt('พิมพ์คำสั่งให้ AI (เช่น "เพิ่มโค้ก 2 ลัง กับ 5 ชิ้น"):');
            if (txt && txt.trim()) executeAiCommand(txt.trim(), setStatus);
        };

        micBtn.onclick = () => {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                const txt = prompt('เบราว์เซอร์ไม่รองรับไมค์ พิมพ์คำสั่งแทนได้เลยครับ (เช่น "เพิ่มโค้ก 2 ลัง"):');
                if (txt && txt.trim()) executeAiCommand(txt.trim(), setStatus);
                return;
            }

            const recognition = new SpeechRecognition();
            recognition.lang = 'th-TH';
            recognition.interimResults = false;

            recognition.onstart = () => {
                micBtn.style.background = '#dc2626';
                micBtn.innerHTML = '🔴 กำลังฟัง...';
                setStatus('🎙️ พูดชื่อของและจำนวนได้เลย เช่น "เพิ่มโค้ก 2 ลัง 5 ชิ้น"');
            };

            recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                executeAiCommand(transcript, setStatus);
            };

            recognition.onerror = (event) => {
                micBtn.style.background = '#2563eb';
                micBtn.innerHTML = '🎤 พูดเพิ่มของ';
                setStatus('⚠️ ไมโครโฟนขัดข้อง: ' + event.error);
            };

            recognition.onend = () => {
                micBtn.style.background = '#2563eb';
                micBtn.innerHTML = '🎤 พูดเพิ่มของ';
            };

            recognition.start();
        };

        controls.appendChild(textBtn);
        controls.appendChild(micBtn);
        bar.appendChild(statusBubble);
        bar.appendChild(controls);
        document.body.appendChild(bar);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountVoiceUI);
    } else {
        mountVoiceUI();
    }
})();

// สร้างปุ่มลอยบนหน้าจอมือถือ (แสดงผลเสมอ)
    function mountVoiceUI() {
        if (document.getElementById('sf-ai-voice-bar')) return;

        const bar = document.createElement('div');
        bar.id = 'sf-ai-voice-bar';
        bar.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
            font-family: inherit;
        `;

        const statusBubble = document.createElement('div');
        statusBubble.style.cssText = `
            align-self: flex-end;
            background: rgba(15, 23, 42, 0.95);
            color: #fff;
            padding: 10px 14px;
            border-radius: 12px;
            font-size: 13px;
            max-width: 280px;
            display: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            pointer-events: auto;
        `;

        const controls = document.createElement('div');
        controls.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            pointer-events: auto;
        `;

        const textBtn = document.createElement('button');
        textBtn.type = 'button';
        textBtn.innerHTML = '⌨️ พิมพ์ AI';
        textBtn.style.cssText = `
            background: #334155;
            color: #fff;
            border: none;
            padding: 12px 14px;
            border-radius: 50px;
            font-size: 13px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            cursor: pointer;
        `;

        const micBtn = document.createElement('button');
        micBtn.type = 'button';
        micBtn.innerHTML = '🎤 พูดสั่ง AI';
        micBtn.style.cssText = `
            background: #2563eb;
            color: #fff;
            border: none;
            padding: 12px 18px;
            border-radius: 50px;
            font-size: 14px;
            font-weight: 700;
            box-shadow: 0 4px 16px rgba(37, 99, 235, 0.5);
            cursor: pointer;
        `;

        let hideTimer = null;
        const setStatus = (msg) => {
            statusBubble.style.display = 'block';
            statusBubble.textContent = msg;
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => { statusBubble.style.display = 'none'; }, 6000);
        };

        textBtn.onclick = () => {
            const txt = prompt('พิมพ์คำสั่งให้ AI (เช่น "เพิ่มโค้ก 2 ลัง"):');
            if (txt && txt.trim()) executeAiCommand(txt.trim(), setStatus);
        };

        micBtn.onclick = () => {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                const txt = prompt('เบราว์เซอร์ไม่รองรับไมค์ พิมพ์คำสั่งแทนได้เลยครับ:');
                if (txt && txt.trim()) executeAiCommand(txt.trim(), setStatus);
                return;
            }

            const recognition = new SpeechRecognition();
            recognition.lang = 'th-TH';
            recognition.interimResults = false;

            recognition.onstart = () => {
                micBtn.style.background = '#dc2626';
                micBtn.innerHTML = '🔴 กำลังฟัง...';
                setStatus('🎙️ พูดคำสั่งของคุณได้เลย...');
            };

            recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                executeAiCommand(transcript, setStatus);
            };

            recognition.onerror = (event) => {
                micBtn.style.background = '#2563eb';
                micBtn.innerHTML = '🎤 พูดสั่ง AI';
                setStatus('⚠️ ไมโครโฟนขัดข้อง: ' + event.error);
            };

            recognition.onend = () => {
                micBtn.style.background = '#2563eb';
                micBtn.innerHTML = '🎤 พูดสั่ง AI';
            };

            recognition.start();
        };

        controls.appendChild(textBtn);
        controls.appendChild(micBtn);
        bar.appendChild(statusBubble);
        bar.appendChild(controls);
        document.body.appendChild(bar);
    }

    // เรียกทำงานทันทีเมื่อสคริปต์โหลดเสร็จ
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountVoiceUI);
    } else {
        mountVoiceUI();
    }