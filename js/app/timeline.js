/* Merged timeline: filters, time range, virtual-scrolled rows, line detail, copy to Excel. */
/* ---------- timeline ---------- */
function parseUserTime(v) {
  v = (v || '').trim(); if (!v) return null;
  var full = Core.parseTs(v.replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d)$/, '$1 $2:00'));
  if (full) return full.t;
  var m = /^(?:(\d\d)\/(\d\d) )?(\d{1,2}):(\d\d)(?::(\d\d))?/.exec(v);
  if (!m || !st.baseDate) return undefined;
  var y = +st.baseDate.slice(0, 4), mo = m[2] ? +m[2] - 1 : +st.baseDate.slice(5, 7) - 1, d = m[1] ? +m[1] : +st.baseDate.slice(8, 10);
  return Date.UTC(y, mo, d, +m[3], +m[4], +(m[5] || 0));
}
function onRange() {
  var f = parseUserTime($('from').value), t = parseUserTime($('to').value);
  if (f === undefined || t === undefined) { setStatus('รูปแบบเวลาไม่ถูก ใช้ 07:25 หรือ 07:25:30 หรือ 2026-10-02 07:25:30', true); return; }
  st.from = f; st.to = t; if (t != null) st.to = t + 999;
  applyFilters(); drawLanes();
}
$('from').onchange = onRange; $('to').onchange = onRange;
$('btnAll').onclick = function () { st.from = st.to = null; $('from').value = ''; $('to').value = ''; applyFilters(); drawLanes(); };
['fNoise', 'fImp', 'fDebugLvl', 'fErr', 'fHl'].forEach(function (id) { $(id).onchange = applyFilters; });
var qTimer; $('q').oninput = function () { clearTimeout(qTimer); qTimer = setTimeout(applyFilters, 200); };

function applyFilters() {
  var q = $('q').value.trim().toLowerCase();
  var fHl = $('fHl').checked, fNoise = $('fNoise').checked, fImp = $('fImp').checked, fDbg = $('fDebugLvl').checked, fErr = $('fErr').checked;
  var view = [], all = st.all, from = st.from, to = st.to, pos = st.posSel;
  var cands = st.cands.filter(function (c) { return pos === '*' || c.pos === pos; });
  var ci = 0, lastT = -Infinity;
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    if (pos !== '*' && e.pos !== pos) continue;
    if (from != null && e.t < from) continue;
    if (to != null && e.t > to) break;
    while (ci < cands.length && cands[ci].start < e.t) {
      if (cands[ci].start >= lastT || view.length === 0) view.push({ sep: true, c: cands[ci] });
      ci++;
    }
    if (st.srcOn[e.src] === false) continue;
    if (fHl && !e.hl) continue;
    var keep = !!e.rst || !!e.err || !!e.hl;
    if (!keep) {
      if (fErr) continue;
      if (fNoise && e.noise) continue;
      if (fImp && !e.imp && e.hb < 0) continue;
      if (fDbg && /^DEBUG$/i.test(e.lvl)) continue;
    } else if (fErr && !e.err) continue;
    if (q && e.raw.toLowerCase().indexOf(q) < 0) continue;
    view.push(i); lastT = e.t;
  }
  st.view = view;
  var n = view.filter(function (v) { return typeof v === 'number'; }).length;
  $('tlCount').textContent = 'แสดง ' + n.toLocaleString() + ' จาก ' + all.length.toLocaleString() + ' บรรทัด';
  var nh = 0; view.forEach(function (v) { if (typeof v === 'number' && all[v].hl) nh++; });
  $('hlCount').textContent = nh ? 'ไฮไลต์ ' + nh.toLocaleString() + ' บรรทัด' : 'ไม่มีบรรทัดที่ไฮไลต์';
  $('hlPrev').disabled = $('hlNext').disabled = !nh;
  renderPromos();
  $('tl').classList.toggle('md', !!st.multiDay);
  $('tlInner').style.height = Math.max(view.length * RH, 40) + 'px';
  renderRows(true);
}

