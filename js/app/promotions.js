/* Promotion results: bill / receipt lookup, XML-JSON viewer, promo tables. */
/* ---------- promotions ---------- */
var promoKey = '';
$('fPromoEmpty').onchange = function () { renderPromos(true); };
function money(v) { return v == null || isNaN(v) ? '-' : (+v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/* bill (transaction) that a promotion result belongs to: from the BeginSale after the previous receipt, to the next receipt print */
var BILL_END = /EndPrintReceipt|Receive Function : PrintReceipt\]|Command=PrintReceipt\b|\[NECPrinter\.EndTransaction\]|\[(?:VoidTransaction|CancelTransaction|VoidAll|CancelSale)\]\[\d+\]\[End/i;
var BILL_START = /\[BeginSale\]\[0\]\[BeginSale\]|Send Function : BeginSale\]|Command=BeginSale\b/;
function rcptRules() {
  var out = [];
  String(S.receiptRe != null ? S.receiptRe : RCPT_DEFAULT).split('\n').forEach(function (l) {
    var p = l.indexOf('::'); if (p < 0) return;
    try { out.push({ label: l.slice(0, p).trim() || 'เลขบิล', re: new RegExp(l.slice(p + 2).trim(), 'i') }); } catch (e) {}
  });
  return out;
}
var NEW_BILL = /State=\[Idle\]\[BeginSale\]\[0\]|Command=InitialSale\b/;
function billOf(p, rules) {
  var all = st.all, i, e, endI = -1, cutI = -1, prevEnd = -1, startI = -1;
  // forward: the receipt print closes this bill; a new bill starting first means this one never finished in the log
  for (i = p.i + 1; i < all.length; i++) {
    e = all[i]; if (e.t - p.t > 30 * 60000) break; if (e.pos !== p.pos) continue;
    if (BILL_END.test(e.raw)) { endI = i; break; }
    if (NEW_BILL.test(e.raw)) { cutI = i; break; }
  }
  // backward: nearest bill opening (Idle -> BeginSale) since the previous receipt
  for (i = p.i - 1; i >= 0; i--) {
    e = all[i]; if (p.t - e.t > 60 * 60000) break; if (e.pos !== p.pos) continue;
    if (BILL_END.test(e.raw)) { prevEnd = i; break; }
    if (NEW_BILL.test(e.raw)) { startI = i; break; }
  }
  // the bill really starts at the first item scanned after that point (matches the receipt time in the database)
  var anchor = startI >= 0 ? startI : prevEnd;
  if (anchor >= 0) for (i = anchor + (startI >= 0 ? 0 : 1); i <= p.i; i++) { e = all[i]; if (e.pos === p.pos && BILL_START.test(e.raw)) { startI = i; break; } }
  var b = { startI: startI, endI: endI, start: startI >= 0 ? all[startI].t : null, end: endI >= 0 ? all[endI].t : null, ids: [], cut: cutI >= 0 };
  var lo = startI >= 0 ? startI : (prevEnd >= 0 ? prevEnd + 1 : p.i);
  var hiI = cutI >= 0 ? cutI : all.length, hiT = (endI >= 0 ? all[endI].t : p.t) + 10000;
  var seen = {};
  for (i = lo; i < hiI && all[i].t <= hiT; i++) {
    e = all[i]; if (e.pos !== p.pos) continue;
    if (i > p.i && NEW_BILL.test(e.raw)) break;
    for (var r = 0; r < rules.length; r++) {
      if (seen[rules[r].label]) continue;
      var m = rules[r].re.exec(e.raw);
      if (!m) continue;
      var val = ''; for (var g = 1; g < m.length; g++) if (m[g]) { val = m[g]; break; }
      val = val || m[0];
      if (val) { seen[rules[r].label] = 1; b.ids.push({ label: rules[r].label, val: val, i: i, t: e.t }); }
    }
    if (b.ids.length === rules.length) break;
  }
  return b;
}
function durLabel(ms) { var s = Math.round(ms / 1000); return s < 60 ? s + ' วิ' : Math.floor(s / 60) + ' นาที ' + (s % 60) + ' วิ'; }

/* ---------- XML / JSON viewer ---------- */
var dlg = { xml: '', json: '', tab: 'json', name: 'promo' };
function xmlToObj(el) {
  var o = {};
  for (var a = 0; a < el.attributes.length; a++) o['@' + el.attributes[a].name] = el.attributes[a].value;
  var txt = '';
  for (var c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1) {
      var k = c.nodeName, v = xmlToObj(c);
      if (!(k in o)) o[k] = v; else { if (!Array.isArray(o[k])) o[k] = [o[k]]; o[k].push(v); }
    } else if (c.nodeType === 3 || c.nodeType === 4) txt += c.nodeValue;
  }
  txt = txt.trim();
  if (txt) { if (Object.keys(o).length) o['#text'] = txt; else return txt; }
  return o;
}
function prettyXml(node, ind) {
  ind = ind || '';
  if (node.nodeType === 3 || node.nodeType === 4) { var t = node.nodeValue.trim(); return t ? ind + t + '\n' : ''; }
  if (node.nodeType !== 1) return '';
  var s = ind + '<' + node.nodeName;
  for (var a = 0; a < node.attributes.length; a++) s += ' ' + node.attributes[a].name + '="' + node.attributes[a].value + '"';
  var kids = Array.prototype.filter.call(node.childNodes, function (c) { return c.nodeType === 1 || ((c.nodeType === 3 || c.nodeType === 4) && c.nodeValue.trim()); });
  if (!kids.length) return s + ' />\n';
  if (kids.length === 1 && kids[0].nodeType !== 1) return s + '>' + kids[0].nodeValue.trim() + '</' + node.nodeName + '>\n';
  return s + '>\n' + kids.map(function (c) { return prettyXml(c, ind + '  '); }).join('') + ind + '</' + node.nodeName + '>\n';
}
function colorJson(s) {
  return esc(s).replace(/(&quot;(?:[^&\\]|\\.|&(?!quot;))*&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?)\b/g, function (m, str, colon, num) {
    if (str) return colon ? '<span class="k">' + str + '</span>' + colon : '<span class="s">' + str + '</span>';
    return '<span class="n">' + num + '</span>';
  });
}
function colorXml(s) {
  return esc(s).replace(/(&lt;\/?)([\w:.-]+)|([\w:.-]+)=(&quot;[^&]*?(?:&(?!quot;)[^&]*?)*&quot;)/g, function (m, lt, tag, an, av) {
    if (tag) return lt + '<span class="tg">' + tag + '</span>';
    return '<span class="at">' + an + '</span>=<span class="s">' + av + '</span>';
  });
}
function openXml(p, bill) {
  var xml = p.xml || '', warn = '';
  var doc = new DOMParser().parseFromString(xml, 'application/xml');
  var bad = doc.getElementsByTagName('parsererror').length > 0;
  if (bad) {
    // log line may be cut off; close open tags so the part that exists can still be read
    var stack = [], re = /<(\/?)([\w:.-]+)[^>]*?(\/?)>/g, m;
    while ((m = re.exec(xml))) { if (m[3]) continue; if (m[1]) stack.pop(); else stack.push(m[2]); }
    var fixed = xml.replace(/<[^>]*$/, '') + stack.reverse().map(function (t) { return '</' + t + '>'; }).join('');
    doc = new DOMParser().parseFromString(fixed, 'application/xml');
    bad = doc.getElementsByTagName('parsererror').length > 0;
    warn = bad ? 'อ่าน XML ไม่ได้ (log อาจถูกตัด) แสดงข้อความดิบแทน' : 'XML ใน log ไม่ครบ (ถูกตัดท้าย) เว็บปิดแท็กให้เองเพื่อแสดงส่วนที่มี';
  }
  if (!bad) {
    var root = doc.documentElement, obj = {}; obj[root.nodeName] = xmlToObj(root);
    dlg.json = JSON.stringify(obj, null, 2); dlg.xml = prettyXml(root).replace(/\n$/, '');
  } else { dlg.json = JSON.stringify({ raw: xml }, null, 2); dlg.xml = xml; }
  dlg.name = 'promo_' + p.pos + '_' + Core.fmtTime(p.t).replace(/:/g, '') + (bill && bill.ids[0] ? '_' + bill.ids[0].val : '');
  $('xmlDlgTitle').textContent = 'ผลคำนวณโปร ' + tLabel(p.t, true) + (p.method ? ' · ' + p.method : '');
  $('xmlDlgSub').textContent = 'เครื่อง ' + p.pos + (bill && bill.ids.length ? ' · ' + bill.ids.map(function (x) { return x.label + ' ' + x.val; }).join(' · ') : '') +
    (bill && bill.start != null ? ' · บิล ' + tLabel(bill.start) + ' – ' + (bill.end != null ? tLabel(bill.end) : '?') : '');
  $('xmlWarn').hidden = !warn; $('xmlWarn').textContent = warn;
  $('xmlFind').value = ''; $('xmlOk').textContent = '';
  showTab(dlg.tab);
  $('xmlBody').scrollTop = 0; $('xmlBody').scrollLeft = 0;
  var d = $('xmlDlg'); if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
}
function showTab(tab) {
  dlg.tab = tab;
  $('xmlTabJson').setAttribute('aria-selected', tab === 'json'); $('xmlTabXml').setAttribute('aria-selected', tab === 'xml');
  paintDlg();
}
function paintDlg() {
  var src = dlg.tab === 'json' ? dlg.json : dlg.xml;
  var html = dlg.tab === 'json' ? colorJson(src) : colorXml(src);
  var q = $('xmlFind').value.trim(), n = 0;
  if (q) {
    var qe = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // highlight only outside of tags
    html = html.replace(/(<[^>]+>)|([^<]+)/g, function (m, tag, text) {
      if (tag) return tag;
      return text.replace(new RegExp(qe, 'gi'), function (x) { n++; return '<mark>' + x + '</mark>'; });
    });
  }
  $('xmlBody').innerHTML = html;
  $('xmlFindN').textContent = q ? (n ? 'พบ ' + n + ' จุด' : 'ไม่พบ') : '';
  var first = $('xmlBody').querySelector('mark'); if (first) { first.classList.add('cur'); first.scrollIntoView({ block: 'center' }); }
}
$('xmlTabJson').onclick = function () { showTab('json'); };
$('xmlTabXml').onclick = function () { showTab('xml'); };
$('xmlFind').oninput = paintDlg;
$('xmlDlgClose').onclick = function () { var d = $('xmlDlg'); if (d.close) d.close(); else d.removeAttribute('open'); };
$('xmlDlg').addEventListener('click', function (ev) { if (ev.target === this && this.close) this.close(); });
$('xmlCopy').onclick = function () { copyText(dlg.tab === 'json' ? dlg.json : dlg.xml, $('xmlOk')); };
function renderPromos(force) {
  var key = st.posSel + '|' + st.from + '|' + st.to + '|' + st.all.length;
  if (!force && key === promoKey) return;
  promoKey = key;
  var from = st.from, to = st.to, pos = st.posSel;
  var list = Core.promoResults(st.all, function (e) { return (pos === '*' || e.pos === pos) && (from == null || e.t >= from) && (to == null || e.t <= to); });
  var nEmpty = list.filter(function (x) { return !x.lines.length; }).length;
  if (!$('fPromoEmpty').checked) list = list.filter(function (x) { return x.lines.length; });
  var box = $('promos');
  $('promoNote').textContent = (list.length ? 'พบ ' + list.length + ' ครั้ง ในช่วงเวลา / เครื่องที่เลือกใน Timeline · ล่าสุดอยู่บนสุด · ราคาเป็นบาท' : '') + (nEmpty && !$('fPromoEmpty').checked ? ' · ซ่อน ' + nEmpty + ' ครั้งที่ไม่มีโปร' : '');
  if (!list.length) { box.innerHTML = '<div class="empty">ไม่พบผลตอบกลับจาก Promotion (PromoSrvMessage ใน Debug log) ในช่วงเวลานี้' + (st.from != null ? ' ลองกด "ทั้งหมด" ที่ช่วงเวลา' : '') + '</div>'; return; }
  var shown = list.slice(-30).reverse();
  var rules = rcptRules();
  shown.forEach(function (p) { p.bill = billOf(p, rules); });
  box.innerHTML = (list.length > 30 ? '<div class="sub">แสดง 30 ครั้งล่าสุด ใช้ช่วงเวลาใน Timeline เพื่อดูครั้งที่เก่ากว่า</div>' : '') + shown.map(function (p, k) {
    var units = p.lines.reduce(function (a, l) { return a + (l.units || 0); }, 0);
    var ok = p.ret === '' || p.ret === '0';
    var b = p.bill;
    var billHtml = '<span class="bill">' +
      (b.ids.length ? b.ids.map(function (x) { return '<span class="pill rc" title="พบใน log เวลา ' + esc(tLabel(x.t)) + '">' + esc(x.label) + ' ' + esc(x.val) + '</span>'; }).join('') : '<span class="pill" title="ตั้งรูปแบบได้ที่ ตั้งค่าการวิเคราะห์ → เลขใบเสร็จ / Common">ไม่พบเลขใบเสร็จใน log</span>') +
      '<span class="sub">บิล ' + (b.start != null ? link(b.startI, tLabel(b.start)) : '?') + ' – ' + (b.end != null ? link(b.endI, tLabel(b.end)) : b.cut ? '<span title="มีการเริ่มบิลใหม่ก่อนพิมพ์ใบเสร็จ อาจยกเลิกบิลหรือ log ไม่ครบ">ไม่พบการพิมพ์ใบเสร็จ</span>' : '<span title="ยังไม่พบการพิมพ์ใบเสร็จหลังจากนี้">ยังไม่จบบิล</span>') +
      (b.start != null && b.end != null ? ' (' + durLabel(b.end - b.start) + ')' : '') + '</span></span>';
    var head = '<span class="mono">' + link(p.i, tLabel(p.t)) + '</span> ' + billHtml + (p.n > 1 ? ' <span class="pill">ซ้ำ ×' + p.n + '</span>' : '') +
      ' <span class="pill ' + (ok ? 'ok' : 'err') + '">ReturnCode ' + (p.ret === '' ? '-' : esc(p.ret)) + '</span>' +
      (p.method ? ' <span class="mono sub">' + esc(p.method) + '</span>' : '') +
      ' · ' + p.lines.length + ' โปร · ส่วนลดเงิน <b>' + money(p.discTotal) + '</b> บาท' + (units ? ' · รางวัลอื่น ' + units + ' หน่วย' : '') + (p.truncated ? ' <span class="pill err">XML ไม่ครบ</span>' : '');
    var promoRows = p.lines.map(function (l) {
      var its = l.items.map(function (x) { return '<span class="mono">' + esc(x.plu || '-') + '</span> ' + money(x.price) + '×' + x.qty; }).join('<br>');
      var rw = l.disc ? '<b>-' + money(l.disc) + '</b> บาท' : (l.units ? l.units + ' หน่วย' : '<span class="sub">-</span>');
      return '<tr><td class="mono">' + esc(l.id) + '</td><td class="mono">' + esc(l.ext || '-') + '</td><td class="pname">' + esc(l.desc || '-') + '</td><td class="mono">' + esc(l.promType) + ' / ' + esc(l.rewardType) + (l.triggered === '1' ? '' : '') + '</td><td>' + (its || '<span class="sub">-</span>') + '</td><td class="num">' + rw + '</td></tr>';
    }).join('');
    var items = Object.keys(p.items).map(function (k2) { return p.items[k2]; }).sort(function (a, b) { return parseFloat(a.seq) - parseFloat(b.seq); });
    var itemRows = items.map(function (x) {
      return '<tr><td class="mono">' + esc(x.seq || '-') + '</td><td class="mono">' + esc(x.plu) + '</td><td class="num">' + money(x.price) + ' × ' + x.qty + '</td><td class="num">' + money(x.gross) + '</td><td class="num">' + (x.disc ? '-' + money(x.disc) : '0.00') + '</td><td class="num"><b>' + money(x.net) + '</b></td><td class="mono">' + esc(x.promos.join(', ') || '-') + '</td></tr>';
    }).join('');
    var tg = items.reduce(function (a, x) { return a + (x.gross || 0); }, 0), tn = items.reduce(function (a, x) { return a + (x.net || 0); }, 0);
    return '<details class="promo"' + (k === 0 ? ' open' : '') + '><summary>' + head + '</summary>' +
      '<div class="promo-tools"><button type="button" data-xml="' + k + '">ดู XML / JSON</button><span class="sub">ข้อมูลเต็มที่ Promotion ส่งกลับมา</span></div>' +
      (p.freeText ? '<div class="sub">FreeText: ' + esc(p.freeText) + '</div>' : '') +
      '<div class="tbl-wrap"><table class="ptbl"><thead><tr><th>Promo ID</th><th>Ref</th><th>ชื่อโปร</th><th>PromType / RewardType</th><th>สินค้าที่เข้าโปร (PLU ราคา×จำนวน)</th><th class="num">ได้รับ</th></tr></thead><tbody>' + (promoRows || '<tr><td colspan="6" class="sub">ไม่มีรายการโปร</td></tr>') + '</tbody></table></div>' +
      (items.length ? '<div class="tbl-wrap"><table class="ptbl"><thead><tr><th>Seq</th><th>PLU</th><th class="num">ราคา × จำนวน</th><th class="num">ราคารวม</th><th class="num">ส่วนลด</th><th class="num">เหลือ (บาท)</th><th>โปรที่ได้ส่วนลด</th></tr></thead><tbody>' + itemRows +
        '<tr class="tot"><td colspan="3">รวมเฉพาะสินค้าที่เข้าโปร</td><td class="num">' + money(tg) + '</td><td class="num">' + (p.discTotal ? '-' + money(p.discTotal) : '0.00') + '</td><td class="num"><b>' + money(tn) + '</b></td><td></td></tr></tbody></table></div>' : '') +
      '</details>';
  }).join('');
  Array.prototype.forEach.call(box.querySelectorAll('a[data-i]'), function (a) { a.onclick = function (ev) { ev.preventDefault(); jumpToEntry(+a.dataset.i, true); }; });
  Array.prototype.forEach.call(box.querySelectorAll('button[data-xml]'), function (bt) { bt.onclick = function () { var p = shown[+bt.dataset.xml]; openXml(p, p.bill); }; });
}

