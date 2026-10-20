// 로컬 전용 게시글 편집기: npm run editor → http://127.0.0.1:4322
// 저장/삭제 시 해당 파일만 git commit + push (main push → GitHub Pages 자동 배포)
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PORT = Number(process.env.PORT) || 4322;
const ROOT = new URL('..', import.meta.url).pathname;
const DIR = join(ROOT, 'src/content/posts');
const CATEGORIES = ['Security', 'Network', 'Reversing', 'Web', 'System', 'Dev', 'Note'];
const FILE_RE = /^[\p{L}\p{N}._-]+\.md$/u;

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();

function unquote(v) {
  v = v.trim();
  if (v.startsWith('"')) return JSON.parse(v);
  if (v.startsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function parse(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const post = { title: '', description: '', date: '', updated: '', category: 'Note', tags: [], draft: false, body: m ? m[2].replace(/^\r?\n/, '') : text };
  if (!m) return post;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (k === 'tags') post.tags = v.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
    else if (k === 'draft') post.draft = v.trim() === 'true';
    else if (k in post) post[k] = unquote(v);
  }
  return post;
}

const yamlStr = (s) => (/^[\p{L}\p{N}._ -]+$/u.test(s) && !/^\s|\s$/.test(s) ? s : JSON.stringify(s));

function serialize(p) {
  const fm = [
    `title: ${JSON.stringify(p.title)}`,
    `description: ${JSON.stringify(p.description)}`,
    `date: ${p.date}`,
    p.updated && `updated: ${p.updated}`,
    `category: ${p.category}`,
    `tags: [${p.tags.map(yamlStr).join(', ')}]`,
    p.draft && 'draft: true',
  ].filter(Boolean);
  return `---\n${fm.join('\n')}\n---\n\n${p.body.replace(/^\n+/, '')}`;
}

function publish(file, message) {
  const rel = `src/content/posts/${file}`;
  git('add', '-A', '--', rel);
  if (!git('status', '--porcelain', '--', rel)) return '변경 없음';
  git('commit', '-m', message, '--', rel);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  try {
    git('push', 'origin', 'HEAD');
  } catch (e) {
    throw new Error(`커밋은 됐지만 push 실패: ${e.stderr || e.message}`);
  }
  return branch === 'main' ? '배포 시작됨 (GitHub Actions)' : `push 완료 (현재 브랜치 ${branch}, main이 아니라 배포 안 됨)`;
}

function checkFile(file) {
  if (!FILE_RE.test(file || '')) throw new Error('잘못된 파일명');
  return join(DIR, file);
}

function slugify(date, title) {
  const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `${date}-${slug || 'post'}.md`;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const send = (code, data, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };
  // 다른 사이트에서의 요청 차단
  if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(403, { error: 'forbidden' });

  if (req.method === 'GET' && url.pathname === '/') return send(200, PAGE, 'text/html');
  if (req.method === 'GET' && url.pathname === '/api/posts') {
    const list = readdirSync(DIR).filter((f) => FILE_RE.test(f)).map((file) => {
      const { title, date, draft } = parse(readFileSync(join(DIR, file), 'utf8'));
      return { file, title, date, draft };
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return send(200, list);
  }
  if (req.method === 'GET' && url.pathname === '/api/post') {
    return send(200, parse(readFileSync(checkFile(url.searchParams.get('file')), 'utf8')));
  }

  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};

  if (req.method === 'POST' && url.pathname === '/api/post') {
    const p = body.post;
    if (!p.title?.trim() || !p.description?.trim()) throw new Error('제목과 설명은 필수');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new Error('날짜 형식은 YYYY-MM-DD');
    if (p.updated && !/^\d{4}-\d{2}-\d{2}$/.test(p.updated)) throw new Error('수정일 형식은 YYYY-MM-DD');
    if (!CATEGORIES.includes(p.category)) throw new Error('잘못된 카테고리');
    const isNew = !body.file;
    const file = body.file || slugify(p.date, p.title);
    const path = checkFile(file);
    if (isNew && existsSync(path)) throw new Error(`이미 존재: ${file}`);
    writeFileSync(path, serialize({ ...p, tags: p.tags.map((t) => t.trim()).filter(Boolean) }));
    const msg = publish(file, `${isNew ? 'post' : 'update'}: ${p.title}`);
    return send(200, { file, msg });
  }
  if (req.method === 'DELETE' && url.pathname === '/api/post') {
    const path = checkFile(body.file);
    const { title } = parse(readFileSync(path, 'utf8'));
    unlinkSync(path);
    return send(200, { msg: publish(body.file, `delete: ${title || body.file}`) });
  }
  send(404, { error: 'not found' });
}

createServer((req, res) => handle(req, res).catch((e) => {
  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: e.message }));
})).listen(PORT, '127.0.0.1', () => console.log(`편집기: http://127.0.0.1:${PORT}`));

const PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>LeJus 편집기</title>
<style>
body{margin:0;font:14px system-ui,sans-serif;display:flex;height:100vh}
aside{width:280px;border-right:1px solid #ddd;overflow:auto}aside button{width:100%}
aside div{padding:8px 12px;cursor:pointer;border-bottom:1px solid #eee}aside div:hover,aside .on{background:#eef}
small{color:#888}main{flex:1;padding:16px;display:flex;flex-direction:column;gap:8px;overflow:auto}
label{display:flex;gap:8px;align-items:center}label>span{width:70px}input,select,textarea{flex:1;padding:6px;font:inherit}
textarea{min-height:50vh;font-family:ui-monospace,monospace}.row{display:flex;gap:16px}button{padding:8px 14px}#msg{white-space:pre-wrap}
</style></head><body>
<aside><button onclick="edit()">+ 새 글</button><nav id="list"></nav></aside>
<main>
<b id="head"></b>
<label><span>제목</span><input id="title"></label>
<label><span>설명</span><input id="description"></label>
<div class="row"><label><span>작성일</span><input id="date" type="date"></label><label><span>수정일</span><input id="updated" type="date"></label></div>
<div class="row"><label><span>카테고리</span><select id="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
<label><span>태그</span><input id="tags" placeholder="쉼표로 구분"></label><label><input id="draft" type="checkbox">draft</label></div>
<textarea id="body" placeholder="Markdown 본문"></textarea>
<div class="row"><button id="save" onclick="save()">저장 + 배포</button><button id="del" onclick="del()">삭제 + 배포</button></div>
<div id="msg"></div>
</main>
<script>
let cur=null;const $=id=>document.getElementById(id);
const api=async(m,u,b)=>{const r=await fetch(u,{method:m,headers:{'Content-Type':'application/json'},body:b&&JSON.stringify(b)});const j=await r.json();if(!r.ok)throw new Error(j.error);return j};
async function load(){const l=await api('GET','/api/posts');$('list').innerHTML='';for(const p of l){const d=document.createElement('div');d.className=p.file===cur?'on':'';d.innerHTML='<div></div><small></small>';d.firstChild.textContent=p.title||p.file;d.lastChild.textContent=p.date+(p.draft?' · draft':'');d.onclick=()=>edit(p.file);$('list').appendChild(d)}}
async function edit(file){cur=file||null;$('msg').textContent='';const p=file?await api('GET','/api/post?file='+encodeURIComponent(file)):{title:'',description:'',date:new Date().toISOString().slice(0,10),updated:'',category:'Note',tags:[],draft:false,body:''};
for(const k of['title','description','date','updated','category','body'])$(k).value=p[k]||'';$('tags').value=p.tags.join(', ');$('draft').checked=p.draft;$('head').textContent=file||'새 글';$('del').hidden=!file;load()}
async function run(f){$('save').disabled=$('del').disabled=true;$('msg').textContent='처리 중...';try{await f()}catch(e){$('msg').textContent='오류: '+e.message}$('save').disabled=$('del').disabled=false}
const save=()=>run(async()=>{const post={tags:$('tags').value.split(',')};for(const k of['title','description','date','updated','category','body'])post[k]=$(k).value;post.draft=$('draft').checked;
const r=await api('POST','/api/post',{file:cur,post});await edit(r.file);$('msg').textContent=r.msg});
const del=()=>{if(!confirm(cur+' 삭제?'))return;run(async()=>{const r=await api('DELETE','/api/post',{file:cur});await edit();$('msg').textContent=r.msg})};
edit();
</script></body></html>`;