var lastRange = '';
function renderRows(force) {
  var tl = $('tl'), inner = $('tlInner'), view = st.view;
  var top = tl.scrollTop, h = tl.clientHeight;
  var a = Math.max(0, Math.floor(top / RH) - 20), b = Math.min(view.length, Math.ceil((top + h) / RH) + 20);
  var key = a + ':' + b + ':' + st.sel;
  if (!force && key === lastRange) return;
  lastRange = key;
  if (!view.length) { inner.innerHTML = '<div class="row sep dim" style="top:0">ไม่มีบรรทัดตามตัวกรองนี้</div>'; return; }
  var html = '';
  for (var r = a; r < b; r++) {
    var v = view[r], y = r * RH;
    if (typeof v !== 'number') {
      var c = v.c;
      html += '<div class="row sep" style="top:' + y + 'px">log หลักหยุด ' + tLabel(c.start) + (c.end ? ' → กลับมา ' + tLabel(c.end) + ' · หายไป ' + Core.fmtDur(c.end - c.start) : ' · ไม่กลับมาในไฟล์') + (c.hb ? ' · Timer ควรมาตอน ' + tLabel(c.hb.expected) : '') + '</div>';
      continue;
    }
    var e = st.all[v];
    var cls = 'row' + (e.hl ? ' hl' : '') + (e.imp ? ' imp' : '') + (e.err ? ' err' : '') + (e.rst ? ' rst' : '') + (e.hb >= 0 ? ' hb' : '') + (v === st.sel ? ' sel' : '');
    html += '<div class="' + cls + '" style="top:' + y + 'px" data-i="' + v + '"><span class="t">' + tLabel(e.t, true) + '</span><span class="chip s-' + e.src + '">' + e.src + '</span><span class="lv">' + esc(e.thr) + '</span><span class="m">' + (e.rst ? '⟳ ' + esc(e.rst) + ' · ' : '') + markHl(Core.cleanText(e.msg.length > 600 ? e.msg.slice(0, 600) + '…' : e.msg), e.hl) + '</span></div>';
  }
  inner.innerHTML = html;
}
$('tl').addEventListener('scroll', function () { requestAnimationFrame(function () { renderRows(false); }); });
$('tlInner').addEventListener('click', function (ev) {
  var row = ev.target.closest('.row[data-i]'); if (!row) return;
  selectEntry(+row.dataset.i);
});
$('tl').addEventListener('keydown', function (ev) {
  if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
  var idx = st.view.indexOf(st.sel), d = ev.key === 'ArrowDown' ? 1 : -1;
  for (var r = idx + d; r >= 0 && r < st.view.length; r += d) if (typeof st.view[r] === 'number') { selectEntry(st.view[r]); ensureVisible(r); ev.preventDefault(); break; }
});

function hlRe() { try { return S.highlight ? new RegExp(S.highlight, 'gi') : null; } catch (e) { return null; } }
function markHl(text, on) {
  if (!on) return esc(text);
  var re = hlRe(); if (!re) return esc(text);
  var out = '', last = 0, m, guard = 0;
  while ((m = re.exec(text)) && guard++ < 50) {
    if (!m[0]) { re.lastIndex++; continue; }
    out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
function hlJump(dir) {
  var view = st.view, cur = st.sel >= 0 ? view.indexOf(st.sel) : (dir > 0 ? -1 : view.length);
  if (cur < 0 && st.sel >= 0) cur = dir > 0 ? -1 : view.length;
  for (var n = 1; n <= view.length; n++) {
    var r = ((cur + dir * n) % view.length + view.length) % view.length, v = view[r];
    if (typeof v === 'number' && st.all[v].hl) {
      selectEntry(v); var tl = $('tl'); tl.scrollTop = Math.max(0, r * RH - tl.clientHeight / 2); renderRows(true);
      var k = 0, pos = 0; view.forEach(function (x, ri) { if (typeof x === 'number' && st.all[x].hl) { k++; if (ri === r) pos = k; } });
      $('hlCount').textContent = 'ไฮไลต์ ' + pos + ' / ' + k + ' บรรทัด';
      return;
    }
  }
}
$('hlPrev').onclick = function () { hlJump(-1); };
$('hlNext').onclick = function () { hlJump(1); };