function selectEntry(i) {
  st.sel = i; renderRows(true);
  var e = st.all[i], f = st.files[e.f];
  $('detail').hidden = false;
  $('detailMeta').innerHTML = '<span class="chip s-' + e.src + '">' + Core.SRC_LABEL[e.src] + '</span><span class="mono">' + Core.fmtDate(e.t) + ' ' + Core.fmtTimeMs(e.t) + '</span><span>' + esc(f.path) + ' บรรทัด ' + e.ln + '</span>' + (e.logger ? '<span class="mono">' + esc(e.logger) + '</span>' : '') + '<span>thread ' + esc(e.thr) + '</span>';
  $('detailRaw').textContent = e.raw;
  if (/\uFFFD/.test(e.raw)) $('detailMeta').innerHTML += '<span class="warn">ตัว &#xFFFD; คือภาษาไทยที่เสียไปก่อนเปิดในเว็บ (ไฟล์ถูกแปลงระหว่าง copy / ส่งต่อ) กู้คืนจากไฟล์นี้ไม่ได้</span>';
}
function ensureVisible(r) {
  var tl = $('tl'), y = r * RH;
  if (y < tl.scrollTop || y > tl.scrollTop + tl.clientHeight - RH) tl.scrollTop = y - tl.clientHeight / 2;
}
function jumpToTime(t, select) {
  var view = st.view, lo = 0, hi = view.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; var v = view[mid]; var vt = typeof v === 'number' ? st.all[v].t : v.c.start; if (vt < t) lo = mid + 1; else hi = mid; }
  var r = Math.max(0, lo - 1);
  var tl = $('tl'); tl.scrollTop = Math.max(0, r * RH - tl.clientHeight * 0.6);
  renderRows(true);
  if (select) { for (var k = r; k >= 0; k--) if (typeof view[k] === 'number') { selectEntry(view[k]); break; } }
}
function jumpToEntry(i, scroll) {
  var e = st.all[i];
  var r = st.view.indexOf(i);
  if (r < 0) {
    st.from = e.t - S.ctxMin * 60000; st.to = e.t + 2 * 60000;
    $('from').value = tLabel(st.from); $('to').value = tLabel(st.to);
    st.srcOn[e.src] = true; $('fImp').checked = false; $('fErr').checked = false; $('q').value = '';
    renderSrcBtns(); applyFilters(); drawLanes();
    r = st.view.indexOf(i);
  }
  if (r >= 0) { var tl = $('tl'); tl.scrollTop = Math.max(0, r * RH - tl.clientHeight / 2); selectEntry(i); }
  if (scroll) $('tl').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('btnCopyLine').onclick = function () { if (st.sel >= 0) copyText(Core.mask(st.all[st.sel].raw), $('lineOk')); };
$('btnCtx').onclick = function () {
  if (st.sel < 0) return;
  var e = st.all[st.sel];
  st.from = e.t - 60000; st.to = e.t + 60000;
  $('from').value = tLabel(st.from); $('to').value = tLabel(st.to);
  st.srcOn = {}; renderSrcBtns(); $('fImp').checked = false; $('fErr').checked = false; $('q').value = '';
  applyFilters(); drawLanes(); jumpToEntry(st.sel, false);
};
$('btnCopyTsv').onclick = function () {
  var rows = ['เวลา\tlog\tthread\tlevel\tข้อความ'], n = 0;
  for (var r = 0; r < st.view.length && n < 20000; r++) {
    var v = st.view[r];
    if (typeof v !== 'number') { rows.push(tLabel(v.c.start, true) + '\t---\t\t\tlog หลักหยุด' + (v.c.end ? ' หายไป ' + Core.fmtDur(v.c.end - v.c.start) : '')); continue; }
    var e = st.all[v]; n++;
    rows.push(Core.fmtDate(e.t) + ' ' + Core.fmtTimeMs(e.t) + '\t' + e.src + '\t' + e.thr + '\t' + e.lvl + '\t' + e.msg.replace(/[\t\r\n]+/g, ' ').slice(0, 2000));
  }
  copyText(Core.mask(rows.join('\n')), $('tsvOk'));
  if (n >= 20000) $('tsvOk').textContent = 'คัดลอก 20,000 บรรทัดแรก ใช้ตัวกรองหรือช่วงเวลาให้แคบลง';
};
