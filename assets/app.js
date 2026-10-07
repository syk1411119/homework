import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.APP_CONFIG || {};
const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
const sb = configured
  ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
  : null;

let user = null;
let profile = null;
let currentTab = 'today';

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const roleLabel = () => ({ student: '学生', parent: '家长', admin: '管理员' })[profile?.role] || '';
const todayStr = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const fmtDate = d => { if (!d) return ''; const x = new Date(d); return `${x.getMonth() + 1}月${x.getDate()}日`; };
const fmtTime = d => { if (!d) return ''; const x = new Date(d); const p = n => String(n).padStart(2, '0'); return `${p(x.getHours())}:${p(x.getMinutes())}`; };

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._tm);
  t._tm = setTimeout(() => (t.className = 'toast'), 3000);
}

/* ================= AI（DeepSeek） ================= */
async function callAI(messages, jsonMode = false) {
  const key = localStorage.getItem('deepseek_key') || '';
  if (!key) throw new Error('还没有 AI 密钥：请在「我的 → AI 设置」里粘贴 DeepSeek 密钥');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error('AI 请求失败(' + res.status + ')，请检查密钥');
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function parseDeadline(s) {
  if (!s) { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(20, 0, 0, 0); return d.toISOString(); }
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) { const x = new Date(); x.setDate(x.getDate() + 1); x.setHours(20, 0, 0, 0); return x.toISOString(); }
  return d.toISOString();
}

async function aiParse(text) {
  const sys = '你是作业解析助手。把学生输入的作业文字解析成 JSON 对象，格式：{"tasks":[{"subject":"科目","title":"标题","description":"说明","deadline":"YYYY-MM-DD HH:mm","estimated_minutes":整数,"difficulty":"简单|中等|困难"}]}。科目用中文（数学/语文/英语/物理/化学/生物/历史/地理/政治/其他）。没写时间的默认明天 20:00。只输出 JSON，不要多余文字。';
  const out = await callAI([{ role: 'system', content: sys }, { role: 'user', content: text }], true);
  const json = JSON.parse(String(out).replace(/```json|```/g, '').trim());
  const tasks = (json.tasks || []).map(t => ({
    subject: t.subject || '其他',
    title: t.title || '作业',
    description: t.description || '',
    deadline: parseDeadline(t.deadline),
    estimated_minutes: Math.max(5, Math.round(Number(t.estimated_minutes) || 30)),
    difficulty: ['简单', '中等', '困难'].includes(t.difficulty) ? t.difficulty : '中等',
  }));
  if (!tasks.length) throw new Error('没识别出作业，请换个说法试试');
  return tasks;
}

function schedule(tasks) {
  const w = { 简单: 1, 中等: 2, 困难: 3 };
  return tasks.slice().sort((a, b) => {
    const ta = new Date(a.deadline || 0).getTime() || Infinity;
    const tb = new Date(b.deadline || 0).getTime() || Infinity;
    return (ta - tb) || (w[a.difficulty] - w[b.difficulty]) || (a.estimated_minutes - b.estimated_minutes);
  });
}

/* ================= 路由 ================= */
const TABS = {
  student: [{ id: 'today', label: '今日', ico: '📅' }, { id: 'record', label: '记录', ico: '✏️' }, { id: 'me', label: '我的', ico: '👤' }],
  parent: [{ id: 'children', label: '孩子', ico: '👨‍👩‍👧' }, { id: 'me', label: '我的', ico: '👤' }],
  admin: [{ id: 'members', label: '成员', ico: '👥' }, { id: 'me', label: '我的', ico: '👤' }],
};

function route() {
  $('#app-role').textContent = roleLabel();
  const tabs = TABS[profile.role] || TABS.student;
  $('#tabbar').innerHTML = `<div class="tabbar-inner">` +
    tabs.map(t => `<button class="tab ${t.id === currentTab ? 'active' : ''}" data-tab="${t.id}"><span class="ico">${t.ico}</span>${t.label}</button>`).join('') +
    `</div>`;
  $('#tabbar').querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { currentTab = b.dataset.tab; route(); }));
  $('#content').innerHTML = '<div class="spinner" style="margin:40px auto"></div>';
  if (profile.role === 'student') {
    if (currentTab === 'today') renderToday();
    else if (currentTab === 'record') renderRecord();
    else renderMe();
  } else if (profile.role === 'parent') {
    if (currentTab === 'children') renderChildren();
    else renderMe();
  } else {
    if (currentTab === 'members') renderMembers();
    else renderMe();
  }
}

