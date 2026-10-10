'use strict';

const STORE_KEY = 'anestezja-v1';
const DAY = 86400000;
const INTERVALS = [0, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY]; // Leitner boxes 0..5
const MASTERED_BOX = 3;
const LETTERS = 'ABCDE';

let Q = [];          // all questions
let byId = {};
let S = load();      // persisted state
let session = S.session || null;

const $app = document.getElementById('app');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $right = document.getElementById('bar-right');
let timerHandle = null;

// ---------- state ----------
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.q) return s;
  } catch (e) { /* ignore */ }
  return { q: {}, history: [], settings: { size: 20 }, session: null };
}
function save() {
  S.session = session;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast('Nie udało się zapisać postępu'); }
}
const prog = id => S.q[id] || (S.q[id] = { b: 0, ok: 0, bad: 0 });
const peek = id => S.q[id];
const correctOf = q => { const p = peek(q.id); return p && p.ans != null ? p.ans : q.a; };
const isSeen = id => { const p = peek(id); return !!(p && p.last); };
const isMastered = id => { const p = peek(id); return !!(p && p.b >= MASTERED_BOX); };
const isDue = id => { const p = peek(id); return !!(p && p.last && p.due <= Date.now()); };

function record(id, ok) {
  const p = prog(id);
  const now = Date.now();
  if (ok) { p.ok++; p.b = Math.min((p.b || 0) + 1, 5); p.due = now + INTERVALS[p.b]; }
  else { p.bad++; p.b = 1; p.due = now + 10 * 60000; }
  p.last = now; p.lastOk = ok;
}

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? few : many;
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function setBar(title, back = true, right = '') {
  $title.textContent = title;
  $back.hidden = !back;
  $right.innerHTML = right;
}
function srcOrder(name) {
  const m = name.match(/(Wiosna|Jesień) (\d{4})/);
  if (m) return +m[2] * 10 + (m[1] === 'Jesień' ? 5 : 0);
  const y = name.match(/(\d{2})(\d{2})$/); // "Test 02N1219"
  if (y && name.includes('N')) return (2000 + +y[2]) * 10 + 1;
  const n = name.match(/nr (\d+)/);
  return (name.includes('2009') ? 0 : 100) + (n ? +n[1] : 0);
}
function sources() {
  const map = {};
  for (const q of Q) for (const o of q.occ) (map[o.src] ||= []).push([o.n, q.id]);
  return Object.entries(map)
    .map(([name, list]) => ({ name, ids: list.sort((a, b) => a[0] - b[0]).map(x => x[1]) }))
    .sort((a, b) => srcOrder(b.name) - srcOrder(a.name));
}
function categories() {
  const map = {};
  for (const q of Q) (map[q.c || 'Inne'] ||= []).push(q.id);
  return Object.entries(map).map(([name, ids]) => ({ name, ids })).sort((a, b) => b.ids.length - a.ids.length);
}

// ---------- sessions ----------
function startSession(mode, ids, title, opts = {}) {
  session = { mode, ids, i: 0, answers: {}, title, started: Date.now(), limit: opts.limit || 0, requeued: {}, origin: opts.origin || '' };
  save();
  go('quiz');
}
function learnIds(pool) {
  const size = S.settings.size || 20;
  const due = pool.filter(isDue).sort((a, b) => S.q[a].due - S.q[b].due);
  // new questions: the ones that appeared in more exams first (more likely to return), random within the same count
  const fresh = shuffle(pool.filter(id => !isSeen(id))).sort((a, b) => byId[b].occ.length - byId[a].occ.length);
  let ids = due.slice(0, size);
  if (ids.length < size) ids = ids.concat(fresh.slice(0, size - ids.length));
  if (ids.length < size) {
    // everything seen and nothing due: take the weakest
    const rest = pool.filter(id => !ids.includes(id)).sort((a, b) => (S.q[a]?.b ?? 0) - (S.q[b]?.b ?? 0) || (S.q[a]?.due ?? 0) - (S.q[b]?.due ?? 0));
    ids = ids.concat(rest.slice(0, size - ids.length));
  }
  return ids;
}

// ---------- router ----------
const routes = {};
function go(hash) { location.hash = '#/' + hash; }
function route() {
  clearInterval(timerHandle);
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [name, ...rest] = h.split('/');
  const fn = routes[name] || routes[''];
  window.scrollTo(0, 0);
  fn(rest.join('/'));
}
$back.onclick = () => {
  const h = location.hash;
  if (h.startsWith('#/quiz') && session && session.mode === 'exam' && !session.done) {
    if (!confirm('Przerwać egzamin? Postęp tej próby zostanie zachowany i możesz do niej wrócić.')) return;
  }
  if (h.startsWith('#/source/')) return go('sources');
  if (h.startsWith('#/topic/')) return go('topics');
  go('');
};
window.addEventListener('hashchange', route);

