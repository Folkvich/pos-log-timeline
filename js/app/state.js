/* Shared state, settings (saved in localStorage) and small helpers. Loaded first. */
var $ = function (id) { return document.getElementById(id); };
var RH = 22;
var LS_KEY = 'posLogTimeline.settings.v1', OV_KEY = 'posLogTimeline.topicOverrides.v1';
var RCPT_DEFAULT = [
  'เลขใบเสร็จ :: \\bR#0*(\\d{4,})|(?:receipt|rcpt|bill|slip|invoice)[ _.-]?(?:no|number|num|id)\\b["\'\\]\\s:=\\[]{0,6}([A-Z0-9][A-Z0-9-]{3,})',
  'Common :: \\[GetCommonTrnNo\\]\\[(\\d+)\\]|<COMMON_TRN_NO>(\\d+)<|common[ _.-]?(?:no|number|num|id)?\\b["\'\\]\\s:=\\[]{1,6}([A-Z0-9][A-Z0-9-]{3,})',
  'เวลาบิล (TRAN_DATE) :: <TRAN_DATE>[\\d-]+T([\\d:]+)<',
  'Ticket AllMember :: <TICKET_NUMBER>(\\d+)<'
].join('\n');
var overrides = {}; try { overrides = JSON.parse(localStorage.getItem(OV_KEY) || '{}') || {}; } catch (e) {}
function ovKey(c) { return c.pos + '|' + c.start; }
function topics() { return S.topicDefs; }
var S = loadSettings();
var st = { files: [], all: [], cands: [], hbRules: [], view: [], sel: -1, posSel: '*', srcOn: {}, from: null, to: null, isSample: false, multiDay: false, baseDate: null };

/* ---------- settings ---------- */
function loadSettings() {
  var s = Object.assign({}, Core.DEFAULTS);
  try { var j = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (j) Object.assign(s, j); } catch (e) {}
  // add lines that newer versions ship with but the saved copy lacks
  // topic list: start from built-ins, keep saved names / groups / keywords / custom topics
  var defs = (j && Array.isArray(j.topicDefs)) ? j.topicDefs.slice() : [];
  if (!defs.length && j && j.topics) Core.parseTopics(j.topics).forEach(function (t) { defs.push({ id: t.id, name: t.name }); });
  Core.DEFAULTS.topicDefs.forEach(function (d) {
    var have = defs.filter(function (x) { return +x.id === d.id; })[0];
    if (!have) defs.push(Object.assign({}, d));
    else { if (!have.group) have.group = d.group; have.builtin = true; }
  });
  defs.forEach(function (d) { d.id = +d.id; d.builtin = Core.DEFAULTS.topicDefs.some(function (x) { return x.id === d.id; }); });
  defs.sort(function (a, b) { return (a.id === 0) - (b.id === 0) || a.id - b.id; });
  s.topicDefs = defs;
  // receipt patterns saved before Debug-log support: keep the user's lines, add the new built-in ones
  if (s.receiptRe != null && s.receiptRe.indexOf('GetCommonTrnNo') < 0) {
    var keep = String(s.receiptRe).split('\n').filter(function (l) { return l.trim() && !/^(เลขใบเสร็จ|Common|Trans No) ::/.test(l.trim()); });
    s.receiptRe = RCPT_DEFAULT + (keep.length ? '\n' + keep.join('\n') : '');
  }
  ['forms', 'buttons', 'funcs', 'msgCodes'].forEach(function (k) {
    var sep = k === 'topics' ? '::' : '=', have = {};
    String(s[k] || '').split('\n').forEach(function (l) { var p = l.indexOf(sep); if (p > 0) have[l.slice(0, p).trim()] = 1; });
    var extra = String(Core.DEFAULTS[k]).split('\n').filter(function (l) { var p = l.indexOf(sep); return p > 0 && !have[l.slice(0, p).trim()]; });
    if (extra.length) s[k] = String(s[k] || '').replace(/\s+$/, '') + '\n' + extra.join('\n');
  });
  return s;
}
function saveSettings() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} }
function fillSettings() {
  $('sGap').value = S.gapMin; $('sCtx').value = S.ctxMin; $('sKey').value = S.keySrc;
  $('sForms').value = S.forms; $('sBtns').value = S.buttons; $('sFuncs').value = S.funcs; $('sHl').value = S.highlight || ''; $('sHlx').value = S.highlightExclude || ''; $('sCodes').value = S.msgCodes || '';
  $('sRst').value = S.restart; $('sHb').value = S.heartbeat; $('sNoise').value = S.noise; $('sImp').value = S.important;
  $('sRcpt').value = S.receiptRe != null ? S.receiptRe : RCPT_DEFAULT;
}
$('btnApply').onclick = function () {
  S.gapMin = +$('sGap').value || 6; S.ctxMin = +$('sCtx').value || 5; S.keySrc = $('sKey').value;
  S.forms = $('sForms').value; S.buttons = $('sBtns').value; S.funcs = $('sFuncs').value; S.highlight = $('sHl').value; S.highlightExclude = $('sHlx').value; S.msgCodes = $('sCodes').value;
  S.restart = $('sRst').value; S.heartbeat = $('sHb').value; S.noise = $('sNoise').value; S.important = $('sImp').value;
  S.receiptRe = $('sRcpt').value;
  saveSettings(); rebuild(); renderPromos(true); setStatus('ใช้การตั้งค่าใหม่แล้ว');
};
$('btnReset').onclick = function () { var keepTopics = S.topicDefs; S = Object.assign({}, Core.DEFAULTS); S.topicDefs = keepTopics; fillSettings(); saveSettings(); rebuild(); setStatus('คืนค่าเริ่มต้นแล้ว'); };

/* ---------- helpers ---------- */
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function setStatus(t, isErr) { var el = $('status'); el.textContent = t || ''; el.className = 'status' + (isErr ? ' err' : ''); }
function tLabel(t, ms) {
  var s = ms ? Core.fmtTimeMs(t) : Core.fmtTime(t);
  if (st.multiDay) { var d = Core.fmtDate(t); s = d.slice(8, 10) + '/' + d.slice(5, 7) + ' ' + s; }
  return s;
}
function copyText(text, okEl) {
  function fallback() { var ta = $('fallback'); ta.hidden = false; ta.value = text; ta.focus(); ta.select(); if (okEl) okEl.textContent = 'คัดลอกอัตโนมัติไม่ได้ เลือกข้อความในกล่องด้านล่างแล้วกด Ctrl+C'; }
  try {
    navigator.clipboard.writeText(text).then(function () { $('fallback').hidden = true; if (okEl) { okEl.textContent = 'คัดลอกแล้ว'; setTimeout(function () { okEl.textContent = ''; }, 2500); } }, fallback);
  } catch (e) { fallback(); }
}