/* ================= 学生：今日 ================= */
async function renderToday() {
  const c = $('#content');
  const { data, error } = await sb.from('homework').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) { c.innerHTML = `<div class="empty">读取失败：${esc(error.message)}</div>`; return; }
  const list = data || [];
  const pending = schedule(list.filter(h => h.status === 'pending'));
  const doneToday = list.filter(h => h.status === 'done' && h.done_at && new Date(h.done_at).toDateString() === new Date().toDateString());
  const total = pending.length + doneToday.length;
  const pct = total ? Math.round(doneToday.length / total * 100) : 0;

  c.innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="num">${pending.length}</div><div class="lbl">待完成</div></div>
      <div class="stat"><div class="num">${doneToday.length}</div><div class="lbl">今日已打卡</div></div>
    </div>
    <div class="card"><div class="progress"><span style="width:${pct}%"></span></div><div class="hint">今日完成度 ${pct}%</div></div>
    <div class="section-title">今日任务</div>
    <div id="today-list">${pending.length ? pending.map((t, i) => taskHTML(t, i)).join('') : '<div class="empty">今天没有待办任务，去「记录」添加吧 ✏️</div>'}</div>
    ${doneToday.length ? `<div class="section-title">已完成</div>` + doneToday.map(t => taskHTML(t)).join('') : ''}
  `;
  c.querySelectorAll('[data-check]').forEach(el => el.addEventListener('click', () => toggleDone(el.dataset.check)));
}

function taskHTML(t, idx) {
  const dif = { 简单: 'diff-easy', 中等: 'diff-mid', 困难: 'diff-hard' }[t.difficulty] || 'diff-mid';
  const isDone = t.status === 'done';
  return `<div class="task-item ${isDone ? 'done' : ''}">
    <div class="task-check" data-check="${t.id}">${isDone ? '✓' : ''}</div>
    <div class="task-main">
      <div class="task-title">${idx != null ? (idx + 1) + '. ' : ''}${esc(t.title)}</div>
      ${t.description ? `<div class="task-sub">${esc(t.description)}</div>` : ''}
      <div class="task-tags">
        <span class="tag sub">${esc(t.subject || '其他')}</span>
        ${t.deadline ? `<span class="tag">截止 ${fmtDate(t.deadline)} ${fmtTime(t.deadline)}</span>` : ''}
        <span class="tag">约${t.estimated_minutes}分钟</span>
        <span class="tag ${dif}">${esc(t.difficulty || '中等')}</span>
      </div>
    </div>
  </div>`;
}

async function toggleDone(id) {
  const { data } = await sb.from('homework').select('status').eq('id', id).single();
  const nowDone = data.status !== 'done';
  await sb.from('homework').update({ status: nowDone ? 'done' : 'pending', done_at: nowDone ? new Date().toISOString() : null }).eq('id', id);
  if (nowDone) { await sb.from('checkins').insert({ user_id: user.id, date: todayStr() }); toast('打卡成功 ✓', 'ok'); }
  renderToday();
}

/* ================= 学生：记录 ================= */
function renderRecord() {
  const c = $('#content');
  c.innerHTML = `
    <div class="section-title">记作业</div>
    <div class="card">
      <textarea id="hw-text" rows="5" style="width:100%;border:1px solid var(--border);border-radius:12px;background:var(--bg);color:var(--text);padding:12px;font-size:16px;font-family:inherit" placeholder="把今天的作业贴进来，比如：数学练习册第30页、英语背第一单元单词、语文作文一篇周五交……"></textarea>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn primary" id="ai-btn" style="flex:1">✨ AI 识别并安排</button>
        <button class="btn" id="manual-btn">手动</button>
      </div>
    </div>
    <div id="manual-form" class="card hidden">
      <div class="field"><label style="font-size:.85rem;color:var(--muted)">科目<input id="m-subject" placeholder="如 数学"></label></div>
      <div class="field"><label style="font-size:.85rem;color:var(--muted)">标题<input id="m-title" placeholder="作业内容"></label></div>
      <div class="field"><label style="font-size:.85rem;color:var(--muted)">截止时间<input id="m-deadline" type="datetime-local"></label></div>
      <div class="field"><label style="font-size:.85rem;color:var(--muted)">预计分钟<input id="m-min" type="number" value="30"></label></div>
      <div class="field"><label style="font-size:.85rem;color:var(--muted)">难度<select id="m-diff"><option>简单</option><option selected>中等</option><option>困难</option></select></label></div>
      <button class="btn primary block" id="m-save">保存并安排</button>
    </div>
    <div id="ai-preview"></div>
  `;
  $('#ai-btn').addEventListener('click', onAI);
  $('#manual-btn').addEventListener('click', () => $('#manual-form').classList.toggle('hidden'));
  $('#m-save').addEventListener('click', saveManual);
}

async function onAI() {
  const text = $('#hw-text').value.trim();
  if (!text) { toast('先输入作业内容', 'err'); return; }
  const btn = $('#ai-btn');
  btn.innerHTML = '<span class="spinner"></span> 识别中…';
  btn.disabled = true;
  try {
    window._tasks = await aiParse(text);
    renderPreview(window._tasks);
    toast('识别成功，请确认', 'ok');
  } catch (e) {
    toast(e.message || '识别失败', 'err');
  } finally {
    btn.innerHTML = '✨ AI 识别并安排';
    btn.disabled = false;
  }
}

function renderPreview(tasks) {
  const p = $('#ai-preview');
  p.innerHTML = `<div class="card"><h2>识别结果（可改标题/科目）</h2>` +
    tasks.map((t, i) => `
      <div class="task-item">
        <div class="task-check" style="background:var(--accent);border-color:var(--accent);color:#fff">${i + 1}</div>
        <div class="task-main">
          <input class="pv" data-i="${i}" data-k="title" value="${esc(t.title)}" style="width:100%;border:1px solid var(--border);border-radius:9px;padding:8px;background:var(--bg);color:var(--text);font-size:15px">
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <input class="pv" data-i="${i}" data-k="subject" value="${esc(t.subject)}" style="width:90px;border:1px solid var(--border);border-radius:9px;padding:6px;background:var(--bg);color:var(--text);font-size:13px">
            <span class="tag diff-${['简单', '中等', '困难'].indexOf(t.difficulty) >= 0 ? { 简单: 'easy', 中等: 'mid', 困难: 'hard' }[t.difficulty] : 'mid'}">${esc(t.difficulty)}</span>
            <span class="tag">约${t.estimated_minutes}分钟</span>
            ${t.deadline ? `<span class="tag">${fmtDate(t.deadline)} ${fmtTime(t.deadline)}</span>` : ''}
          </div>
        </div>
      </div>`).join('') +
    `<button class="btn primary block" id="save-tasks">保存并安排今日任务</button></div>`;
  p.querySelectorAll('.pv').forEach(inp => inp.addEventListener('input', () => { window._tasks[+inp.dataset.i][inp.dataset.k] = inp.value; }));
  $('#save-tasks').addEventListener('click', saveTasks);
}

async function saveTasks() {
  const tasks = schedule(window._tasks || []);
  const rows = tasks.map((t, i) => ({ user_id: user.id, subject: t.subject, title: t.title, description: t.description, deadline: t.deadline, estimated_minutes: t.estimated_minutes, difficulty: t.difficulty, plan_date: todayStr(), plan_order: i + 1 }));
  const { error } = await sb.from('homework').insert(rows);
  if (error) { toast('保存失败：' + error.message, 'err'); return; }
  toast('已安排今日任务！', 'ok');
  $('#hw-text').value = '';
  $('#ai-preview').innerHTML = '';
  currentTab = 'today';
  route();
}

async function saveManual() {
  const title = $('#m-title').value.trim();
  if (!title) { toast('请填写标题', 'err'); return; }
  const deadline = $('#m-deadline').value ? new Date($('#m-deadline').value).toISOString() : null;
  const row = { user_id: user.id, subject: $('#m-subject').value.trim() || '其他', title, deadline, estimated_minutes: Math.max(5, Number($('#m-min').value) || 30), difficulty: $('#m-diff').value, plan_date: todayStr() };
  const { error } = await sb.from('homework').insert(row);
  if (error) { toast('保存失败：' + error.message, 'err'); return; }
  toast('已添加', 'ok');
  currentTab = 'today';
  route();
}

/* ================= 家长 ================= */
async function renderChildren() {
  const c = $('#content');
  const { data: kids, error } = await sb.from('profiles').select('*').eq('parent_id', user.id);
  if (error) { c.innerHTML = `<div class="empty">读取失败：${esc(error.message)}</div>`; return; }
  if (!kids.length) { c.innerHTML = '<div class="empty">还没有关联的孩子。<br><span class="muted">让管理员在「成员」里把你设成孩子的家长。</span></div>'; return; }
  c.innerHTML = '<div class="section-title">我的孩子</div>';
  for (const kid of kids) {
    const { data: hw } = await sb.from('homework').select('*').eq('user_id', kid.id);
    const pending = (hw || []).filter(h => h.status === 'pending').length;
    const doneToday = (hw || []).filter(h => h.status === 'done' && h.done_at && new Date(h.done_at).toDateString() === new Date().toDateString()).length;
    c.innerHTML += `<div class="card child-card" data-child="${kid.id}" style="cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:700">${esc(kid.name || '孩子')}</div>
        <div class="muted" style="font-size:.82rem">待办 ${pending} · 今日打卡 ${doneToday}</div>
      </div></div>`;
  }
  c.querySelectorAll('.child-card').forEach(el => el.addEventListener('click', () => renderChildDetail(el.dataset.child)));
}

async function renderChildDetail(childId) {
  const c = $('#content');
  const { data: kid } = await sb.from('profiles').select('*').eq('id', childId).single();
  const { data: hw } = await sb.from('homework').select('*').eq('user_id', childId).order('created_at', { ascending: false });
  const list = hw || [];
  const pending = schedule(list.filter(h => h.status === 'pending'));
  const done = list.filter(h => h.status === 'done');
  c.innerHTML = `
    <button class="btn sm" id="back-kids">← 返回</button>
    <div class="section-title" style="margin-top:10px">${esc(kid?.name || '孩子')} 的作业</div>
    <div class="card"><div class="hint">待完成 ${pending.length} 项 · 已完成 ${done.length} 项</div></div>
    ${pending.map((t, i) => taskHTML(t, i)).join('') || '<div class="empty">没有待办作业</div>'}
    ${done.length ? '<div class="section-title">已完成</div>' + done.map(t => taskHTML(t)).join('') : ''}
  `;
  $('#back-kids').addEventListener('click', renderChildren);
}

/* ================= 管理员 ================= */
async function renderMembers() {
  const c = $('#content');
  const { data: profiles, error } = await sb.from('profiles').select('*').order('created_at');
  if (error) { c.innerHTML = `<div class="empty">读取失败：${esc(error.message)}</div>`; return; }
  const parents = profiles.filter(p => p.role === 'parent');
  c.innerHTML = `<div class="section-title">成员管理（${profiles.length}）</div>` +
    profiles.map(p => `
      <div class="manage-row">
        <div class="manage-name">${esc(p.name || '未命名')}</div>
        <select class="role-select" data-role="${p.id}">
          <option value="student" ${p.role === 'student' ? 'selected' : ''}>学生</option>
          <option value="parent" ${p.role === 'parent' ? 'selected' : ''}>家长</option>
          <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>管理员</option>
        </select>
        ${p.role === 'student' ? `<select class="role-select" data-parent="${p.id}"><option value="">无家长</option>` + parents.map(pa => `<option value="${pa.id}" ${p.parent_id === pa.id ? 'selected' : ''}>${esc(pa.name || '家长')}</option>`).join('') + `</select>` : ''}
      </div>`).join('');
  c.querySelectorAll('[data-role]').forEach(s => s.addEventListener('change', () => setRole(s.dataset.role, s.value)));
  c.querySelectorAll('[data-parent]').forEach(s => s.addEventListener('change', () => setParent(s.dataset.parent, s.value)));
}

async function setRole(id, role) {
  await sb.from('profiles').update({ role }).eq('id', id);
  toast('已更新角色', 'ok');
}
async function setParent(id, parentId) {
  await sb.from('profiles').update({ parent_id: parentId || null }).eq('id', id);
  toast('已更新家长关联', 'ok');
}

/* ================= 我的 ================= */
function renderMe() {
  const key = localStorage.getItem('deepseek_key') || '';
  const c = $('#content');
  c.innerHTML = `
    <div class="section-title">我的</div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px">
        <img src="assets/icon.svg" width="44" height="44" style="border-radius:12px">
        <div><div style="font-weight:700">${esc(profile.name || '未设置姓名')}</div><div class="muted" style="font-size:.82rem">${esc(user.email)} · ${roleLabel()}</div></div>
      </div>
    </div>
    <div class="card">
      <h2>AI 设置（DeepSeek）</h2>
      <div class="field"><label style="font-size:.85rem;color:var(--muted)">DeepSeek API 密钥<input id="ai-key" type="password" placeholder="sk-..." value="${esc(key)}"></label></div>
      <button class="btn primary" id="save-key">保存密钥</button>
      <p class="hint">密钥只存在你当前浏览器里，不写进代码、不上传 GitHub，别人看不到。</p>
    </div>
    <button class="btn danger block" id="logout2">退出登录</button>
  `;
  $('#save-key').addEventListener('click', () => { const k = $('#ai-key').value.trim(); k ? localStorage.setItem('deepseek_key', k) : localStorage.removeItem('deepseek_key'); toast('已保存', 'ok'); });
  $('#logout2').addEventListener('click', () => sb.auth.signOut());
}

/* ================= 认证 ================= */
function showAuth() { $('#auth-view').classList.remove('hidden'); $('#app').classList.add('hidden'); }
function showApp() { $('#auth-view').classList.add('hidden'); $('#app').classList.remove('hidden'); }

async function refresh() {
  if (!sb) { toast('后端未配置', 'err'); showAuth(); return; }
  const { data } = await sb.auth.getSession();
  user = data.session ? data.session.user : null;
  if (!user) { profile = null; showAuth(); return; }
  const { data: p } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!p) { showAuth(); toast('账号缺少资料，请重新注册或联系管理员', 'err'); return; }
  profile = p;
  currentTab = profile.role === 'parent' ? 'children' : (profile.role === 'admin' ? 'members' : 'today');
  showApp();
  route();
}

async function handleLogin(e) {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
  if (error) { toast('登录失败：' + error.message, 'err'); return; }
  await refresh();
}

async function handleRegister(e) {
  e.preventDefault();
  const name = $('#reg-name').value.trim();
  const email = $('#reg-email').value.trim();
  const password = $('#reg-password').value;
  const role = $('#reg-role').value;
  if (!name || !email || password.length < 6) { toast('请填写姓名、邮箱，密码至少 6 位', 'err'); return; }
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) { toast('注册失败：' + error.message, 'err'); return; }
  if (!data.session) { toast('注册成功！请去邮箱点击确认链接（或让管理员关闭邮箱验证）', 'ok'); return; }
  const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true });
  const finalRole = count === 0 ? 'admin' : role;
  const { error: e2 } = await sb.from('profiles').insert({ id: data.user.id, name, role: finalRole });
  if (e2) { toast('创建资料失败：' + e2.message, 'err'); return; }
  if (finalRole === 'admin') toast('你是第一位用户，已设为管理员 🎉', 'ok');
  await refresh();
}

function bind() {
  $('#login-form').addEventListener('submit', handleLogin);
  $('#register-form').addEventListener('submit', handleRegister);
  $('#logout-btn').addEventListener('click', () => sb.auth.signOut());
  document.querySelectorAll('.auth-tab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const isLogin = b.dataset.auth === 'login';
    $('#login-form').classList.toggle('hidden', !isLogin);
    $('#register-form').classList.toggle('hidden', isLogin);
  }));
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { user = null; profile = null; showAuth(); } });
document.addEventListener('DOMContentLoaded', () => { bind(); refresh(); });