// ---------- views ----------
routes[''] = () => {
  setBar('Anestezjologia', false);
  const total = Q.length;
  const seen = Q.filter(q => isSeen(q.id)).length;
  const mastered = Q.filter(q => isMastered(q.id)).length;
  const due = Q.filter(q => isDue(q.id)).length;
  const wrong = Q.filter(q => S.q[q.id]?.lastOk === false).length;
  const starred = Q.filter(q => S.q[q.id]?.star).length;
  const learning = seen - mastered;
  const pct = n => (100 * n / total).toFixed(2) + '%';
  const resume = session && !session.done && session.i < session.ids.length;
  $app.innerHTML = `
    <div class="card">
      <div class="stats">
        <div class="stat"><b>${mastered}</b><span>opanowane</span></div>
        <div class="stat"><b>${learning}</b><span>w trakcie</span></div>
        <div class="stat"><b>${total - seen}</b><span>nowe</span></div>
      </div>
      <div class="progress" aria-hidden="true"><i style="width:${pct(mastered)};background:var(--ok)"></i><i style="width:${pct(learning)};background:var(--warn)"></i></div>
    </div>
    ${resume ? `<button class="btn primary" data-go="quiz"><span>Kontynuuj: ${esc(session.title)}<span class="sub">pytanie ${session.i + 1} z ${session.ids.length}</span></span><span class="count">›</span></button>` : ''}
    <button class="btn ${resume ? '' : 'primary'}" id="learn"><span>Nauka<span class="sub">powtórki + nowe pytania, ${S.settings.size} na sesję</span></span><span class="count">${due ? due + ' do powtórki' : ''}</span></button>
    <button class="btn" data-go="exam"><span>Egzamin próbny<span class="sub">losowe pytania na czas, wynik na końcu</span></span><span class="count">›</span></button>
    <h2>Ćwicz wybrane</h2>
    <button class="btn" data-go="topics"><span>Tematy</span><span class="count">›</span></button>
    <button class="btn" data-go="sources"><span>Testy z poprzednich sesji</span><span class="count">${sources().length} ›</span></button>
    <button class="btn" id="wrong" ${wrong ? '' : 'disabled'}><span>Moje błędy<span class="sub">pytania, na które ostatnio odpowiedziałaś źle</span></span><span class="count">${wrong}</span></button>
    <button class="btn" id="starred" ${starred ? '' : 'disabled'}><span>Oznaczone gwiazdką</span><span class="count">${starred}</span></button>
    <h2>Inne</h2>
    <button class="btn" data-go="search"><span>Szukaj pytania</span><span class="count">›</span></button>
    <button class="btn" data-go="history"><span>Historia egzaminów</span><span class="count">${S.history.length}</span></button>
    <button class="btn" data-go="settings"><span>Ustawienia i kopia zapasowa</span><span class="count">›</span></button>
    <p class="muted small" style="text-align:center">${total} unikalnych pytań z ${sources().length} testów CMKP</p>`;
  bindGo();
  document.getElementById('learn').onclick = () => startSession('learn', learnIds(Q.map(q => q.id)), 'Nauka', { origin: '' });
  document.getElementById('wrong').onclick = () => startSession('practice', shuffle(Q.filter(q => S.q[q.id]?.lastOk === false).map(q => q.id)), 'Moje błędy');
  document.getElementById('starred').onclick = () => startSession('practice', shuffle(Q.filter(q => S.q[q.id]?.star).map(q => q.id)), 'Oznaczone');
};

function bindGo() {
  $app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
}

