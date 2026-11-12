(function (root) {
  'use strict';
  // Maps the compact records of an old logbook export ({d,x,a,s,p,g,t,k,n,y,q}) to case rows, and checks them
  // against the same limits the database enforces, so a bad file is refused before anything is sent.
  // Mirrors fromCompact() in server/cases.js; test/import-map.test.js keeps the two in step.
  var NR = 'Not recorded';
  var FLAGS = ['', 'check', 'nodate'];
  var MAX_RECORDS = 5000;

  function fromCompact(r) {
    return {
      date: r.d || '', sex: r.x, age: r.a, spec: r.s, proc: r.p, dx: r.g || '', tech: r.t, cls: r.k || '',
      asa: NR, air: NR, block: NR, sup: NR, extras: [], comp: '', notes: r.n || '',
      src: 'Imported ' + r.y, q: r.q || ''
    };
  }

  function tidy(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v; }

  function realDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  // Returns { rows } on success or { error } naming the first problem.
  function prepare(records, meta) {
    if (!Array.isArray(records) || !records.length) return { error: 'The file must contain a non-empty list of cases.' };
    if (records.length > MAX_RECORDS) return { error: 'The file has more than ' + MAX_RECORDS + ' cases.' };
    var latest = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // one day of slack, like the database
    var rows = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i], where = 'Case ' + (i + 1) + ': ';
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { error: where + 'not a case record.' };
      if (rec.y === undefined || rec.y === null || rec.y === '') return { error: where + 'missing year.' };
      var c = fromCompact(rec);
      ['proc', 'dx', 'cls', 'notes', 'src'].forEach(function (k) { c[k] = tidy(c[k]); });
      var lists = [['sex', meta.sex], ['age', meta.ages], ['spec', meta.specs], ['tech', meta.techs]];
      for (var j = 0; j < lists.length; j++) {
        if (typeof c[lists[j][0]] !== 'string' || lists[j][1].indexOf(c[lists[j][0]]) === -1) return { error: where + '"' + lists[j][0] + '" has a value that is not allowed.' };
      }
      var texts = [['proc', 200], ['dx', 200], ['cls', 60], ['notes', 400], ['src', 40]];
      for (var t = 0; t < texts.length; t++) {
        if (typeof c[texts[t][0]] !== 'string') return { error: where + '"' + texts[t][0] + '" must be text.' };
        if (c[texts[t][0]].length > texts[t][1]) return { error: where + '"' + texts[t][0] + '" is too long.' };
      }
      if (!c.proc) return { error: where + 'the procedure is empty.' };
      if (c.date && (!realDate(c.date) || c.date > latest)) return { error: where + 'the date "' + c.date + '" is not valid.' };
      if (FLAGS.indexOf(c.q) === -1) return { error: where + 'the date flag is not valid.' };
      rows.push(c);
    }
    return { rows: rows };
  }

  root.CaseImport = { fromCompact: fromCompact, prepare: prepare };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CaseImport;
})(typeof window !== 'undefined' ? window : globalThis);
