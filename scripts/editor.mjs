// 로컬 전용 게시글 편집기: npm run editor → http://127.0.0.1:4322
// 저장/삭제 시 해당 파일만 git commit + push (main push → GitHub Pages 자동 배포)
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 4322;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'src/content/posts');
const PUBLIC = join(ROOT, 'public');
const BASE = '/LeJus-Blog/';
const DEFAULT_CATEGORIES = ['Security', 'Network', 'Reversing', 'Web', 'System', 'Dev', 'Note'];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.css': 'text/css' };
// 로컬 기준 오늘 날짜 (YYYY-MM-DD)
const today = () => new Date().toLocaleDateString('sv-SE');

// 블로그와 같은 설정(astro.config.mjs)으로 Markdown 렌더링
let processor;
async function renderMarkdown(md) {
  if (!processor) {
    const { createMarkdownProcessor } = await import('@astrojs/markdown-remark');
    const { default: config } = await import('../astro.config.mjs');
    processor = await createMarkdownProcessor(config.markdown);
  }
  return (await processor.render(md)).code;
}
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
    `category: ${yamlStr(p.category)}`,
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
      const { title, date, draft, category } = parse(readFileSync(join(DIR, file), 'utf8'));
      return { file, title, date, draft, category };
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const categories = [...new Set([...DEFAULT_CATEGORIES, ...list.map((p) => p.category)])];
    return send(200, { posts: list, categories, today: today() });
  }
  if (req.method === 'GET' && url.pathname === '/preview.css') {
    return send(200, readFileSync(join(ROOT, 'src/styles/global.css'), 'utf8'), 'text/css');
  }
  // 미리보기에서 /LeJus-Blog/images/... 같은 public 파일 표시
  if (req.method === 'GET' && url.pathname.startsWith(BASE)) {
    const path = normalize(join(PUBLIC, decodeURIComponent(url.pathname.slice(BASE.length))));
    if (!path.startsWith(PUBLIC) || !existsSync(path) || !statSync(path).isFile()) return send(404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream' });
    return res.end(readFileSync(path));
  }
  if (req.method === 'GET' && url.pathname === '/api/post') {
    return send(200, parse(readFileSync(checkFile(url.searchParams.get('file')), 'utf8')));
  }

  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};

  if (req.method === 'POST' && url.pathname === '/api/preview') {
    return send(200, { html: await renderMarkdown(body.body || '') });
  }

  if (req.method === 'POST' && url.pathname === '/api/post') {
    const p = body.post;
    if (!p.title?.trim() || !p.description?.trim()) throw new Error('제목과 설명은 필수');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new Error('날짜 형식은 YYYY-MM-DD');
    p.category = p.category?.trim();
    if (!p.category || /[\r\n]/.test(p.category)) throw new Error('카테고리를 입력하세요');
    const isNew = !body.file;
    const file = body.file || slugify(p.date, p.title);
    const path = checkFile(file);
    if (isNew && existsSync(path)) throw new Error(`이미 존재: ${file}`);
    const post = { ...p, tags: p.tags.map((t) => t.trim()).filter(Boolean) };
    if (isNew) post.updated = '';
    else {
      // 내용이 바뀐 경우에만 수정일을 오늘로 갱신
      const prev = readFileSync(path, 'utf8');
      post.updated = parse(prev).updated;
      if (serialize(post) === serialize(parse(prev))) return send(200, { file, msg: '변경 없음' });
      post.updated = today();
    }
    writeFileSync(path, serialize(post));
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


const PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LeJus 편집기</title>
<style>
:root{--bg:#f6f7f9;--surface:#fff;--border:#e5e7eb;--text:#111827;--soft:#4b5563;--muted:#9ca3af;--accent:#0891b2;--accent-soft:rgba(8,145,178,.1);--danger:#dc2626;--radius:10px;
--sans:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;--mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--surface:#121926;--border:#1f2937;--text:#e5e7eb;--soft:#9ca3af;--muted:#6b7280;--accent:#22d3ee;--accent-soft:rgba(34,211,238,.12);--danger:#f87171}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 var(--sans);background:var(--bg);color:var(--text);display:flex;height:100vh}
aside{width:300px;flex-shrink:0;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column}
.brand{padding:18px 16px 12px;font-weight:700;font-size:16px}.brand span{color:var(--accent)}
.side-top{padding:0 12px 12px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid var(--border)}
nav{overflow:auto;flex:1;padding:6px}
nav .item{padding:10px 12px;border-radius:8px;cursor:pointer}nav .item:hover{background:var(--bg)}nav .item.on{background:var(--accent-soft)}
nav .t{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}nav .m{font-size:12px;color:var(--muted)}
.badge{display:inline-block;font-size:11px;padding:0 6px;border-radius:4px;background:var(--accent-soft);color:var(--accent);margin-left:4px}
main{flex:1;overflow:auto;padding:28px 32px 0}.wrap{max-width:900px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
h1{margin:0;font-size:20px}.file{color:var(--muted);font:12px var(--mono)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.f{display:flex;flex-direction:column;gap:6px}.f.w2{grid-column:span 2}.f.w4{grid-column:span 4}
.f>span{font-size:12px;font-weight:600;color:var(--soft)}
input,select,textarea{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font:inherit;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
textarea{min-height:60vh;resize:vertical;font:13px/1.6 var(--mono)}
input[readonly]{color:var(--muted);cursor:default}input[readonly]:focus{border-color:var(--border);box-shadow:none}
.tabs{display:flex;gap:4px;margin-bottom:-8px}.tabs button{padding:6px 12px;font-size:13px;border-color:transparent;background:none;color:var(--soft)}.tabs button.on{background:var(--surface);border-color:var(--border);color:var(--text)}
.editor{display:grid;gap:12px}.editor.split{grid-template-columns:1fr 1fr}
iframe{width:100%;min-height:60vh;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
.editor.edit iframe,.editor.preview textarea{display:none}
.chk{flex-direction:row;align-items:center;gap:8px;align-self:end;padding-bottom:9px}.chk input{width:auto}
.bar{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;padding:12px 0;background:var(--bg)}
button{padding:9px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.5;cursor:default}.primary{background:var(--accent);border-color:var(--accent);color:#fff}.danger{color:var(--danger)}
#msg{font-size:13px;color:var(--soft)}#msg.err{color:var(--danger)}
@media (max-width:760px){.editor.split{grid-template-columns:1fr}body{flex-direction:column;height:auto}aside{width:auto;max-height:40vh}main{padding:16px}.card{grid-template-columns:1fr 1fr}.f.w2,.f.w4{grid-column:span 2}}
</style></head><body>
<aside><div class="brand">LeJus <span>Editor</span></div>
<div class="side-top"><button class="primary" onclick="edit()">+ 새 글</button><input id="q" placeholder="검색" oninput="render()"></div>
<nav id="list"></nav></aside>
<main><div class="wrap">
<div><h1 id="head"></h1><div class="file" id="file"></div></div>
<div class="card">
<label class="f w4"><span>제목</span><input id="title"></label>
<label class="f w4"><span>설명</span><input id="description"></label>
<label class="f"><span>작성일</span><input id="date" type="date"></label>
<label class="f"><span>수정일 (저장 시 자동)</span><input id="updated" type="date" readonly tabindex="-1"></label>
<label class="f"><span>카테고리</span><input id="category" list="cats" placeholder="선택 또는 새로 입력"><datalist id="cats"></datalist></label>
<label class="f chk"><input id="draft" type="checkbox"><span>draft (비공개)</span></label>
<label class="f w4"><span>태그 (쉼표로 구분)</span><input id="tags"></label>
</div>
<div class="tabs"><button id="tab-edit" class="on" onclick="mode('edit')">편집</button><button id="tab-split" onclick="mode('split')">나란히</button><button id="tab-preview" onclick="mode('preview')">미리보기</button></div>
<div class="editor edit"><textarea id="body" placeholder="Markdown 본문" oninput="schedule()"></textarea><iframe id="preview" title="미리보기"></iframe></div>
<div class="bar"><button class="primary" id="save" onclick="save()">저장 + 배포</button><button class="danger" id="del" onclick="del()">삭제</button><span id="msg"></span></div>
</div></main>
<script>
let cur=null,posts=[],today='',timer,view='edit';const $=id=>document.getElementById(id);
const api=async(m,u,b)=>{const r=await fetch(u,{method:m,headers:{'Content-Type':'application/json'},body:b&&JSON.stringify(b)});const j=await r.json();if(!r.ok)throw new Error(j.error);return j};
const msg=(t,err)=>{$('msg').textContent=t;$('msg').className=err?'err':''};
function render(){const q=$('q').value.toLowerCase();$('list').innerHTML='';for(const p of posts){if(q&&!(p.title+p.file).toLowerCase().includes(q))continue;
const d=document.createElement('div');d.className='item'+(p.file===cur?' on':'');d.innerHTML='<div class="t"></div><div class="m"></div>';
d.firstChild.textContent=p.title||p.file;d.lastChild.textContent=p.date;if(p.draft)d.lastChild.insertAdjacentHTML('beforeend','<span class="badge">draft</span>');
d.onclick=()=>edit(p.file);$('list').appendChild(d)}}
async function load(){const r=await api('GET','/api/posts');posts=r.posts;today=r.today;$('cats').innerHTML='';for(const c of r.categories){const o=document.createElement('option');o.value=c;$('cats').appendChild(o)}render()}
function mode(m){view=m;document.querySelector('.editor').className='editor '+m;for(const k of['edit','split','preview'])$('tab-'+k).classList.toggle('on',k===m);preview()}
function schedule(){clearTimeout(timer);timer=setTimeout(preview,300)}
async function preview(){if(view==='edit')return;const {html}=await api('POST','/api/preview',{body:$('body').value});
const dark=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';const f=$('preview'),y=f.contentWindow?f.contentWindow.scrollY:0;
f.srcdoc='<!doctype html><html data-theme="'+dark+'"><head><meta charset="utf-8"><link rel="stylesheet" href="/preview.css"><style>body{padding:24px}</style></head><body><div class="prose">'+html+'</div></body></html>';
f.onload=()=>f.contentWindow.scrollTo(0,y)}
async function edit(file){cur=file||null;msg('');await load();const p=file?await api('GET','/api/post?file='+encodeURIComponent(file)):{title:'',description:'',date:today,updated:'',category:'Note',tags:[],draft:false,body:''};
for(const k of['title','description','date','updated','category','body'])$(k).value=p[k]||'';$('tags').value=p.tags.join(', ');$('draft').checked=p.draft;
$('head').textContent=file?'글 수정':'새 글';$('file').textContent=file||'';$('del').hidden=!file;render();preview()}
async function run(f){$('save').disabled=$('del').disabled=true;msg('처리 중...');try{await f()}catch(e){msg('오류: '+e.message,1)}$('save').disabled=$('del').disabled=false}
const save=()=>run(async()=>{const post={tags:$('tags').value.split(',')};for(const k of['title','description','date','updated','category','body'])post[k]=$(k).value;post.draft=$('draft').checked;
const r=await api('POST','/api/post',{file:cur,post});await edit(r.file);msg(r.msg)});
const del=()=>{if(!confirm(cur+' 을(를) 삭제할까요?'))return;run(async()=>{const r=await api('DELETE','/api/post',{file:cur});await edit();msg(r.msg)})};
edit();
</script></body></html>`;