routes.exam = () => {
  setBar('Egzamin próbny');
  const cats = categories();
  let n = S.settings.examN || 120;
  $app.innerHTML = `
    <div class="card">
      <p style="margin-top:0">Losowe pytania, 1 minuta na pytanie. Odpowiedzi i wynik zobaczysz na końcu. Próg zdania: 60%.</p>
      <h2 style="margin-top:0">Liczba pytań</h2>
      <div class="chips" id="n">${[20, 60, 120].map(v => `<button class="chip ${v === n ? 'on' : ''}" data-n="${v}">${v}</button>`).join('')}</div>
      <h2>Zakres</h2>
      <select id="scope"><option value="">Wszystkie tematy</option>${cats.map(c => `<option>${esc(c.name)}</option>`).join('')}</select>
      <button class="btn primary" id="start" style="justify-content:center">Rozpocznij</button>
    </div>`;
  $app.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
    n = +b.dataset.n; $app.querySelectorAll('[data-n]').forEach(x => x.classList.toggle('on', x === b));
  });
  document.getElementById('start').onclick = () => {
    const scope = document.getElementById('scope').value;
    const pool = Q.filter(q => !scope || (q.c || 'Inne') === scope).map(q => q.id);
    const ids = shuffle(pool).slice(0, n);
    S.settings.examN = n;
    startSession('exam', ids, 'Egzamin ' + ids.length, { limit: ids.length * 60 });
  };
};

routes.topics = () => {
  setBar('Tematy');
  $app.innerHTML = categories().map(c => {
    const m = c.ids.filter(isMastered).length;
    return `<button class="btn" data-topic="${esc(c.name)}"><span>${esc(c.name)}<span class="sub">${m} z ${c.ids.length} opanowanych</span></span><span class="count">›</span></button>`;
  }).join('');
  $app.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => go('topic/' + encodeURIComponent(b.dataset.topic)));
};

routes.topic = name => {
  const c = categories().find(c => c.name === name);
  if (!c) return go('topics');
  setBar(name);
  const due = c.ids.filter(isDue).length;
  $app.innerHTML = `
    <button class="btn primary" id="l"><span>Nauka z tego tematu<span class="sub">${S.settings.size} pytań: powtórki i nowe</span></span><span class="count">${due ? due + ' do powtórki' : ''}</span></button>
    <button class="btn" id="all"><span>Wszystkie pytania po kolei</span><span class="count">${c.ids.length}</span></button>
    <button class="btn" id="ex"><span>Mini-egzamin (20 losowych)</span><span class="count">›</span></button>`;
  document.getElementById('l').onclick = () => startSession('learn', learnIds(c.ids), name);
  document.getElementById('all').onclick = () => startSession('practice', c.ids.slice(), name);
  document.getElementById('ex').onclick = () => { const ids = shuffle(c.ids.slice()).slice(0, 20); startSession('exam', ids, name, { limit: ids.length * 60 }); };
};

routes.sources = () => {
  setBar('Testy z poprzednich sesji');
  $app.innerHTML = sources().map(s => {
    const seen = s.ids.filter(isSeen).length;
    return `<button class="btn" data-src="${esc(s.name)}"><span>${esc(s.name)}<span class="sub">${s.ids.length} pytań · przerobione ${seen}</span></span><span class="count">›</span></button>`;
  }).join('');
  $app.querySelectorAll('[data-src]').forEach(b => b.onclick = () => go('source/' + encodeURIComponent(b.dataset.src)));
};

routes.source = name => {
  const s = sources().find(s => s.name === name);
  if (!s) return go('sources');
  setBar(name);
  $app.innerHTML = `
    <button class="btn primary" id="p"><span>Rozwiązuj z podpowiedziami<span class="sub">odpowiedź widać od razu po każdym pytaniu</span></span><span class="count">${s.ids.length}</span></button>
    <button class="btn" id="e"><span>Jako egzamin<span class="sub">${s.ids.length} min, wynik na końcu</span></span><span class="count">›</span></button>`;
  document.getElementById('p').onclick = () => startSession('practice', s.ids.slice(), name);
  document.getElementById('e').onclick = () => startSession('exam', s.ids.slice(), name, { limit: s.ids.length * 60 });
};

