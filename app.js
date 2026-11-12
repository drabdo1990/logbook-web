(function () {
  'use strict';
  var NR = 'Not recorded', PAGE = 100;
  var COLS = 'id,date,sex,age,spec,proc,dx,tech,cls,asa,air,block,sup,extras,comp,notes,src,q';
  var META = window.CASETRACE_META, CFG = window.CASETRACE_CONFIG || {};
  var sb = null, user = null, cases = [], shown = PAGE, editingId = null, authMode = 'in';
  // A password-reset link comes back to this page with tokens in the URL; remember that before anything reads the hash.
  var recovering = /type=recovery/.test(location.hash);
  var NEURO = ['Spinal', 'Epidural', 'Combined spinal-epidural'], PED = ['Neonate', 'Infant (under 1)', 'Child (1-11)'];
  var VIEWS = ['dashboard', 'log', 'cases', 'account'];
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Supabase helpers ---------- */
  function keyProblem(key) {
    if (!key) return 'The Supabase key is missing.';
    if (/^sb_secret_/.test(key)) return 'config.js contains a secret key. Use the publishable (anon) key instead.';
    var parts = key.split('.');
    if (parts.length === 3) {
      try {
        var p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (p.role === 'service_role') return 'config.js contains the service_role key. Use the anon key instead.';
      } catch (e) { /* not a readable JWT; let Supabase reject it */ }
    }
    return '';
  }
  function configProblem() {
    if (!CFG.supabaseUrl || !CFG.supabaseKey) return 'This site is not connected to a database yet: fill in web/config.js.';
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(CFG.supabaseUrl)) return 'The Supabase URL in config.js should look like https://yourproject.supabase.co.';
    return keyProblem(CFG.supabaseKey);
  }
  function friendly(err) {
    var m = (err && err.message) || 'Request failed.';
    var c = /violates check constraint "cases_(\w+)_check"/.exec(m);
    if (c) return 'That value is not allowed for "' + c[1] + '".';
    if (/Invalid login credentials/i.test(m)) return 'Email or password is not correct.';
    if (/Email not confirmed/i.test(m)) return 'Confirm your email first: open the link Supabase sent you, then sign in.';
    if (/already registered/i.test(m)) return 'An account with this email already exists.';
    if (/signups? (not allowed|are disabled)|signup is disabled/i.test(m)) return 'Sign-up is closed on this site.';
    if (/row-level security/i.test(m)) return 'Not allowed.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Try again in a few minutes.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Cannot reach the server. Check your connection.';
    return m;
  }
  function fail(err) { var e = new Error(friendly(err)); e.status = err && err.status; e.raw = err; return e; }
  // supabase-js returns { data, error } instead of throwing; turn errors into exceptions.
  function ok(res) { if (res.error) throw fail(res.error); return res.data; }
  function isAuthLost(err) { return err && (err.status === 401 || /JWT|not authenticated/i.test((err.raw && err.raw.message) || err.message || '')); }

  /* ---------- helpers ---------- */
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
  function fillSelect(sel, items) { items.forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); }); }
  function yearOf(c) { return c.date ? c.date.slice(0, 4) : 'Undated'; }
  function isImported(c) { return /^Imported/.test(c.src || ''); }
  function years() { var s = {}; cases.forEach(function (c) { if (c.date) s[c.date.slice(0, 4)] = 1; }); return Object.keys(s).sort().reverse(); }
  function byDate(a, b) { if (!a.date !== !b.date) return a.date ? -1 : 1; return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; }
  function count(list, key, skip) {
    var m = {};
    list.forEach(function (c) { var v = c[key]; if (v && (!skip || skip.indexOf(v) === -1)) m[v] = (m[v] || 0) + 1; });
    return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
  }

  /* ---------- screens ---------- */
  function showAuth(mode) {
    user = null; cases = [];
    $('app').hidden = true; $('auth').hidden = false;
    $('who').textContent = ''; $('acctEmail').textContent = ''; $('q').value = ''; renderAll(); // leave nothing of the last account in the page
    setAuthMode(mode || 'in'); $(mode === 'newpass' ? 'aPass' : 'aEmail').focus();
  }
  function showApp() {
    $('auth').hidden = true; $('app').hidden = false;
    $('who').textContent = user.email; $('acctEmail').textContent = user.email;
    renderAll(); route();
  }
  function route() {
    var v = (location.hash || '').replace('#', '');
    if (VIEWS.indexOf(v) === -1) v = 'dashboard';
    VIEWS.forEach(function (n) { $('view-' + n).hidden = n !== v; });
    document.querySelectorAll('nav.tabs a').forEach(function (a) {
      if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (v !== 'log' && editingId !== null) cancelEdit();
  }

  /* ---------- auth ---------- */
  function setAuthMode(mode) {
    authMode = mode;
    $('tabIn').setAttribute('aria-pressed', String(mode === 'in'));
    $('tabUp').setAttribute('aria-pressed', String(mode === 'up'));
    $('aSubmit').textContent = { 'in': 'Sign in', up: 'Create account', forgot: 'Send reset link', newpass: 'Set new password' }[mode];
    $('aPass').setAttribute('autocomplete', mode === 'in' ? 'current-password' : 'new-password');
    $('aPassLabel').textContent = mode === 'newpass' ? 'New password' : 'Password';
    $('aHint').textContent = mode === 'up' || mode === 'newpass' ? 'At least 10 characters.' : '';
    $('authTabs').hidden = mode === 'newpass';
    $('aEmailWrap').hidden = mode === 'newpass';
    $('aPassWrap').hidden = mode === 'forgot';
    $('aForgot').hidden = mode !== 'in';
    $('aInfo').textContent = mode === 'forgot' ? 'Enter your email and we will send a link to choose a new password. Open the link on this device.'
      : mode === 'newpass' ? 'Choose a new password for your account.' : '';
    $('aInfo').hidden = !$('aInfo').textContent;
    $('aErr').textContent = '';
  }
  function info(text) { $('aInfo').textContent = text; $('aInfo').hidden = !text; }
  $('tabIn').addEventListener('click', function () { setAuthMode('in'); });
  $('tabUp').addEventListener('click', function () { setAuthMode('up'); });
  $('aForgot').addEventListener('click', function () { setAuthMode('forgot'); $('aEmail').focus(); });

  $('authForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!sb) return;
    var email = $('aEmail').value.trim(), pw = $('aPass').value;
    $('aErr').textContent = '';
    if (authMode !== 'newpass' && !email) { $('aErr').textContent = 'Enter your email.'; return; }
    if (authMode !== 'forgot' && !pw) { $('aErr').textContent = authMode === 'newpass' ? 'Enter a new password.' : 'Enter your email and password.'; return; }
    if ((authMode === 'up' || authMode === 'newpass') && pw.length < 10) { $('aErr').textContent = 'Use a password of at least 10 characters.'; return; }
    $('aSubmit').disabled = true;
    try {
      if (authMode === 'forgot') {
        ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
        info('If that email has an account, a link to choose a new password is on its way. Open it on this device.');
        return;
      }
      var d;
      if (authMode === 'newpass') {
        d = ok(await sb.auth.updateUser({ password: pw }));
        recovering = false; history.replaceState(null, '', location.pathname + location.search);
      } else if (authMode === 'up') {
        d = ok(await sb.auth.signUp({ email: email, password: pw }));
        if (d.user && d.user.identities && d.user.identities.length === 0) throw new Error('An account with this email already exists.');
        if (!d.session) { setAuthMode('in'); info('Account created. Open the confirmation link sent to your email, then sign in.'); $('aPass').value = ''; return; }
      } else {
        d = ok(await sb.auth.signInWithPassword({ email: email, password: pw }));
      }
      user = { email: d.user.email }; $('aPass').value = '';
      await loadCases(); showApp();
    } catch (err) { $('aErr').textContent = err.message; }
    finally { $('aSubmit').disabled = false; }
  });
  $('signOut').addEventListener('click', async function () {
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* signing out locally anyway */ }
    location.hash = ''; showAuth();
  });
  var delArmed = false;
  $('delBtn').addEventListener('click', async function () {
    $('delErr').textContent = '';
    if (!$('delPass').value) { $('delErr').textContent = 'Enter your password to confirm.'; return; }
    if (!delArmed) {
      delArmed = true; $('delBtn').textContent = 'Click again to delete permanently';
      setTimeout(function () { delArmed = false; $('delBtn').textContent = 'Delete my account and all cases'; }, 5000);
      return;
    }
    try {
      // Check the password again before deleting. The database cannot check it, so this is the only gate.
      var again = await sb.auth.signInWithPassword({ email: user.email, password: $('delPass').value });
      if (again.error) throw new Error('Password is not correct.');
      ok(await sb.rpc('delete_my_account'));
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* the account is gone either way */ }
      $('delPass').value = ''; location.hash = ''; showAuth();
    } catch (err) { $('delErr').textContent = err.message; delArmed = false; $('delBtn').textContent = 'Delete my account and all cases'; }
  });

  /* ---------- data ---------- */
  // Supabase returns at most 1000 rows per request, so read the cases in pages until all of them are here.
  async function loadCases() {
    var all = [], total = null;
    for (;;) {
      var res = await sb.from('cases').select(COLS, total === null ? { count: 'exact' } : undefined)
        .order('id', { ascending: true }).range(all.length, all.length + 999);
      if (res.error && res.error.code === 'PGRST103' && all.length) break; // asked past the last row
      var rows = ok(res);
      if (total === null) total = res.count;
      all = all.concat(rows);
      if (!rows.length || (total !== null && all.length >= total)) break;
    }
    if (total !== null && all.length !== total) throw new Error('Loaded ' + all.length + ' of ' + total + ' cases. Reload the page to try again.');
    cases = all.sort(byDate);
  }

  /* ---------- dashboard ---------- */
  function bars(el, data, emptyText) {
    el.textContent = '';
    if (!data.length) { var p = document.createElement('p'); p.className = 'empty'; p.textContent = emptyText || 'Nothing logged yet.'; el.appendChild(p); return; }
    var max = Math.max.apply(null, data.map(function (d) { return d[1]; }));
    data.forEach(function (d) {
      var row = document.createElement('div'); row.className = 'bar';
      var l = document.createElement('span'); l.className = 'lbl'; l.textContent = d[0];
      var t = document.createElement('span'); t.className = 'track';
      var f = document.createElement('span'); f.className = 'fill'; f.style.width = (d[1] / max * 100) + '%';
      var n = document.createElement('span'); n.className = 'n'; n.textContent = d[1];
      t.appendChild(f); row.appendChild(l); row.appendChild(t); row.appendChild(n); el.appendChild(row);
    });
  }
  function renderStats() {
    var per = $('period').value;
    var list = cases.filter(function (c) { return !per || yearOf(c) === per; });
    var cut = daysAgo(365);
    $('emptyHint').hidden = cases.length > 0;
    $('tTotal').textContent = list.length;
    $('t12').textContent = cases.filter(function (c) { return c.date && c.date >= cut; }).length;
    $('tNeuro').textContent = list.filter(function (c) { return NEURO.indexOf(c.tech) !== -1; }).length;
    $('tPed').textContent = list.filter(function (c) { return PED.indexOf(c.age) !== -1; }).length;
    var yrs = years().slice().reverse(); if (cases.some(function (c) { return !c.date; })) yrs.push('Undated');
    bars($('bYear'), yrs.map(function (y) { return [y, cases.filter(function (c) { return yearOf(c) === y; }).length]; }));
    bars($('bTech'), count(list, 'tech', [NR]));
    bars($('bSpec'), count(list, 'spec', [NR]));
    bars($('bAge'), META.ages.map(function (a) { return [a, list.filter(function (c) { return c.age === a; }).length]; }).filter(function (d) { return d[1] > 0 && d[0] !== NR; }));
    var blocks = count(list, 'block', ['None', NR]), sups = count(list, 'sup', [NR]), asas = count(list, 'asa', [NR]);
    $('pBlock').hidden = !blocks.length; $('pSup').hidden = !sups.length; $('pAsa').hidden = !asas.length;
    bars($('bBlock'), blocks); bars($('bSup'), sups);
    bars($('bAsa'), asas.sort(function (a, b) { return a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1); }));
    var imp = cases.filter(isImported), flagged = cases.filter(function (c) { return c.q; }).length;
    $('importNote').hidden = !imp.length;
    if (imp.length) $('importNote').textContent = imp.length + ' cases came from an imported older logbook. Specialty on those was assigned automatically from the operation name and can be wrong. ASA, airway, block and supervision were not in the source.';
    $('flagNote').hidden = !flagged;
    if (flagged) $('flagNote').textContent = flagged + ' dates need checking. Use Edit to correct or confirm them.';
  }

  /* ---------- cases list ---------- */
  function filtered() {
    var q = $('q').value.trim().toLowerCase(), t = $('fltTech').value, y = $('fltYear').value, f = $('fltFlag').value;
    return cases.filter(function (c) {
      return (!q || c.proc.toLowerCase().indexOf(q) !== -1 || (c.dx || '').toLowerCase().indexOf(q) !== -1) && (!t || c.tech === t) && (!y || yearOf(c) === y) && (!f || c.q);
    });
  }
  function cell(tr, text, cls) { var td = document.createElement('td'); if (cls) td.className = cls; td.textContent = text; tr.appendChild(td); return td; }
  function tag(parent, text, cls) { var s = document.createElement('span'); s.className = 'tag' + (cls ? ' ' + cls : ''); s.textContent = text; parent.appendChild(document.createTextNode(' ')); parent.appendChild(s); }
  function details(c) {
    var d = [];
    if (c.asa && c.asa !== NR) d.push('ASA ' + c.asa);
    if (c.block && c.block !== NR && c.block !== 'None') d.push(c.block + ' block');
    if (c.air && c.air !== NR) d.push(c.air);
    if (c.sup && c.sup !== NR) d.push(c.sup);
    if (c.extras && c.extras.length) d.push(c.extras.join(', '));
    if (c.cls) d.push('Class: ' + c.cls);
    if (c.comp) d.push('Complication: ' + c.comp);
    if (c.notes) d.push(c.notes);
    return d.join(' · ');
  }
  function renderTable() {
    var list = filtered(), body = $('rows'); body.textContent = '';
    list.slice(0, shown).forEach(function (c) {
      var tr = document.createElement('tr');
      cell(tr, c.date || 'No date', 'date');
      var p = cell(tr, c.proc, 'proc');
      if (c.dx) { var dx = document.createElement('span'); dx.className = 'dx'; dx.textContent = c.dx; p.appendChild(dx); }
      if (c.q) tag(p, c.q === 'nodate' ? 'No date in source' : 'Check date', 'flag');
      if (c.comp) tag(p, 'Complication', 'flag');
      cell(tr, c.spec);
      cell(tr, [c.age === NR ? '' : c.age, c.sex === NR ? '' : c.sex].filter(Boolean).join(', ') || '–');
      cell(tr, c.tech === NR ? '–' : c.tech);
      cell(tr, details(c) || '–', 'det');
      var td = document.createElement('td'); td.className = 'acts';
      var eb = document.createElement('button'); eb.type = 'button'; eb.className = 'small'; eb.textContent = 'Edit';
      eb.setAttribute('aria-label', 'Edit case: ' + c.proc);
      eb.addEventListener('click', function () { startEdit(c); });
      var db = document.createElement('button'); db.type = 'button'; db.className = 'small'; db.textContent = 'Delete';
      db.setAttribute('aria-label', 'Delete case: ' + c.proc);
      db.addEventListener('click', function () {
        if (db.dataset.armed) { removeCase(c); return; }
        db.dataset.armed = '1'; db.textContent = 'Confirm delete'; db.classList.add('danger');
        db.setAttribute('aria-label', 'Confirm delete case: ' + c.proc);
        setTimeout(function () { delete db.dataset.armed; db.textContent = 'Delete'; db.classList.remove('danger'); db.setAttribute('aria-label', 'Delete case: ' + c.proc); }, 4000);
      });
      td.appendChild(eb); td.appendChild(db); tr.appendChild(td); body.appendChild(tr);
    });
    $('noRows').hidden = list.length > 0;
    var rest = list.length - shown;
    $('more').hidden = rest <= 0; $('more').textContent = 'Show ' + Math.min(PAGE, Math.max(rest, 0)) + ' more (' + Math.max(rest, 0) + ' left)';
    $('caseCount').textContent = '(' + list.length + ' of ' + cases.length + ')';
  }
  async function removeCase(c) {
    try {
      var gone = ok(await sb.from('cases').delete().eq('id', c.id).select('id'));
      if (!gone.length) throw new Error('Case not found.');
      cases = cases.filter(function (x) { return x.id !== c.id; }); renderAll(); $('listStatus').textContent = 'Case deleted.';
    } catch (err) { if (isAuthLost(err)) showAuth(); else $('listStatus').textContent = err.message; }
  }
  function renderFilters() {
    var st = $('fltTech'), sc = st.value;
    while (st.options.length > 1) st.remove(1);
    fillSelect(st, count(cases, 'tech', [NR]).map(function (d) { return d[0]; })); st.value = sc; if (st.value !== sc) st.value = '';
    var sy = $('fltYear'), cy = sy.value;
    while (sy.options.length > 1) sy.remove(1);
    fillSelect(sy, years().concat(cases.some(function (c) { return !c.date; }) ? ['Undated'] : [])); sy.value = cy; if (sy.value !== cy) sy.value = '';
    var sp = $('period'), cp = sp.value;
    sp.textContent = ''; var all = document.createElement('option'); all.value = ''; all.textContent = 'All years'; sp.appendChild(all);
    fillSelect(sp, years()); sp.value = cp; if (sp.value !== cp) sp.value = '';
  }
  function renderAll() { renderFilters(); renderStats(); renderTable(); }

  /* ---------- CSV ---------- */
  function csv() {
    var head = ['Date', 'Sex', 'Age group', 'Specialty', 'Procedure', 'Diagnosis', 'Technique', 'Hospital class', 'ASA', 'Airway', 'Block', 'Supervision', 'Extras', 'Complications', 'Notes', 'Source', 'Date flag'];
    var q = function (v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    var lines = [head.map(q).join(',')];
    filtered().forEach(function (c) {
      lines.push([c.date, c.sex, c.age, c.spec, c.proc, c.dx, c.tech, c.cls, c.asa, c.air, c.block, c.sup, (c.extras || []).join('; '), c.comp, c.notes, c.src || 'Added here', c.q === 'check' ? 'Check date' : c.q === 'nodate' ? 'No date in source' : ''].map(q).join(','));
    });
    return lines.join('\n');
  }
  $('copyCsv').addEventListener('click', function () {
    var text = csv();
    var fallback = function () { $('csvBox').value = text; $('csvWrap').hidden = false; $('csvBox').focus(); $('csvBox').select(); $('listStatus').textContent = ''; };
    try { navigator.clipboard.writeText(text).then(function () { $('csvWrap').hidden = true; $('listStatus').textContent = 'Copied. Paste it into Excel or Google Sheets.'; }, fallback); } catch (err) { fallback(); }
  });
  $('dlCsv').addEventListener('click', function () {
    var blob = new Blob(['﻿' + csv()], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'casetrace-cases.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    $('listStatus').textContent = 'CSV downloaded.';
  });

  /* ---------- form ---------- */
  function setupForm() {
    fillSelect($('fSex'), META.sex); fillSelect($('fAge'), META.ages); fillSelect($('fSpec'), META.specs); fillSelect($('fTech'), META.techs);
    fillSelect($('fAsa'), META.asa); fillSelect($('fAir'), META.airways); fillSelect($('fBlock'), META.blocks); fillSelect($('fSup'), META.sups);
    META.extras.forEach(function (name, i) {
      var label = document.createElement('label'); label.setAttribute('for', 'x' + i);
      var input = document.createElement('input'); input.type = 'checkbox'; input.id = 'x' + i; input.value = name;
      label.appendChild(input); label.appendChild(document.createTextNode(name)); $('extras').appendChild(label);
    });
    resetForm();
  }
  function setExtras(list) { document.querySelectorAll('#extras input').forEach(function (i) { i.checked = list.indexOf(i.value) !== -1; }); }
  function resetForm() {
    $('caseForm').reset();
    $('fDate').value = iso(new Date()); $('fAge').value = 'Adult (18-64)'; $('fSex').value = NR; $('fSpec').value = 'General surgery';
    $('fTech').value = 'General anesthesia'; $('fAsa').value = NR; $('fAir').value = NR; $('fBlock').value = 'None'; $('fSup').value = NR;
    setExtras([]); $('formErr').textContent = ''; $('dateOkWrap').hidden = true;
  }
  function startEdit(c) {
    editingId = c.id;
    $('fDate').value = c.date; $('fAge').value = c.age; $('fSex').value = c.sex; $('fSpec').value = c.spec; $('fProc').value = c.proc; $('fDx').value = c.dx || '';
    $('fTech').value = c.tech; $('fAsa').value = c.asa; $('fAir').value = c.air; $('fBlock').value = c.block; $('fSup').value = c.sup;
    $('fComp').value = c.comp || ''; $('fNotes').value = c.notes || ''; setExtras(c.extras || []);
    $('formTitle').textContent = 'Edit case'; $('formSave').textContent = 'Save changes'; $('formCancel').hidden = false;
    $('formStatus').textContent = ''; $('formErr').textContent = '';
    $('dateOkWrap').hidden = !c.q; $('dateOk').checked = false;
    location.hash = '#log';
  }
  function cancelEdit() {
    editingId = null; resetForm();
    $('formTitle').textContent = 'Log a case'; $('formSave').textContent = 'Save case'; $('formCancel').hidden = true;
  }
  $('formCancel').addEventListener('click', function () { cancelEdit(); location.hash = '#cases'; });
  $('caseForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    $('formErr').textContent = ''; $('formStatus').textContent = '';
    var proc = $('fProc').value.trim().replace(/\s+/g, ' ');
    if (!$('fDate').value) { $('formErr').textContent = 'Pick a date before saving.'; $('fDate').focus(); return; }
    if (!proc) { $('formErr').textContent = 'Enter the procedure before saving.'; $('fProc').focus(); return; }
    var extras = []; document.querySelectorAll('#extras input:checked').forEach(function (i) { extras.push(i.value); });
    var existing = editingId === null ? null : cases.filter(function (c) { return c.id === editingId; })[0];
    var tidy = function (v) { return v.trim().replace(/\s+/g, ' '); };
    var payload = {
      date: $('fDate').value, sex: $('fSex').value, age: $('fAge').value, spec: $('fSpec').value, proc: proc, dx: tidy($('fDx').value),
      tech: $('fTech').value, cls: existing ? existing.cls : '', asa: $('fAsa').value, air: $('fAir').value, block: $('fBlock').value, sup: $('fSup').value,
      extras: extras, comp: tidy($('fComp').value), notes: tidy($('fNotes').value), src: existing ? existing.src : '',
      // the date tag survives unrelated edits; it clears when the date changes or is confirmed
      q: existing && !$('dateOk').checked && $('fDate').value === existing.date ? existing.q : ''
    };
    $('formSave').disabled = true;
    try {
      if (existing) {
        var rows = ok(await sb.from('cases').update(payload).eq('id', existing.id).select(COLS));
        if (!rows.length) throw new Error('Case not found.');
        var upd = rows[0];
        cases = cases.map(function (c) { return c.id === upd.id ? upd : c; });
        cancelEdit(); location.hash = '#cases'; $('listStatus').textContent = 'Changes saved.';
      } else {
        var made = ok(await sb.from('cases').insert(payload).select(COLS).single());
        cases.push(made); resetForm(); $('formStatus').textContent = 'Case saved. It now counts in the dashboard.';
      }
      cases.sort(byDate);
      renderAll();
    } catch (err) {
      if (isAuthLost(err)) showAuth(); else $('formErr').textContent = err.message;
    } finally { $('formSave').disabled = false; }
  });

  /* ---------- filters and navigation ---------- */
  ['q', 'fltTech', 'fltYear', 'fltFlag'].forEach(function (id) { $(id).addEventListener(id === 'q' ? 'input' : 'change', function () { shown = PAGE; renderTable(); }); });
  $('period').addEventListener('change', renderStats);
  $('more').addEventListener('click', function () { shown += PAGE; renderTable(); });
  window.addEventListener('hashchange', route);

  /* ---------- start ---------- */
  (async function boot() {
    try {
      setupForm();
      var problem = configProblem();
      if (problem) { showAuth(); $('authForm').querySelectorAll('input,button').forEach(function (el) { el.disabled = true; }); $('aErr').textContent = problem; return; }
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      sb.auth.onAuthStateChange(function (event) {
        // Do not call Supabase from inside this callback.
        if (event === 'PASSWORD_RECOVERY') { recovering = true; showAuth('newpass'); }
        else if (event === 'SIGNED_OUT' && user) showAuth();
      });
      var s = ok(await sb.auth.getSession());
      await new Promise(function (r) { setTimeout(r, 0); }); // let a recovery event arrive first
      if (recovering) { showAuth('newpass'); return; }
      if (s.session) { user = { email: s.session.user.email }; await loadCases(); showApp(); } else showAuth();
    } catch (err) {
      if (isAuthLost(err)) { showAuth(); return; }
      document.body.textContent = 'Could not load the app: ' + err.message;
    }
  })();
})();