// ---------- quiz ----------
routes.quiz = () => {
  if (!session || !session.ids.length) return go('');
  if (session.done || session.i >= session.ids.length) return finish();
  const id = session.ids[session.i];
  const q = byId[id];
  if (!q) { session.i++; save(); return routes.quiz(); }
  const exam = session.mode === 'exam';
  const chosen = session.answers[id + '@' + session.i];
  const answered = !exam && chosen != null;
  const right = correctOf(q);
  const p = peek(id);
  setBar(session.title, true, '');
  if (exam && session.limit) startTimer();
  else $right.textContent = `${session.i + 1}/${session.ids.length}`;

  const optHtml = q.o.map((o, k) => {
    let cls = '';
    if (answered) {
      if (k === right) cls = 'ok';
      else if (k === chosen) cls = 'bad';
    } else if (k === chosen) cls = 'sel';
    return `<button class="opt ${cls}" data-k="${k}" ${answered ? 'disabled' : ''}><span class="l">${LETTERS[k]}</span><span>${esc(o)}</span></button>`;
  }).join('');

  let feedback = '';
  if (answered) {
    const ok = right == null ? null : chosen === right;
    const mine = p && p.ans != null;
    feedback = `
      <div class="card explain ${ok === false ? 'wrong' : ''}">
        <div class="verdict ${ok ? 'ok' : ok === false ? 'bad' : ''}">${ok ? 'Dobrze!' : ok === false ? `Źle – poprawna: ${LETTERS[right]}` : 'Brak klucza do tego pytania'}</div>
        ${q.e ? `<div>${esc(q.e)}</div>` : ''}
        <div class="small muted" style="margin-top:8px">${mine ? '<span class="badge mine">Twój klucz</span>' : (q.a != null ? '<span class="badge">klucz AI – niezweryfikowany</span>' : '')}
          ${q.occ.length > 1 ? ` · pojawiło się w ${q.occ.length} testach` : ''}</div>
        ${q.lit ? `<div class="lit">📖 ${esc(q.lit)}</div>` : ''}
        <div class="actions">
          <button class="link" id="fix">${mine ? 'Przywróć klucz AI' : 'Klucz jest błędny? Wskaż poprawną'}</button>
        </div>
      </div>`;
  }

  $app.innerHTML = `
    <div class="qmeta"><span>${esc(q.c || '')}</span><span>${esc(q.occ.map(o => o.src).slice(0, 2).join(', '))}${q.occ.length > 2 ? ` +${q.occ.length - 2}` : ''}
      <button class="star ${p?.star ? 'on' : ''}" id="star" aria-label="Oznacz gwiazdką">${p?.star ? '★' : '☆'}</button></span></div>
    <p class="qtext">${esc(q.q)}</p>
    <div id="opts">${optHtml}</div>
    ${feedback}
    <div class="sticky-next">${answered || exam ? `
      <div class="row">
        ${exam && session.i > 0 ? '<button class="btn" id="prev" style="justify-content:center">‹ Poprzednie</button>' : ''}
        <button class="btn primary" id="next" style="justify-content:center">${session.i + 1 >= session.ids.length ? (exam ? 'Zakończ egzamin' : 'Zakończ') : 'Dalej ›'}</button>
      </div>` : ''}
    </div>`;

  document.getElementById('star').onclick = e => {
    const pp = prog(id); pp.star = !pp.star; save();
    e.currentTarget.classList.toggle('on', pp.star); e.currentTarget.textContent = pp.star ? '★' : '☆';
  };
  if (!answered) {
    $app.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      const k = +b.dataset.k;
      session.answers[id + '@' + session.i] = k;
      if (!exam) {
        const r = correctOf(q);
        if (r != null) {
          record(id, k === r);
          if (k !== r && session.mode === 'learn' && !session.requeued[id]) { session.requeued[id] = 1; session.ids.push(id); }
        } else { prog(id).last = Date.now(); }
      }
      save();
      routes.quiz();
      if (!exam) document.querySelector('.explain')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
  const fix = document.getElementById('fix');
  if (fix) fix.onclick = () => {
    const pp = prog(id);
    if (pp.ans != null) { delete pp.ans; save(); toast('Przywrócono klucz AI'); return routes.quiz(); }
    toast('Stuknij odpowiedź, którą uważasz za poprawną');
    $app.querySelectorAll('.opt').forEach(b => {
      b.disabled = false;
      b.onclick = () => { pp.ans = +b.dataset.k; save(); toast('Zapisano Twój klucz'); routes.quiz(); };
    });
  };
  const next = document.getElementById('next');
  if (next) next.onclick = () => {
    if (exam && session.i + 1 >= session.ids.length) {
      const missing = session.ids.filter((x, i) => session.answers[x + '@' + i] == null).length;
      if (missing && !confirm(`Bez odpowiedzi: ${missing}. Zakończyć egzamin?`)) return;
    }
    session.i++; save(); routes.quiz();
  };
  const prev = document.getElementById('prev');
  if (prev) prev.onclick = () => { session.i--; save(); routes.quiz(); };
};

function startTimer() {
  const tick = () => {
    const left = session.limit - (Date.now() - session.started) / 1000;
    if (left <= 0) { clearInterval(timerHandle); toast('Koniec czasu'); session.i = session.ids.length; save(); return finish(); }
    $right.textContent = `${session.i + 1}/${session.ids.length} · ${fmtTime(left)}`;
  };
  clearInterval(timerHandle);
  tick();
  timerHandle = setInterval(tick, 1000);
}

function finish() {
  clearInterval(timerHandle);
  const exam = session.mode === 'exam';
  const items = session.ids.map((id, i) => ({ id, q: byId[id], k: session.answers[id + '@' + i] })).filter(x => x.q);
  // learn mode re-queues wrong questions: grade each question by its first attempt
  const firstSeen = {};
  const graded = items.filter(x => (firstSeen[x.id] ? false : (firstSeen[x.id] = true)));
  const scorable = graded.filter(x => correctOf(x.q) != null);
  const good = scorable.filter(x => x.k === correctOf(x.q)).length;
  if (!session.done) {
    session.done = true;
    if (exam) {
      for (const x of scorable) if (x.k != null) record(x.id, x.k === correctOf(x.q)); else record(x.id, false);
      S.history.unshift({ t: Date.now(), title: session.title, n: scorable.length, ok: good, sec: Math.round((Date.now() - session.started) / 1000) });
      S.history = S.history.slice(0, 100);
    }
    save();
  }
  const pct = scorable.length ? Math.round(100 * good / scorable.length) : 0;
  setBar(exam ? 'Wynik egzaminu' : 'Podsumowanie', true, '');
  $app.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="score" style="color:${pct >= 60 ? 'var(--ok)' : 'var(--bad)'}">${pct}%</div>
      <div>${good} z ${scorable.length} poprawnie${exam ? (pct >= 60 ? ' · zdane' : ' · poniżej progu 60%') : ''}</div>
    </div>
    <div class="row">
      <button class="btn" id="home" style="justify-content:center">Menu</button>
      ${scorable.some(x => x.k !== correctOf(x.q)) ? '<button class="btn primary" id="redo" style="justify-content:center">Powtórz błędne</button>' : ''}
    </div>
    <h2>Przegląd</h2>
    <div class="card" id="review">${graded.map((x, i) => {
      const r = correctOf(x.q); const ok = x.k === r;
      return `<div class="review-item" data-i="${i}">
        <div><span class="dot" style="background:${r == null ? 'var(--muted)' : ok ? 'var(--ok)' : 'var(--bad)'}"></span>${esc(x.q.q)}</div>
        <div class="small" style="margin:6px 0 0 18px" hidden>
          ${x.q.o.map((o, k) => `<div style="color:${k === r ? 'var(--ok)' : k === x.k ? 'var(--bad)' : 'inherit'}">${LETTERS[k]}. ${esc(o)}${k === r ? ' ✓' : k === x.k ? ' ✗' : ''}</div>`).join('')}
          ${x.k == null ? '<div class="muted">bez odpowiedzi</div>' : ''}
          ${x.q.e ? `<div class="muted" style="margin-top:6px">${esc(x.q.e)}</div>` : ''}
        </div></div>`;
    }).join('')}</div>`;
  document.getElementById('home').onclick = () => { session = null; save(); go(''); };
  const redo = document.getElementById('redo');
  if (redo) redo.onclick = () => startSession('practice', scorable.filter(x => x.k !== correctOf(x.q)).map(x => x.id), 'Poprawa błędów');
  $app.querySelectorAll('.review-item').forEach(el => el.onclick = () => { const d = el.lastElementChild; d.hidden = !d.hidden; });
}

// ---------- search ----------
routes.search = () => {
  setBar('Szukaj');
  $app.innerHTML = `<input type="search" id="s" placeholder="np. sukcynylocholina, Mallampati…" autocomplete="off"><div id="res"></div>`;
  const $s = document.getElementById('s');
  const $res = document.getElementById('res');
  const norm = s => s.toLowerCase();
  const run = () => {
    const term = norm($s.value.trim());
    if (term.length < 3) { $res.innerHTML = '<p class="muted small">Wpisz co najmniej 3 litery.</p>'; return; }
    const hits = Q.filter(q => norm(q.q + ' ' + q.o.join(' ')).includes(term)).slice(0, 50);
    const hl = s => esc(s).replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
    $res.innerHTML = hits.length ? hits.map(q => {
      const r = correctOf(q);
      return `<div class="card"><div style="font-weight:600;margin-bottom:6px">${hl(q.q)}</div>
        ${q.o.map((o, k) => `<div class="small" style="${k === r ? 'color:var(--ok);font-weight:600' : ''}">${LETTERS[k]}. ${hl(o)}${k === r ? ' ✓' : ''}</div>`).join('')}
        ${q.e ? `<div class="small muted" style="margin-top:6px">${esc(q.e)}</div>` : ''}</div>`;
    }).join('') : '<p class="muted">Brak wyników.</p>';
  };
  $s.oninput = run; run(); $s.focus();
};

// ---------- history ----------
routes.history = () => {
  setBar('Historia egzaminów');
  $app.innerHTML = S.history.length ? `<div class="card">${S.history.map(h => {
    const pct = Math.round(100 * h.ok / (h.n || 1));
    return `<div class="review-item" style="cursor:default"><b style="color:${pct >= 60 ? 'var(--ok)' : 'var(--bad)'}">${pct}%</b> · ${esc(h.title)}
      <div class="small muted">${new Date(h.t).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })} · ${h.ok}/${h.n} · ${fmtTime(h.sec)}</div></div>`;
  }).join('')}</div>` : '<p class="muted">Nie ma jeszcze żadnych egzaminów próbnych.</p>';
};

// ---------- settings ----------
routes.settings = () => {
  setBar('Ustawienia');
  const overrides = Object.values(S.q).filter(p => p.ans != null).length;
  $app.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">Pytań w jednej sesji nauki</h2>
      <div class="chips">${[10, 20, 30, 50].map(v => `<button class="chip ${v === S.settings.size ? 'on' : ''}" data-size="${v}">${v}</button>`).join('')}</div>
    </div>
    <h2>Kopia zapasowa postępu</h2>
    <div class="card">
      <p class="small muted" style="margin-top:0">Postęp jest zapisany tylko na tym telefonie. Co jakiś czas zrób kopię – przyda się przy zmianie telefonu.</p>
      <button class="btn" id="exp"><span>Zapisz kopię do pliku</span><span class="count">⇩</span></button>
      <label class="btn" style="margin-bottom:0"><span>Wczytaj kopię z pliku</span><span class="count">⇧</span><input type="file" id="imp" accept="application/json,.json" hidden></label>
    </div>
    <h2>O kluczu odpowiedzi</h2>
    <div class="card small">
      Pytania pochodzą z testów CMKP. Oficjalnego klucza nie ma w plikach PDF, więc poprawne odpowiedzi i wyjaśnienia
      przygotował model AI (Claude) – mogą zawierać błędy. Jeśli się nie zgadzasz, w pytaniu wybierz
      „Klucz jest błędny?” i wskaż swoją odpowiedź. Twoje poprawki: <b>${overrides}</b>.
    </div>
    <h2>Strefa ryzyka</h2>
    <button class="btn" id="reset" style="color:var(--bad)"><span>Wyzeruj cały postęp</span></button>
    <p class="small muted" style="text-align:center">Wersja danych: ${esc(window.DATA_VERSION || '')}</p>`;
  $app.querySelectorAll('[data-size]').forEach(b => b.onclick = () => { S.settings.size = +b.dataset.size; save(); routes.settings(); });
  document.getElementById('exp').onclick = exportProgress;
  document.getElementById('imp').onchange = e => importProgress(e.target.files[0]);
  document.getElementById('reset').onclick = () => {
    if (!confirm('Na pewno usunąć cały postęp, gwiazdki i Twoje poprawki klucza?')) return;
    const keep = S.settings; S = load(); S.q = {}; S.history = []; S.settings = keep; session = null; save(); toast('Wyzerowano'); go('');
  };
};

async function exportProgress() {
  const name = `anestezja-postep-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify({ app: 'anestezja', v: 1, ...S, session: null })], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function importProgress(f) {
  if (!f) return;
  f.text().then(t => {
    const d = JSON.parse(t);
    if (d.app !== 'anestezja' || !d.q) throw new Error('format');
    if (!confirm('Zastąpić obecny postęp danymi z pliku?')) return;
    S = { q: d.q, history: d.history || [], settings: d.settings || { size: 20 }, session: null };
    session = null; save(); toast('Wczytano kopię'); go('');
  }).catch(() => toast('To nie jest plik kopii z tej aplikacji'));
}

// ---------- boot ----------
fetch('questions.json').then(r => r.json()).then(d => {
  window.DATA_VERSION = d.version;
  Q = d.questions;
  byId = Object.fromEntries(Q.map(q => [q.id, q]));
  route();
}).catch(() => { $app.innerHTML = '<p class="loading">Nie udało się wczytać pytań. Otwórz aplikację raz z internetem.</p>'; });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js');
}
