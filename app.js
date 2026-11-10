'use strict';
const $ = s => document.querySelector(s);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const OFF = { REPOS: 'Repos', WE: 'Week-end', RTT: 'RTT', RECUP: 'Récup', CONGE: 'Congé', MALADIE: 'Maladie', FORMATION: 'Formation' };
const SHORT = { REPOS: 'R', WE: 'WE', RTT: 'RTT', RECUP: 'Réc', CONGE: 'CG', MALADIE: 'M', FORMATION: 'For' };

let month = (() => {
  try { const m = localStorage.getItem('month'); if (/^\d{4}-\d{2}$/.test(m)) return m; } catch {}
  const d = new Date(); d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
let data = null;

// Version web : le planning tourne dans la page (window.planningBackend) ; sinon, serveur local.
const backend = window.planningBackend || null;
async function call(path, body, q = {}) {
  if (backend) return (await backend.handle(body ? 'POST' : 'GET', path, q, body || {})).json;
  const qs = new URLSearchParams(q).toString();
  const r = await fetch(path + (qs ? '?' + qs : ''), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
}
async function api(path, body) {
  const j = await call(path, body ? { month, ...body } : null, body ? {} : { month });
  if (j.needLogin) { showLogin(); throw new Error(j.error); }
  if (j.error) { toast(j.error); throw new Error(j.error); }
  data = j; render(); return j;
}
// Appels de connexion : ne redessinent pas le planning.
async function authCall(path, body) {
  const j = await call(path, body);
  if (j.error) throw new Error(j.error);
  return j;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}
const addMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const fmtDate = d => `${d.slice(8)}/${d.slice(5, 7)}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Couleur d'une case : le chef terrain a sa propre couleur, quel que soit son horaire.
const shiftCls = (c, isChef) => c.kind === 'off' ? c.code : isChef ? 'CHEF' : c.shift;
function cellHtml(c, isChef) {
  if (!c) return '';
  if (c.kind === 'off') return `<span class="c-${c.code}">${SHORT[c.code] || c.code}</span>`;
  return `<span class="c-${shiftCls(c, isChef)}">${esc(c.label)}</span>`;
}

function render() {
  const v = data.view;
  const [y, m] = month.split('-').map(Number);
  $('#monthTitle').textContent = `${MONTHS[m - 1]} ${y}`;
  $('#csv').href = `/api/export.xlsx?month=${month}`;
  try { localStorage.setItem('month', month); } catch {}
  $('#syncBar').hidden = !data.syncError;
  $('#syncBar').textContent = data.syncError || '';

  // Semaines complètes (lundi au dimanche) : les jours d'un autre mois sont grisés.
  const gd = v.allDays || v.days;
  const colCls = d => [d.dow === 1 ? 'monday' : '', d.closed ? 'closed' : '', d.dow === 6 ? 'sat' : '', d.outside ? 'outside' : ''].join(' ');
  let h = '<thead><tr><th class="name">Employé</th>';
  for (const d of gd) {
    const title = [d.holiday ? `Férié : ${d.holiday}${d.closed ? '' : ' (rouvert)'}` : d.closed ? 'Fermé' : '', d.weGroup.length ? 'Week-end : ' + d.weGroup.join(', ') : '',
      d.match ? `Anderlecht – ${d.match.opponent} (${d.match.competition}) ${d.match.time}${d.match.confirmed ? '' : ' – heure à confirmer'}` : ''].filter(Boolean).join('\n');
    h += `<th class="${colCls(d)}" data-date="${d.date}" title="${esc(title)}"><span class="d">${d.dowLabel}</span><br>${d.day}`;
    if (d.openSunday) h += `<span class="o">Ouvert</span>`;
    if (d.holiday) h += `<span class="f">Férié</span>`;
    if (d.match) h += `<span class="m ${d.match.confirmed ? '' : 'tbc'}">⚽ ${d.match.time}</span>`;
    h += '</th>';
  }
  h += '</tr></thead><tbody>';
  for (const r of v.rows) {
    if (r.isChef) h += `<tr class="addrow"><td class="name"><button class="add-emp">+ Ajouter un employé</button></td><td colspan="${gd.length}"></td></tr>`;
    h += `<tr class="${r.isChef ? 'chef sep' : ''}"><td class="name"><div class="namebox"><span>${esc(r.name)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span>${r.isChef ? `<button class="edit-chef ghost" title="Modifier le chef terrain (nom, horaire, jours)">✎</button>` : `<button class="edit-emp ghost" data-id="${r.id}" title="Modifier ou supprimer ${esc(r.name)}">✎</button>`}</div></td>`;
    for (const d of gd) {
      const c = r.cells[d.date];
      h += `<td class="cell ${colCls(d)} ${c && c.locked ? 'lock' : ''}" data-emp="${r.id}" data-date="${d.date}">${cellHtml(c, r.isChef)}</td>`;
    }
    h += '</tr>';
  }
  // Étudiants : une ligne par étudiant ; en pointillé quand l'outil l'a ajouté tout seul.
  v.studentRows.forEach((r, k) => {
    h += `<tr class="student ${k === 0 ? 'sep' : ''}"><td class="name">${esc(r.name)}${k === 0 ? '<small>Étudiants</small>' : ''}</td>`;
    for (const d of gd) {
      const c = r.cells[d.date];
      const inner = !c ? '' : c.kind === 'off' ? '<span class="c-NONE">—</span>' : `<span class="c-STUDENT ${c.auto ? 'auto' : ''}">${esc(c.label)}</span>`;
      h += `<td class="cell ${colCls(d)} ${c && c.locked ? 'lock' : ''}" data-emp="${r.id}" data-date="${d.date}">${inner}</td>`;
    }
    h += '</tr>';
  });
  h += '<tr class="sum"><td class="name">Présents</td>';
  for (const d of gd) {
    if (d.closed && !d.present) { h += `<td class="${colCls(d)}"></td>`; continue; }
    const tot = d.present + d.students.length;
    h += `<td class="${colCls(d)} ${d.missing || d.warnings.length ? 'bad' : ''}" title="${esc(d.warnings.join('\n'))}">${tot}${d.need ? '/' + d.need : ''}</td>`;
  }
  h += '</tr></tbody>';
  $('#grid').innerHTML = h;

  $('#legend').innerHTML = [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['FOOT', '⚽ Horaire foot'], ['CHEF', 'Chef terrain'],
    ['REPOS', 'R = Repos'], ['WE', 'WE = Week-end'], ['RTT', 'RTT'], ['RECUP', 'Réc = Récup (dimanche ou férié)'], ['CONGE', 'CG = Congé'], ['MALADIE', 'M = Maladie'], ['FORMATION', 'For = Formation']]
    .map(([c, l]) => `<span><span class="sw c-${c}">&nbsp;</span>${l}</span>`).join('');

  $('#warnings').innerHTML = !v.generated ? '<li class="ok">Mois pas encore généré.</li>'
    : v.warnings.length ? v.warnings.map(w => `<li>${esc(w)}</li>`).join('') : '<li class="ok">Aucune alerte, toutes les règles sont respectées.</li>';

  const cols = [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['foot', '⚽ mois'], ['footSeason', '⚽ saison'], ['sat8', 'Sam. 8h saison'], ['REPOS', 'Repos'], ['RTT', 'RTT'], ['worked', 'Jours trav.']];
  const spread = k => { const xs = v.stats.map(s => s[k]); return Math.max(...xs) - Math.min(...xs); };
  let s = '<tr><th></th>' + cols.map(c => `<th>${c[1]}</th>`).join('') + '</tr>';
  for (const st of v.stats) {
    s += `<tr><td>${esc(st.name)}</td>` + cols.map(([k]) => {
      const xs = v.stats.map(x => x[k]);
      const hi = ['8-16', '10-18', '12-20'].includes(k) && spread(k) > 1 && st[k] === Math.max(...xs);
      return `<td class="${hi ? 'hi' : ''}">${st[k]}</td>`;
    }).join('') + '</tr>';
  }
  $('#stats').innerHTML = s;

  renderDuty();
  // Matchs de la saison, par personne.
  const rot = v.stats.slice().sort((a, b) => a.footSeason - b.footSeason || (a.lastFoot || '').localeCompare(b.lastFoot || ''));
  $('#footStats').innerHTML = '<tr><th>Employé</th><th>Ce mois</th><th>Saison</th><th>Matchs de la saison</th></tr>'
    + rot.map(st => `<tr><td>${esc(st.name)}</td><td>${st.foot}</td><td>${st.footSeason}</td>
      <td class="footlist">${st.footList.length ? st.footList.map(m => `<span>${fmtDate(m.date)}${m.opponent ? ' · ' + esc(m.opponent) : ''}</span>`).join('') : '—'}</td></tr>`).join('');

  renderDays();
  renderDashboard();
  renderAccount();
  renderAbsences();
  // L'horaire a pu changer (maladie, autre compte…) : les zones du jour affiché se recalculent.
  if (document.body.dataset.page === 'zones') loadZones();
  if (document.body.dataset.page === 'log' && !logForm) loadLog();
  if (data.account.role === 'admin') renderHr();
  renderMatches();
  renderSettings();
  $('#alertChip').hidden = !v.warnings.length;
  $('#alertChip').textContent = `⚠ ${v.warnings.length} alerte${v.warnings.length > 1 ? 's' : ''}`;
}

// ----- Tableau de bord -----
// Nombre de personnes (pas de jours) absentes au moins un jour du mois pour ce motif ('ALL' : maladie, formation ou congé),
// chef terrain compris, et chef de parc (qui n'a pas de ligne dans l'horaire) d'après la liste des absences.
function absentPeople(v, code) {
  const codes = code === 'ALL' ? ['MALADIE', 'FORMATION', 'CONGE'] : [code];
  const who = new Set(v.rows.filter(r => Object.values(r.cells).some(c => c && c.kind === 'off' && codes.includes(c.code))).map(r => r.id));
  for (const a of data.absences || []) if (a.empId === 'chef-parc' && codes.includes(a.code) && a.from.slice(0, 7) <= month && a.to.slice(0, 7) >= month) who.add(a.empId);
  return who.size;
}
function renderDashboard() {
  const v = data.view;
  const today = new Date().toISOString().slice(0, 10);
  const nextMatch = (data.matches || []).filter(m => m.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const nextOpen = (data.openings || []).filter(o => !o.ignored && o.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const students = v.days.reduce((n, d) => n + d.studentRows.filter(r => !r.none).length, 0);
  const longDate = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  const kpi = (cls, label, value, sub, go) => `<button class="kpi ${cls}" data-go="${go}"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span></button>`;
  $('#dashKpis').innerHTML = [
    kpi(v.warnings.length ? 'bad' : 'good', 'Alertes du mois', v.generated ? v.warnings.length : '—', v.generated ? (v.warnings.length ? "à régler dans l'horaire" : 'tout est en ordre') : 'mois pas encore généré', 'planning'),
    kpi('foot', 'Prochain match', nextMatch ? fmtDate(nextMatch.date) : '—', nextMatch ? `${esc(nextMatch.opponent)} · ${nextMatch.time}` : 'aucun match prévu', 'calendar'),
    kpi('open', 'Prochain dimanche ouvert', nextOpen ? fmtDate(nextOpen.date) : '—', nextOpen ? esc(nextOpen.label) : 'aucun prévu', 'calendar'),
    kpi('abs', 'Absents ce mois', absentPeople(v, 'ALL'), `${absentPeople(v, 'MALADIE')} en maladie · ${absentPeople(v, 'FORMATION')} en formation · ${absentPeople(v, 'CONGE')} en congé`, 'sick'),
    kpi('stud', 'Étudiants ce mois', students, 'jours-étudiant prévus', 'students'),
  ].join('');
  // Aujourd'hui, ou le premier jour ouvert du mois affiché si on regarde un autre mois.
  const shown = v.days.find(d => d.date === today) || v.days.find(d => !d.closed) || v.days[0];
  $('#dashTodayTitle').textContent = shown && shown.date === today ? 'Aujourd\'hui' : 'Premier jour du mois';
  $('#dashTodayDate').textContent = shown ? longDate(shown.date) : '';
  $('#dashToday').innerHTML = shown && dayCards[shown.date] ? dayCards[shown.date].replace('class="daycard', 'class="daycard plain') : '';
  // À venir : matchs et dimanches d'ouverture.
  const events = [
    ...(data.matches || []).filter(m => m.date >= today).map(m => ({ date: m.date, html: `<span class="ev foot">⚽</span><div><b>${esc(m.opponent)}</b><small>${esc(m.competition || '')} · ${m.time}${m.confirmed === false ? ' · heure à confirmer' : ''}</small></div>` })),
    ...(data.openings || []).filter(o => !o.ignored && o.date >= today).map(o => ({ date: o.date, html: `<span class="ev open">🛍</span><div><b>Dimanche d'ouverture</b><small>${esc(o.label)}${o.hours ? ' · ' + esc(o.hours) : ''}</small></div>` })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  $('#dashUpcoming').innerHTML = events.length ? '<ul class="events">' + events.map(e => `<li><span class="ev-date">${fmtDate(e.date)}</span>${e.html}</li>`).join('') + '</ul>' : '<p class="muted">Rien de prévu.</p>';
}

// ----- RH : remarques par personne -----
let hrSel = null, hrType = 'positive', hrFilter = 'all', hrTab = 'notes';
// Heures supp / à faire : effet sur le solde (1 h supp = 2 h de récup).
const HOUR_KINDS = { supp: ['Heures supp', 2], afaire: ['Heures à faire', -1], recup: ['Récup prise', -1], rattrape: ['Heures rattrapées', 1] };
const hm = m => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`;
const balanceOf = id => ((data.hr && data.hr.hours) || []).filter(h => h.empId === id).reduce((m, h) => m + h.minutes * (HOUR_KINDS[h.kind] || [0, 0])[1], 0);
const balanceText = m => m > 0 ? `+${hm(m)} à récupérer` : m < 0 ? `${hm(-m)} à faire` : 'à jour';
const hrWhen = iso => new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function renderHr() {
  const emps = data.config.employees.filter(e => !e.end || e.end >= today());
  const notes = (data.hr && data.hr.notes) || [];
  if (!emps.some(e => e.id === hrSel)) hrSel = emps.length ? emps[0].id : null;
  const count = (id, t) => notes.filter(n => n.empId === id && (!t || n.type === t)).length;
  const lates = id => notes.filter(n => n.empId === id && n.late);
  const lateMin = id => lates(id).reduce((m, n) => m + n.late.minutes, 0);
  $('#hrPeople').innerHTML = emps.map(e => `<button class="hr-person ${e.id === hrSel ? 'on' : ''}" data-emp="${e.id}">
      <span class="avatar">${esc(e.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>
      <span class="who"><b>${esc(e.name)}</b><small>${count(e.id)} remarque${count(e.id) > 1 ? 's' : ''}${lates(e.id).length ? ` · ⏰ ${lates(e.id).length} retard${lates(e.id).length > 1 ? 's' : ''}` : ''}</small></span>
      ${hrTab === 'hours' ? `<span class="hr-counts"><span class="${balanceOf(e.id) > 0 ? 'pos' : balanceOf(e.id) < 0 ? 'neg' : ''}">${balanceOf(e.id) ? (balanceOf(e.id) > 0 ? '+' : '') + hm(balanceOf(e.id)) : '0h'}</span></span>`
        : `<span class="hr-counts"><span class="pos">+${count(e.id, 'positive')}</span><span class="neg">−${count(e.id, 'negative')}</span></span>`}
    </button>`).join('') || '<p class="muted">Aucun employé.</p>';
  const emp = emps.find(e => e.id === hrSel);
  $('#hrName').textContent = emp ? emp.name : '';
  $('#hrSummary').textContent = emp ? `${count(emp.id, 'positive')} positive(s) · ${count(emp.id, 'negative')} négative(s)`
    + (lates(emp.id).length ? ` · ⏰ ${lates(emp.id).length} retard(s), ${lateMin(emp.id)} min au total` : '') : '';
  if (hrTab === 'hours' && emp) $('#hrSummary').textContent = `Solde : ${balanceText(balanceOf(emp.id))}`;
  renderHours(emp);
  const mine = notes.filter(n => emp && n.empId === emp.id && (hrFilter === 'all' || n.type === hrFilter)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('#hrNotes').innerHTML = mine.length ? mine.map(n => `<li class="hr-note ${n.type}">
      <div class="hr-note-head"><span class="tag ${n.type}">${n.late ? '⏰ Retard · ' + n.late.minutes + ' min' : n.type === 'positive' ? '👍 Positif' : '👎 Négatif'}</span>
        <span class="muted">${hrWhen(n.createdAt)}${n.author ? ' · par ' + esc(n.author) : ''}</span>
        <button class="ghost hr-del" data-del="${n.id}" title="Supprimer la remarque">✕</button></div>
      <p>${esc(n.text).replace(/\n/g, '<br>')}</p></li>`).join('') : '<li class="muted">Aucune remarque pour le moment.</li>';
}
function renderHours(emp) {
  const list = ((data.hr && data.hr.hours) || []).filter(h => emp && h.empId === emp.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const bal = emp ? balanceOf(emp.id) : 0;
  const sum = k => list.filter(h => h.kind === k).reduce((m, h) => m + h.minutes, 0);
  $('#hoursBalance').innerHTML = `<div class="bal ${bal > 0 ? 'pos' : bal < 0 ? 'neg' : ''}"><span>Solde</span><b>${balanceText(bal)}</b></div>
    <div><span>Heures supp</span><b>${hm(sum('supp'))}</b><small>= ${hm(sum('supp') * 2)} de récup</small></div>
    <div><span>Récup prise</span><b>${hm(sum('recup'))}</b></div>
    <div><span>Heures à faire</span><b>${hm(sum('afaire'))}</b></div>
    <div><span>Rattrapées</span><b>${hm(sum('rattrape'))}</b></div>`;
  $('#hoursList').innerHTML = list.length ? '<tr><th>Date</th><th>Type</th><th>Durée</th><th>Effet</th><th>Commentaire</th><th>Ajouté</th><th></th></tr>' + list.map(h => {
    const [label, f] = HOUR_KINDS[h.kind] || [h.kind, 0], eff = h.minutes * f;
    return `<tr><td>${fmtDate(h.date)}/${h.date.slice(2, 4)}</td><td><span class="tag ${f > 0 ? 'positive' : 'negative'}">${label}</span></td><td>${hm(h.minutes)}</td>
      <td class="${eff > 0 ? 'eff-pos' : 'eff-neg'}">${eff > 0 ? '+' : ''}${hm(eff)}</td><td>${esc(h.comment || '')}</td><td class="muted">${hrWhen(h.createdAt)}${h.author ? '<br>par ' + esc(h.author) : ''}</td>
      <td><button class="ghost" data-hdel="${h.id}" title="Supprimer">✕</button></td></tr>`;
  }).join('') : '<tr><td class="muted">Aucune heure enregistrée.</td></tr>';
  showHoursPreview();
}
function hoursMinutes() { const m = $('#hoursDur').value.match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
function showHoursPreview() {
  const k = HOUR_KINDS[$('#hoursKind').value], min = hoursMinutes();
  $('#hoursPreview').textContent = !min ? 'Indique la durée.' : k[1] === 2 ? `${hm(min)} supp → +${hm(min * 2)} de récup sur le solde.`
    : `${k[0]} : ${k[1] > 0 ? '+' : '−'}${hm(min)} sur le solde.`;
}
$('#hoursKind').onchange = showHoursPreview;
$('#hoursDur').oninput = showHoursPreview;
$('#hoursAdd').onclick = async () => {
  if (!hrSel) return toast('Choisis un employé');
  if (!$('#hoursDate').value) return toast('Choisis la date');
  if (!hoursMinutes()) return toast('Indique la durée');
  await api('/api/hr/hours/add', { empId: hrSel, kind: $('#hoursKind').value, date: $('#hoursDate').value, minutes: hoursMinutes(), comment: $('#hoursComment').value });
  $('#hoursComment').value = ''; toast('Heures enregistrées');
};
$('#hoursList').addEventListener('click', e => {
  const b = e.target.closest('[data-hdel]'); if (b && confirm('Supprimer cette ligne ?')) api('/api/hr/hours/delete', { id: b.dataset.hdel });
});
document.querySelectorAll('.hr-tabs button').forEach(b => b.onclick = () => {
  hrTab = b.dataset.tab;
  document.querySelectorAll('.hr-tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#hrTabNotes').hidden = hrTab !== 'notes';
  $('#hrTabHours').hidden = hrTab !== 'hours';
  if (!$('#hoursDate').value) $('#hoursDate').value = today();
  renderHr();
});
$('#hrPeople').addEventListener('click', e => { const b = e.target.closest('[data-emp]'); if (b) { hrSel = b.dataset.emp; renderHr(); checkLate(); } });
const setHrType = t => { hrType = t; $('#hrPos').classList.toggle('on', t === 'positive'); $('#hrNeg').classList.toggle('on', t === 'negative'); };
$('#hrPos').onclick = () => setHrType('positive');
$('#hrNeg').onclick = () => setHrType('negative');
$('#hrAdd').onclick = async () => {
  if (!$('#hrText').value.trim()) return toast('Écris la remarque');
  await api('/api/hr/add', { empId: hrSel, type: hrType, text: $('#hrText').value });
  $('#hrText').value = ''; toast('Remarque ajoutée');
};
$('#hrNotes').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  if (confirm('Supprimer cette remarque ?')) api('/api/hr/delete', { id: b.dataset.del });
});
document.querySelectorAll('.hr-filter button').forEach(b => b.onclick = () => {
  hrFilter = b.dataset.f;
  document.querySelectorAll('.hr-filter button').forEach(x => x.classList.toggle('on', x === b));
  renderHr();
});
// Téléchargement d'un fichier Excel (en ligne : fabriqué dans la page ; en local : par le serveur).
async function downloadXlsx(path, q) {
  if (!backend) { location.href = path + '?' + new URLSearchParams({ month, ...q }); return; }
  const out = await backend.handle('GET', path, { month, ...q }, {});
  if (!out.xlsx) return toast((out.json && out.json.error) || 'Export impossible');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = out.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Retard : heure prévue lue dans l'horaire, minutes de retard calculées en direct.
let latePlanned = null;
async function checkLate() {
  latePlanned = null;
  const date = $('#lateDate').value;
  if (!date || !hrSel) { $('#latePlanned').textContent = 'Choisis la date : l\'outil retrouve l\'heure prévue dans l\'horaire.'; $('#latePlanned').className = 'late-planned'; return; }
  const j = await call('/api/hr/late-check', { month, empId: hrSel, date });
  if (j.error) { $('#latePlanned').textContent = j.error; $('#latePlanned').className = 'late-planned bad'; return; }
  latePlanned = j.planned;
  showLateDelay();
}
function showLateDelay() {
  if (!latePlanned) return;
  let txt = `Devait commencer à ${latePlanned.startLabel} (${latePlanned.label}).`, cls = 'late-planned ok';
  const m = $('#lateTime').value.match(/^(\d{2}):(\d{2})$/);
  if (m) {
    const min = Number(m[1]) * 60 + Number(m[2]) - latePlanned.start * 60;
    if (min > 0) { txt += ` Arrivé à ${$('#lateTime').value} → ${min >= 60 ? Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') : min + ' min'} de retard.`; cls = 'late-planned bad'; }
    else txt += ' Arrivé à l\'heure : pas de retard.';
  }
  $('#latePlanned').textContent = txt; $('#latePlanned').className = cls;
}
$('#lateDate').onchange = checkLate;
$('#lateTime').oninput = showLateDelay;
$('#lateAdd').onclick = async () => {
  if (!$('#lateDate').value || !$('#lateTime').value) return toast('Indique la date et l\'heure d\'arrivée');
  await api('/api/hr/late', { empId: hrSel, date: $('#lateDate').value, time: $('#lateTime').value, comment: $('#lateComment').value });
  $('#lateTime').value = ''; $('#lateComment').value = ''; latePlanned = null; checkLate();
  toast('Retard enregistré');
};
// Export : les remarques ou les heures, selon la sous-section ouverte.
const hrExportPath = () => hrTab === 'hours' ? '/api/export-hours.xlsx' : '/api/export-hr.xlsx';
$('#hrExportAll').onclick = () => downloadXlsx(hrExportPath(), {});
$('#hrExportOne').onclick = () => hrSel && downloadXlsx(hrExportPath(), { emp: hrSel });

// ----- Droits, annuler, historique, accès et sauvegardes -----
let access = null;
const ROLE_LABEL = { admin: 'Administrateur', editor: 'Éditeur', viewer: 'Lecteur' };
function renderAccount() {
  const acc = data.account, role = acc.role || 'admin';
  document.body.classList.toggle('readonly', role === 'viewer');
  document.body.classList.toggle('not-admin', role !== 'admin');
  $('#roBar').hidden = role !== 'viewer';
  // Annuler : la dernière étape de l'historique.
  const last = (data.history || [])[0];
  $('#undoBtn').hidden = !last || role === 'viewer';
  if (last) $('#undoBtn').title = `Annuler : ${last.label} (${hrWhen(last.at)})`;
  $('#undoBtn2').disabled = !last || role === 'viewer';
  $('#historyList').innerHTML = (data.history || []).length ? '<tr><th>Quand</th><th>Modification</th><th>Par</th><th></th></tr>' + data.history.map((h, k) =>
    `<tr><td>${hrWhen(h.at)}</td><td>${esc(h.label)}</td><td class="muted">${esc(h.author || '')}</td>
      <td>${role === 'viewer' ? '' : `<button data-hist="${h.id}">${k === 0 ? 'Annuler' : 'Revenir avant'}</button>`}</td></tr>`).join('')
    : '<tr><td class="muted">Aucune modification enregistrée pour le moment.</td></tr>';
  // Plusieurs espaces : choix de l'espace.
  $('#wsCard').hidden = !(acc.workspaces && acc.workspaces.length > 1);
  if (acc.workspaces) $('#wsSelect').innerHTML = acc.workspaces.map((w, i) => `<option value="${w.id}" ${w.id === acc.workspaceId ? 'selected' : ''}>${esc(w.name)} ${i + 1} · ${ROLE_LABEL[w.role]}</option>`).join('');
  $('#accessCard').hidden = acc.mode !== 'cloud';
  $('#backupCard').hidden = acc.mode !== 'cloud' || role !== 'admin';
  renderAccess();
}
function renderAccess() {
  if (!access) { $('#membersList').innerHTML = '<tr><td class="muted">Chargement…</td></tr>'; $('#backupList').innerHTML = ''; return; }
  const me = data.account.email, admin = data.account.role === 'admin';
  $('#membersList').innerHTML = '<tr><th>Compte</th><th>Rôle</th><th></th></tr>' + access.members.map(m => `<tr><td>${esc(m.email)}${m.email === me ? ' <span class="tag">toi</span>' : ''}</td>
    <td>${admin && m.email !== me ? `<select data-role="${esc(m.email)}">${Object.entries(ROLE_LABEL).map(([v, l]) => `<option value="${v}" ${v === m.role ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ROLE_LABEL[m.role]}</td>
    <td>${admin && m.email !== me ? `<button class="danger" data-rmuser="${m.user_id}">Retirer</button>` : ''}</td></tr>`).join('');
  $('#backupList').innerHTML = access.backups.length ? '<tr><th>Date</th><th>Type</th><th></th></tr>' + access.backups.map(b => `<tr><td>${hrWhen(b.created_at)}</td>
    <td>${b.kind === 'hebdo' ? 'Automatique (lundi)' : 'Manuelle'}</td><td><button data-restore="${b.id}">Restaurer</button></td></tr>`).join('') : '<tr><td class="muted">Aucune sauvegarde pour le moment.</td></tr>';
}
async function loadAccess() {
  if (!data || data.account.mode !== 'cloud') return;
  const j = await call('/api/access/list', { month });
  if (j.error) return toast(j.error);
  access = j.access; renderAccess();
}
async function accessCall(path, body, msg) {
  const j = await call(path, { month, ...body });
  if (j.error) return toast(j.error);
  data = j; access = j.access; render(); toast(msg);
}
async function undo(id) {
  const j = await api('/api/undo', id ? { id } : {});
  toast(`Annulé : ${j.undone}`);
}
$('#undoBtn').onclick = () => { const last = data.history[0]; if (last && confirm(`Annuler « ${last.label} » ?`)) undo(); };
$('#undoBtn2').onclick = () => $('#undoBtn').onclick();
$('#historyList').addEventListener('click', e => {
  const b = e.target.closest('[data-hist]'); if (!b) return;
  const h = data.history.find(x => x.id === b.dataset.hist);
  if (confirm(`Revenir à l'état d'avant « ${h.label} » (${hrWhen(h.at)}) ? Les modifications faites après seront aussi annulées.`)) undo(h.id);
});
$('#memberAdd').onclick = () => accessCall('/api/access/add', { email: $('#memberEmail').value, role: $('#memberRole').value }, 'Accès donné');
$('#membersList').addEventListener('change', e => {
  const s = e.target.closest('[data-role]'); if (s) accessCall('/api/access/add', { email: s.dataset.role, role: s.value }, 'Rôle modifié');
});
$('#membersList').addEventListener('click', e => {
  const b = e.target.closest('[data-rmuser]'); if (b && confirm('Retirer l\'accès de ce compte ?')) accessCall('/api/access/remove', { userId: b.dataset.rmuser }, 'Accès retiré');
});
$('#backupNow').onclick = () => accessCall('/api/backup/now', {}, 'Sauvegarde faite');
$('#backupList').addEventListener('click', e => {
  const b = e.target.closest('[data-restore]');
  if (b && confirm('Restaurer cette sauvegarde ? Le planning actuel est d\'abord sauvegardé, puis remplacé.')) accessCall('/api/backup/restore', { id: b.dataset.restore }, 'Sauvegarde restaurée');
});
$('#wsSwitch').onclick = () => api('/api/workspace/switch', { id: $('#wsSelect').value }).then(() => { access = null; loadAccess(); toast('Espace ouvert'); });

// ----- Planning partagé : afficher les modifications faites par l'autre compte -----
// Toutes les 30 secondes (page visible, rien en cours de saisie), on vérifie s'il y a du nouveau.
setInterval(async () => {
  if (!backend || !data || document.visibilityState !== 'visible') return;
  if (!pop.hidden || document.querySelector('dialog[open]')) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  const before = data.reloaded;
  const j = await call('/api/state', null, { month });
  if (j.error || j.reloaded === before) return;
  data = j; render();
  toast('Planning mis à jour : modifications faites par un autre compte');
}, 30000);

// ----- Navigation entre les pages -----
const PAGES = [...document.querySelectorAll('.page')];
function go(page) {
  const el = PAGES.find(p => p.dataset.page === page) || PAGES[0];
  document.body.dataset.page = el.dataset.page;
  PAGES.forEach(p => { p.hidden = p !== el; });
  $('#pageTitle').textContent = el.dataset.title;
  $('#pageSub').textContent = el.dataset.sub || '';
  document.querySelectorAll('.nav[data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === el.dataset.page));
  document.body.classList.remove('menu-open');
  try { localStorage.setItem('page', el.dataset.page); } catch {}
  if (el.dataset.page === 'settings') loadAccess();
  window.scrollTo(0, 0);
}
// Les anciennes fenêtres sont devenues des pages : « ouvrir » = aller à la page.
PAGES.forEach(p => { p.showModal = () => go(p.dataset.page); p.close = () => {}; });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  // Un raccourci (carte, action rapide) passe par le bouton du menu, qui prépare la page.
  const nav = document.querySelector(`.nav[data-go="${b.dataset.go}"]`);
  if (b !== nav && nav && nav.onclick) return nav.click();
  if (!b.onclick) go(b.dataset.go);
});
$('#menuBtn').onclick = () => document.body.classList.toggle('menu-open');
$('#scrim').onclick = () => document.body.classList.remove('menu-open');
go('dashboard');

// ----- Vue « jour par jour » (pratique sur téléphone) -----
const DOW_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const SHIFT_ORDER = ['8-16', '10-18', '11-19', '12-20', 'FOOT', 'CHEF'];
function renderDays() {
  const v = data.view;
  const today = new Date().toISOString().slice(0, 10);
  const chip = (r, c, date) => `<button class="chip c-${shiftCls(c, r.isChef)}" data-emp="${r.id}" data-date="${date}">${esc(r.name)}${c.kind === 'off' ? ` · ${SHORT[c.code] || c.code}` : ''}</button>`;
  let h = '';
  for (const d of v.days) {
    const work = {}, off = [], empty = [];
    for (const r of v.rows) {
      const c = r.cells[d.date];
      if (c && c.kind === 'work') { const k = r.isChef ? 'CHEF' : c.shift; (work[k] = work[k] || []).push(chip(r, c, d.date)); }
      else if (c) off.push(chip(r, c, d.date));
      else if (!r.isChef && !d.closed) empty.push(`<button class="chip empty" data-emp="${r.id}" data-date="${d.date}">${esc(r.name)}</button>`);
    }
    const badges = [
      d.openSunday ? '<span class="badge open">Ouvert</span>' : '',
      d.holiday ? `<span class="badge holiday">Férié : ${esc(d.holiday)}${d.closed ? '' : ' (rouvert)'}</span>` : '',
      d.closed && !d.openSunday ? '<span class="badge">Fermé</span>' : '',
      d.match ? `<span class="badge foot">⚽ ${d.match.time} ${esc(d.match.opponent)}</span>` : '',
      d.weGroup.length ? `<span class="badge">Week-end : ${esc(d.weGroup.join(', '))}</span>` : '',
    ].join('');
    const bad = d.missing || d.warnings.length;
    const count = d.need ? `<span class="count ${bad ? 'bad' : ''}">${d.present + d.students.length}/${d.need}</span>` : '';
    const lines = SHIFT_ORDER.filter(t => work[t]).map(t => {
      const label = t === 'FOOT' ? `⚽ ${d.match ? d.match.shift : ''}` : t === 'CHEF' ? `Chef ${esc(data.config.chef.shift)}` : t;
      return `<div class="line"><span class="lbl c-${t}">${label}</span><div>${work[t].join('')}</div></div>`;
    });
    const studs = d.studentRows.filter(r => !r.none).sort((a, b) => a.k - b.k);
    if (studs.length) lines.push(`<div class="line"><span class="lbl">Étudiants</span><div>${studs.map(r =>
      `<button class="chip c-STUDENT ${r.manual ? '' : 'auto'}" data-emp="student-${r.k}" data-date="${d.date}">Student ${r.k} · ${r.shift === 'FOOT' ? '⚽ ' + (d.match ? d.match.shift : '') : r.shift}</button>`).join('')}</div></div>`);
    if (off.length) lines.push(`<div class="line"><span class="lbl">Absents</span><div>${off.join('')}</div></div>`);
    if (empty.length) lines.push(`<div class="line"><span class="lbl">À placer</span><div>${empty.join('')}</div></div>`);
    const quiet = d.closed && !Object.keys(work).length && !off.length;
    const card = `<section class="daycard ${quiet ? 'quiet' : ''} ${d.date === today ? 'today' : ''} ${bad ? 'bad' : ''}" id="day-${d.date}">
      <header><b>${DOW_FULL[d.dow]} ${d.day}</b>${badges}${count}</header>
      ${quiet ? '' : lines.join('')}
      ${d.warnings.length ? `<p class="warn">${d.warnings.map(esc).join(' · ')}</p>` : ''}
    </section>`;
    dayCards[d.date] = card;
    h += card;
  }
  $('#dayView').innerHTML = h;
}
const dayCards = {};

// Tableau ou jour par jour : par défaut « jour par jour » sur téléphone ; le choix est retenu.
let view = (() => { try { return localStorage.getItem('view'); } catch { return null; } })() || (innerWidth < 700 ? 'days' : 'table');
function applyView(scroll) {
  $('#tableView').hidden = view !== 'table';
  $('#dayView').hidden = view !== 'days';
  $('#vTable').classList.toggle('on', view === 'table');
  $('#vDays').classList.toggle('on', view === 'days');
  try { localStorage.setItem('view', view); } catch {}
  const t = document.getElementById('day-' + new Date().toISOString().slice(0, 10));
  if (scroll && view === 'days' && t) t.scrollIntoView({ block: 'start' });
}
$('#vTable').onclick = () => { view = 'table'; applyView(); };
$('#vDays').onclick = () => { view = 'days'; applyView(true); };
applyView();

// ----- Édition d'une case -----
const pop = $('#popover');
document.addEventListener('click', e => {
  const th = e.target.closest('#grid thead th[data-date]');
  if (th) {
    const d = (data.view.allDays || data.view.days).find(x => x.date === th.dataset.date);
    if (d.dow === 0) return;
    const what = d.holiday ? ` (férié : ${d.holiday})` : '';
    if (confirm(d.closed ? `Rouvrir le ${fmtDate(d.date)}${what} ?` : `Marquer le ${fmtDate(d.date)}${what} comme jour de fermeture ?`))
      api('/api/config', { toggleClosed: d.date });
    return;
  }
  if (e.target.closest('#grid .add-emp')) { openEmp(null); return; }
  if (e.target.closest('#grid .edit-chef')) { openChef(); return; }
  const ed = e.target.closest('#grid .edit-emp');
  if (ed) { openEmp(ed.dataset.id); return; }
  const td = e.target.closest('#grid td.cell, #dayView .chip');
  if (td) { openPop(td); return; }
  if (!e.target.closest('#popover')) pop.hidden = true;
});
function openPop(td) {
  if (document.body.classList.contains('readonly')) return; // lecteur : consultation seulement
  const { emp, date } = td.dataset;
  const day = (data.view.allDays || data.view.days).find(x => x.date === date);
  const row = data.view.rows.find(r => r.id === emp) || data.view.studentRows.find(r => r.id === emp);
  const opts = row.isChef ? [data.config.chef.shift] : day.openSunday ? ['11-19'] : ['8-16', '10-18', '12-20'];
  if (day.match && !row.isChef) opts.push('FOOT');
  let h = `<div class="ttl">${esc(row.name)} – ${day.dowLabel} ${fmtDate(date)}</div>`;
  if (row.isStudent) {
    for (const o of opts) h += `<button data-v="${o}" class="c-${o === 'FOOT' ? 'FOOT' : 'STUDENT'}">${o === 'FOOT' ? '⚽ ' + day.match.shift : o}</button>`;
    h += `<button data-v="NONE" class="c-NONE">Aucun étudiant</button>`;
    h += `<button data-v="auto" class="auto">Automatique (déverrouiller)</button>`;
    return showPop(td, h, emp, date);
  }
  for (const o of opts) h += `<button data-v="${o}" class="c-${row.isChef ? 'CHEF' : o}">${o === 'FOOT' ? '⚽ ' + day.match.shift : o}</button>`;
  for (const k of Object.keys(OFF)) if (!row.isChef || ['REPOS', 'CONGE', 'MALADIE', 'FORMATION', 'RTT'].includes(k)) h += `<button data-v="${k}" class="c-${k}">${OFF[k]}</button>`;
  h += `<button data-v="auto" class="auto">Automatique (déverrouiller)</button>`;
  showPop(td, h, emp, date);
}
function showPop(td, h, emp, date) {
  pop.innerHTML = h;
  pop.hidden = false;
  const r = td.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 8)) + 'px';
  pop.style.top = (window.scrollY + r.bottom + 4) + 'px';
  pop.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    pop.hidden = true;
    api('/api/cell', { empId: emp, date, value: b.dataset.v });
  };
}

// ----- Glisser-déposer par appui long (horaire et zones) -----
// Appui long (0,4 s) sur un élément, puis on le lâche sur une cible permise. Un petit déplacement avant = défilement.
// opts : { root, source(el) → élément à déplacer ou null, targets(src) → cibles permises, drop(src, target) }
// Souris : événements « pointer ». Doigt (téléphone) : événements « touch », car Android et l'iPhone coupent les
// événements « pointer » pendant un appui long (menu, défilement), ce qui annulait le glisser.
const drag = { timer: null, on: false, src: null, opts: null, ghost: null, over: null, x: 0, y: 0, touch: false, justDropped: false };
function dragEnd() {
  clearTimeout(drag.timer); drag.timer = null;
  if (drag.ghost) drag.ghost.remove();
  document.querySelectorAll('.drag-src, .drag-ok, .drag-over').forEach(x => x.classList.remove('drag-src', 'drag-ok', 'drag-over'));
  document.body.classList.remove('dragging');
  Object.assign(drag, { on: false, src: null, opts: null, ghost: null, over: null, touch: false });
}
function dragStart(opts, target, x, y, touch) {
  if (document.body.classList.contains('readonly') || drag.src) return;
  const src = opts.source(target);
  if (!src) return;
  Object.assign(drag, { src, opts, x, y, touch });
  drag.timer = setTimeout(() => {
    drag.on = true; pop.hidden = true; document.querySelector('.zmenu')?.remove();
    document.body.classList.add('dragging');
    src.classList.add('drag-src');
    opts.targets(src).forEach(el => { if (el !== src) el.classList.add('drag-ok'); });
    drag.ghost = (src.firstElementChild || src).cloneNode(true);
    drag.ghost.classList.add('drag-ghost');
    document.body.appendChild(drag.ghost);
    moveGhost(drag.x, drag.y);
    if (navigator.vibrate) try { navigator.vibrate(30); } catch {}
  }, 400);
}
function dragMove(x, y) {
  if (!drag.on) { if (Math.hypot(x - drag.x, y - drag.y) > 8) dragEnd(); return; } // c'est un défilement
  drag.x = x; drag.y = y;
  moveGhost(x, y);
  // La cible la plus précise sous le doigt (une personne dans une case de zone avant la case elle-même).
  const t = document.elementFromPoint(x, y)?.closest('.drag-ok') || null;
  if (t !== drag.over) { drag.over?.classList.remove('drag-over'); t?.classList.add('drag-over'); drag.over = t; }
}
function dragDrop() {
  const { on, src, over, opts } = drag;
  dragEnd();
  if (!on) return;
  drag.justDropped = true; setTimeout(() => { drag.justDropped = false; }, 400);
  if (over) opts.drop(src, over);
}
function longPressDrag(opts) {
  opts.root.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button > 0) return; // le doigt passe par touchstart
    dragStart(opts, e.target, e.clientX, e.clientY, false);
  });
  opts.root.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { if (drag.src) dragEnd(); return; }
    const t = e.touches[0];
    dragStart(opts, e.target, t.clientX, t.clientY, true);
  }, { passive: true });
}
function moveGhost(x, y) { if (drag.ghost) { drag.ghost.style.left = x + 'px'; drag.ghost.style.top = y + 'px'; } }
document.addEventListener('pointermove', e => { if (drag.src && !drag.touch) dragMove(e.clientX, e.clientY); });
document.addEventListener('pointerup', () => { if (drag.src && !drag.touch) dragDrop(); });
document.addEventListener('pointercancel', () => { if (drag.src && !drag.touch) dragEnd(); });
// Doigt : une fois le glisser lancé, la page ne défile plus (preventDefault), et on suit le doigt.
document.addEventListener('touchmove', e => {
  if (!drag.src || !drag.touch) return;
  const t = e.touches[0];
  if (drag.on) e.preventDefault();
  dragMove(t.clientX, t.clientY);
}, { passive: false });
document.addEventListener('touchend', e => { if (drag.src && drag.touch) { if (drag.on) e.preventDefault(); dragDrop(); } }, { passive: false });
document.addEventListener('touchcancel', () => { if (drag.src && drag.touch) dragEnd(); });
// Appui long sur téléphone : pas de menu du navigateur ni de sélection de texte pendant le glisser.
document.addEventListener('contextmenu', e => { if (drag.src) e.preventDefault(); });
document.addEventListener('selectstart', e => { if (drag.src) e.preventDefault(); });
// Le clic qui suit un dépôt n'ouvre pas le menu de la case.
document.addEventListener('click', e => { if (drag.justDropped) { e.stopPropagation(); e.preventDefault(); } }, true);

// Horaire : échange de deux horaires le même jour, seulement entre deux employés (ou deux étudiants) ;
// les jours suivants ne sont pas recalculés.
const swapGroup = td => td.closest('tr.student') ? 'student' : td.closest('tr.chef') ? null : 'emp';
const swappable = td => td && td.matches('#grid td.cell') && swapGroup(td) && !td.querySelector('.c-MALADIE, .c-FORMATION');
longPressDrag({
  root: $('#grid'),
  source: el => { const td = el.closest('td.cell'); return swappable(td) && td.textContent.trim() ? td : null; },
  targets: td => [...document.querySelectorAll(`#grid td.cell[data-date="${td.dataset.date}"]`)].filter(x => swapGroup(x) === swapGroup(td) && swappable(x)),
  drop: (src, over) => api('/api/swap', { date: src.dataset.date, a: src.dataset.emp, b: over.dataset.emp })
    .then(() => toast('Horaires échangés. « Annuler » pour revenir en arrière.')).catch(() => {}),
});

// ----- Matchs -----
function renderOpenings() {
  const info = data.openingsInfo;
  $('#openingsInfo').textContent = (info.lastFetch ? `Lu sur westlandshopping.be le ${new Date(info.lastFetch).toLocaleString('fr-BE')}.` : 'Pas encore lu sur le site.')
    + (info.lastError ? ` Erreur : ${info.lastError}` : '');
  const list = data.openings;
  $('#openList').innerHTML = list.length ? '<tr><th>Dimanche</th><th>Raison</th><th>Heures du centre</th><th></th></tr>' + list.map(o => `
    <tr class="${o.ignored ? 'ign' : ''}">
      <td>${fmtDate(o.date)}/${o.date.slice(0, 4)}</td><td>${esc(o.label)}</td><td>${esc(o.hours || '—')}</td>
      <td>${o.source === 'manuel' ? `<button data-odel="${o.id}">Supprimer</button>` : `<button data-oign="${o.id}" data-val="${o.ignored ? '' : '1'}">${o.ignored ? 'Réactiver' : 'Ignorer'}</button>`}</td>
    </tr>`).join('') : '<tr><td class="muted">Aucun dimanche d\'ouverture à venir.</td></tr>';
}
$('#openList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.odel) api('/api/openings/delete', { id: b.dataset.odel });
  if (b.dataset.oign) api('/api/openings/override', { id: b.dataset.oign, ignored: !!b.dataset.val });
});
$('#addOpening').onclick = () => {
  const date = $('#oDate').value;
  if (!date) return toast('Choisis un dimanche');
  api('/api/openings/add', { date, label: $('#oLabel').value });
};

function renderMatches() {
  renderOpenings();
  const info = data.matchesInfo;
  $('#matchesInfo').textContent = (info.lastFetch ? `Dernière mise à jour : ${new Date(info.lastFetch).toLocaleString('fr-BE')}.` : 'Jamais mis à jour.')
    + (info.lastError ? ` Erreur : ${info.lastError}` : '') + ` Matchs de ${$('#monthTitle').textContent}.`;
  const list = data.allMatches;
  $('#matchList').innerHTML = list.length ? '<tr><th>Date</th><th>Adversaire</th><th>Compétition</th><th>Heure</th><th></th></tr>' + list.map(m => `
    <tr class="${m.ignored ? 'ign' : ''}">
      <td>${fmtDate(m.date)}</td><td>${esc(m.opponent)}</td>
      <td>${esc(m.competition)} ${m.confirmed === false ? '<span class="tag warn">heure à confirmer</span>' : ''}</td>
      <td><input type="time" value="${m.time}" data-id="${m.id}" class="mtime"></td>
      <td>${m.source === 'manuel' ? `<button data-del="${m.id}">Supprimer</button>` : `<button data-ign="${m.id}" data-val="${m.ignored ? '' : '1'}">${m.ignored ? 'Réactiver' : 'Ignorer'}</button>`}</td>
    </tr>`).join('') : '<tr><td class="muted">Aucun match à domicile ce mois-ci.</td></tr>';
}
$('#openMatches').onclick = () => $('#matchesDlg').showModal();
$('#refreshMatches').onclick = async e => {
  e.target.disabled = true;
  try { await api('/api/matches/refresh', {}); toast('Calendrier mis à jour'); } finally { e.target.disabled = false; }
};
$('#matchList').addEventListener('change', e => {
  if (e.target.matches('.mtime')) api('/api/matches/override', { id: e.target.dataset.id, time: e.target.value });
});
$('#matchList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.del) api('/api/matches/delete', { id: b.dataset.del });
  if (b.dataset.ign) api('/api/matches/override', { id: b.dataset.ign, ignored: !!b.dataset.val });
});
$('#addMatch').onclick = () => {
  const date = $('#mDate').value, time = $('#mTime').value;
  if (!date || !time) return toast('Indique la date et l\'heure');
  api('/api/matches/add', { date, time, opponent: $('#mOpp').value });
};

// ----- Paramètres -----
// Disponibilités des étudiants (index 0 = dimanche), avec les mêmes valeurs par défaut que le moteur.
function studentAvailConfig() {
  const s = data.config.students || {};
  const a = s.avail || {};
  return {
    normal: a.normal || [0, 1, 2, 3, 4, 5, 6].map(d => (s.days || [3, 5, 6]).includes(d) ? (s.max ?? 3) : 0),
    match: a.match || [2, 2, 2, 2, 2, 2, 4],
    openSunday: a.openSunday ?? 3,
    dates: a.dates || {},
  };
}
function renderAvail() {
  const a = studentAvailConfig();
  const order = [1, 2, 3, 4, 5, 6, 0], lbl = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];
  const line = (key, title) => `<tr><td>${title}</td>${order.map(d => `<td><input type="number" min="0" max="10" data-k="${key}" data-d="${d}" value="${a[key][d]}"></td>`).join('')}</tr>`;
  $('#availTable').innerHTML = `<tr><th></th>${order.map(d => `<th>${lbl[d]}</th>`).join('')}</tr>` + line('normal', 'Jour normal') + line('match', 'Jour de match');
  $('#footTeamIn').value = (data.config.foot && data.config.foot.team) || 3;
  $('#openSunIn').value = a.openSunday;
  const dates = Object.entries(a.dates).sort();
  $('#availDates').innerHTML = dates.length ? dates.map(([d, n]) => `<li>${fmtDate(d)}/${d.slice(0, 4)} : ${n} étudiant(s) <button class="ghost" data-del="${d}" title="Supprimer">✕</button></li>`).join('') : '';
}
$('#saveAvail').onclick = async () => {
  const get = k => { const arr = Array(7).fill(0); document.querySelectorAll(`#availTable input[data-k="${k}"]`).forEach(i => { arr[+i.dataset.d] = Number(i.value) || 0; }); return arr; };
  await api('/api/config', { students: { normal: get('normal'), match: get('match'), openSunday: $('#openSunIn').value }, footTeam: $('#footTeamIn').value });
  toast('Disponibilités enregistrées');
};
$('#addAvail').onclick = () => {
  if (!$('#availDate').value || $('#availN').value === '') return toast('Indique la date et le nombre d\'étudiants');
  api('/api/config', { studentDate: { date: $('#availDate').value, n: $('#availN').value } });
};
$('#availDates').addEventListener('click', e => {
  const b = e.target.closest('button[data-del]'); if (b) api('/api/config', { studentDate: { date: b.dataset.del, n: null } });
});

function renderSettings() {
  renderAvail();
  $('#accountBtn').hidden = data.account.mode !== 'cloud';
  $('#accEmail').textContent = data.account.email || '';
  $('#accountLabel').textContent = data.account.email || 'Mon compte';
  const c = data.config;
  const ch = c.chef, days = (ch.days || [2, 3, 4, 5, 6]).map(d => DOW_SHORT[d].slice(0, 3).toLowerCase()).join(', ');
  $('#teamChefInfo').innerHTML = `<p><b>${esc(ch.name)}</b> · chef terrain · ${esc(ch.shift)} · ${days}${ch.monthlyWeek === false ? '' : ' (une semaine par mois du lundi au vendredi)'}</p>`
    + `<p>Chef de parc : <b>${c.parkChief && c.parkChief.name ? esc(c.parkChief.name) : 'non renseigné'}</b> (affiché dans l'export Excel)</p>`;
  if (document.body.dataset.page === 'team') loadTeam();
  const name = id => (c.employees.find(e => e.id === id) || {}).name || id;
  $('#refSat').value = c.rotation.refSaturday;
  $('#refGroup').innerHTML = c.rotation.groups.map((g, i) => `<option value="${i}" ${i === c.rotation.refGroup ? 'selected' : ''}>${g.map(name).join(' et ')}</option>`).join('');
  $('#chefName').textContent = c.chef.name;
  $('#chefWeek').innerHTML = data.view.chefWeekOptions.map(mo => {
    const fri = new Date(mo + 'T12:00:00'); fri.setDate(fri.getDate() + 4);
    return `<option value="${mo}" ${mo === data.view.chefWeek ? 'selected' : ''}>Du lundi ${fmtDate(mo)} au vendredi ${String(fri.getDate()).padStart(2, '0')}/${String(fri.getMonth() + 1).padStart(2, '0')}</option>`;
  }).join('');
}
$('#openSettings').onclick = () => $('#settingsDlg').showModal();
$('#saveRotation').onclick = () => api('/api/config', { rotation: { refSaturday: $('#refSat').value, refGroup: $('#refGroup').value } }).then(() => toast('Roulement enregistré'));
$('#saveChef').onclick = () => api('/api/config', { chefWeek: { month, monday: $('#chefWeek').value } }).then(() => toast('Semaine enregistrée'));
$('#unlock').onclick = () => api('/api/unlock', {}).then(() => toast('Cases déverrouillées'));
$('#clear').onclick = () => confirm('Vider le mois (les cases verrouillées sont gardées) ?') && api('/api/clear', {});

// ----- Maladie et demandes (même fenêtre, plusieurs lignes) -----
const today = () => new Date().toISOString().slice(0, 10);
const REQUEST_CHOICES = [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['REPOS', 'Repos'], ['CONGE', 'Congé'], ['RTT', 'RTT']];
const activeEmps = () => data.config.employees.filter(e => !e.end || e.end >= today());
// Maladie / formation : aussi le chef terrain et le chef de parc (identifiant fixe « chef-parc »).
const chiefs = () => [{ id: data.config.chef.id, name: `${data.config.chef.name} (chef terrain)` },
  ...(data.config.parkChief && data.config.parkChief.name ? [{ id: 'chef-parc', name: `${data.config.parkChief.name} (chef de parc)` }] : [])];
const personName = id => (activeEmps().concat(data.config.employees, chiefs()).find(e => e.id === id) || {}).name || id;

function entriesDialog({ prefix, endpoint, withValue, describe, withChiefs }) {
  let rows = [];
  const el = id => $('#' + prefix + id);
  function render() {
    const opts = withChiefs ? [...activeEmps(), ...chiefs()] : activeEmps();
    // Formulaire vide au départ : on ajoute une ligne et on choisit l'employé (personne n'est pré-sélectionné).
    if (!rows.length) { el('Rows').innerHTML = '<p class="muted empty-rows">Aucun employé pour le moment. Clique sur le bouton ci-dessous pour en ajouter un.</p>'; return; }
    el('Rows').innerHTML = rows.map((s, i) => `
      <div class="row">
        <label>Employé <select data-i="${i}" data-k="empId"><option value="" ${s.empId ? '' : 'selected'} disabled>— Choisir —</option>${opts.map(e => `<option value="${e.id}" ${e.id === s.empId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
        ${withValue ? `<label>Quoi <select data-i="${i}" data-k="value">${REQUEST_CHOICES.map(([v, l]) => `<option value="${v}" ${v === s.value ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        <label>Du <input type="date" data-i="${i}" data-k="from" value="${s.from}"></label>
        <label>Au <input type="date" data-i="${i}" data-k="to" value="${s.to}"></label>
        <button data-rm="${i}" class="ghost" title="Retirer cette ligne">✕</button>
      </div>`).join('');
  }
  const blank = from => ({ empId: '', value: '8-16', from, to: from });
  el('Open').onclick = () => {
    rows = [];
    render(); el('Result').innerHTML = ''; el('Dlg').showModal();
  };
  el('Add').onclick = () => {
    const last = rows[rows.length - 1];
    rows.push(last ? { ...last, empId: '' } : blank(today()));
    render();
  };
  el('Rows').addEventListener('change', e => {
    const { i, k } = e.target.dataset; if (i === undefined) return;
    rows[i][k] = e.target.value;
    if (k === 'from' && rows[i].to < rows[i].from) { rows[i].to = rows[i].from; render(); }
  });
  el('Rows').addEventListener('click', e => {
    const b = e.target.closest('button[data-rm]'); if (!b) return;
    rows.splice(Number(b.dataset.rm), 1); render();
  });
  el('Save').onclick = async e => {
    if (!rows.length) return toast('Ajoute au moins un employé');
    if (rows.some(s => !s.empId)) return toast("Choisis l'employé sur chaque ligne");
    if (rows.some(s => !s.from || !s.to)) return toast('Indique les dates');
    e.target.disabled = true; e.target.textContent = 'Calcul en cours…';
    try {
      month = rows.map(s => s.from).sort()[0].slice(0, 7);
      const r = await api(endpoint, { entries: rows, regenerate: el('Regen').checked });
      const { regenerated, changes } = r.result;
      const nameOf = personName;
      const period = s => s.from === s.to ? `le ${fmtDate(s.from)}` : `du ${fmtDate(s.from)} au ${fmtDate(s.to)}`;
      let h = `<div class="ok-box">${rows.map(s => esc(describe(nameOf(s.empId), s, period(s)))).join('<br>')}`;
      h += regenerated.length ? '<br>Horaire recalculé.' : '<br>Horaire non recalculé (mois pas encore généré ou option décochée).';
      h += '</div>';
      el('Result').innerHTML = changesHtml(h, { regenerated, changes });
    } finally { e.target.disabled = false; e.target.textContent = 'Valider'; }
  };
}
// Maladies / formations déjà dans l'horaire : on peut changer les dates ou les supprimer (l'horaire est recalculé).
const ABSENCE_LISTS = [{ code: 'MALADIE', prefix: 'sick', word: 'maladie' }, { code: 'FORMATION', prefix: 'form', word: 'formation' }];
let absEdit = null; // période en cours de modification : `${code}|${empId}|${from}`
function renderAbsences() {
  const nameOf = personName;
  for (const { code, prefix, word } of ABSENCE_LISTS) {
    const list = (data.absences || []).filter(a => a.code === code);
    const el = $('#' + prefix + 'List');
    if (!list.length) { el.innerHTML = `<p class="muted">Aucune ${word} en cours ou à venir.</p>`; continue; }
    el.innerHTML = `<div class="abs-wrap"><table class="list"><tr><th>Employé</th><th>Du</th><th>Au</th><th>État</th><th></th></tr>` + list.map(a => {
      const key = `${a.code}|${a.empId}|${a.from}`;
      const state = a.to < today() ? 'Terminée' : a.from > today() ? 'À venir' : 'En cours';
      const past = a.to < today();
      const attrs = `data-code="${a.code}" data-emp="${a.empId}" data-from="${a.from}" data-to="${a.to}"`;
      if (absEdit === key) return `<tr ${attrs}><td>${esc(nameOf(a.empId))}</td>
        <td><input type="date" class="abs-from" value="${a.from}"></td><td><input type="date" class="abs-to" value="${a.to}"></td><td>${state}</td>
        <td class="abs-actions"><button class="primary abs-save">Enregistrer</button> <button class="ghost abs-cancel">Annuler</button></td></tr>`;
      return `<tr ${attrs}><td>${esc(nameOf(a.empId))}</td><td>${fmtDate(a.from)}</td><td>${fmtDate(a.to)}</td><td>${state}</td>
        <td class="abs-actions">${past ? '' : `<button class="abs-edit">Modifier</button> <button class="ghost danger abs-del">Supprimer</button>`}</td></tr>`;
    }).join('') + '</table></div><p class="muted small">Les jours déjà passés ne sont pas modifiés. Après un changement, l\'horaire des autres est recalculé.</p>';
  }
}
for (const { prefix, word } of ABSENCE_LISTS) $('#' + prefix + 'List').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-code]'); if (!tr) return;
  const a = { code: tr.dataset.code, empId: tr.dataset.emp, from: tr.dataset.from, to: tr.dataset.to };
  const name = personName(a.empId);
  const send = async (body, msg) => {
    e.target.disabled = true;
    try {
      const r = await api('/api/absence/edit', { ...a, ...body, regenerate: true });
      absEdit = null; renderAbsences(); toast(msg);
      $('#' + prefix + 'Result').innerHTML = changesHtml(`<div class="ok-box">${esc(msg)}</div>`, r.result);
    } finally { e.target.disabled = false; }
  };
  if (e.target.closest('.abs-edit')) { absEdit = `${a.code}|${a.empId}|${a.from}`; renderAbsences(); }
  else if (e.target.closest('.abs-cancel')) { absEdit = null; renderAbsences(); }
  else if (e.target.closest('.abs-del')) {
    if (confirm(`Supprimer la ${word} de ${name} (${fmtDate(a.from)} → ${fmtDate(a.to)}) ? Son horaire sera recalculé.`))
      await send({ remove: true }, `${word[0].toUpperCase() + word.slice(1)} de ${name} supprimée.`);
  } else if (e.target.closest('.abs-save')) {
    const newFrom = tr.querySelector('.abs-from').value, newTo = tr.querySelector('.abs-to').value;
    if (!newFrom || !newTo || newTo < newFrom) return toast('Dates invalides');
    await send({ newFrom, newTo }, `${word[0].toUpperCase() + word.slice(1)} de ${name} : du ${fmtDate(newFrom)} au ${fmtDate(newTo)}.`);
  }
});
function changesHtml(head, { regenerated, changes }) {
  let h = head;
  if (changes.length) {
    h += `<h4>Changements à prévenir (${changes.length})</h4><div class="changes"><table class="list"><tr><th>Date</th><th>Qui</th><th>Avant</th><th>Après</th></tr>`
      + changes.map(c => `<tr><td>${fmtDate(c.date)}</td><td>${esc(c.name)}</td><td>${esc(c.before)}</td><td><b>${esc(c.after)}</b></td></tr>`).join('')
      + '</table></div>';
  } else if (regenerated.length) h += '<p class="muted">Aucun autre horaire ne change.</p>';
  return h;
}

entriesDialog({ prefix: 'sick', endpoint: '/api/sick', withValue: false, withChiefs: true,
  describe: (name, s, period) => `${name} est en maladie ${period}.` });
entriesDialog({ prefix: 'form', endpoint: '/api/formation', withValue: false, withChiefs: true,
  describe: (name, s, period) => `${name} est en formation ${period}.` });
entriesDialog({ prefix: 'req', endpoint: '/api/requests', withValue: true,
  describe: (name, s, period) => `${name} : ${(REQUEST_CHOICES.find(c => c[0] === s.value) || [, s.value])[1]} ${period}.` });

// ----- Zones & dispatch : tournantes d'un jour (calculées par le serveur à partir de l'horaire) -----
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDay = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d); };
const Z_LABEL = { Z1: 'Zone 1', Z2: 'Zone 2', Z3: 'Zone 3', D: 'Dispatch', T: 'Toutes les zones' };
const Z_PLACE = { Z1: 'Total-Delhaize', Z2: 'City-Crélan', Z3: 'Toit & sous-terrain', D: 'Bureau', T: 'Seul sur le terrain' };
const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
let zDate = localDay(), zView = 'people', zData = null, zTab = 'now', zCounts = null;
try { zView = localStorage.getItem('zView') || zView; } catch {}

async function loadZones() {
  const j = await call('/api/zones', null, { month: zDate.slice(0, 7), date: zDate });
  if (j.error) return toast(j.error);
  zData = j.zones; zCounts = j.fieldCounts || null; syncZTeam(); renderZones();
}
function renderZones() {
  setZTab(zTab);
  const d = new Date(zDate + 'T12:00:00');
  $('#zTitle').textContent = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  $('#zDate').value = zDate;
  $('#zvPeople').classList.toggle('on', zView === 'people');
  $('#zvZones').classList.toggle('on', zView === 'zones');
  if (data) renderZTeam();
  if (zTab === 'now') renderNow();
  $('#zLegend').innerHTML = ['Z1', 'Z2', 'Z3', 'D', 'T'].map(z => `<span><i class="z-${z}"></i>${Z_LABEL[z]} · ${Z_PLACE[z]}</span>`).join('') + '<span>☕ Pause 30 min</span><span>🔒 Changé à la main</span>';
  const z = zData;
  if (!z || z.date !== zDate) { $('#zBox').innerHTML = '<p class="muted pad">Chargement…</p>'; return; }
  if (z.closed) { $('#zBox').innerHTML = "<p class=\"muted pad\">Westland fermé ce jour-là. Si vous travaillez quand même, ajoute les personnes dans « Équipe du jour » ci-dessus.</p>"; return; }
  if (!z.people.length) { $('#zBox').innerHTML = "<p class=\"muted pad\">Pas encore d'équipe pour ce jour. Ajoute les personnes et leur horaire dans « Équipe du jour » ci-dessus, puis enregistre.</p>"; return; }
  if (isPhone()) { $('#zBox').innerHTML = zonesCards(z); return; }
  const head = `<tr><th class="name">${zView === 'people' ? 'Personne' : 'Zone'}</th>${zView === 'people' ? '<th>Horaire</th>' : ''}${z.slots.map(s => `<th>${s.label}</th>`).join('')}${zView === 'people' ? '<th>Pause</th>' : ''}</tr>`;
  let body = '';
  if (zView === 'people') {
    for (const p of z.people) {
      body += `<tr><td class="name"><b>${esc(p.name)}</b></td><td class="muted">${esc((z.plan && z.plan.roleOf[p.id]) || p.shift)}</td>`;
      p.cells.forEach((c, s) => {
        const pause = p.pause && p.pause.slot === s ? `<small class="z-pause">☕ ${p.pause.start}</small>` : '';
        if (!c) { body += `<td class="zcell off">${pause}</td>`; return; }
        body += `<td class="zcell ${c.manual ? 'lock' : ''}" data-person="${p.id}" data-slot="${s}">`
          + (c.code ? `<span class="z-${c.code}"><b>${c.code === 'D' ? 'Dispatch' : c.code === 'T' ? 'Toutes zones' : c.code}</b><small>${Z_PLACE[c.code]}</small></span>` : '') + pause + '</td>';
      });
      body += `<td>${p.pause ? `${p.pause.start}-${p.pause.end}` : '<span class="muted">—</span>'}</td></tr>`;
    }
  } else {
    // Une personne seule sur le terrain : une seule case sur les 3 zones, elle choisit où aller.
    // Chaque nom peut être glissé (appui long) sur un collègue du même créneau (échange) ou dans une autre zone.
    const inZone = (code, s) => z.people.filter(p => p.cells[s] && p.cells[s].code === code);
    const who = (p, s) => `<div class="zp ${p.cells[s].manual ? 'lock' : ''}" data-person="${p.id}" data-slot="${s}"><span>${esc(p.name)}</span></div>`;
    const list = (code, s) => { const ps = inZone(code, s); return ps.length ? ps.map(p => who(p, s)).join('') : '<span class="muted">—</span>'; };
    for (const code of ['Z1', 'Z2', 'Z3', 'D'])
      body += `<tr><td class="name"><span class="zname z-${code}"><b>${Z_LABEL[code]}</b><small>${Z_PLACE[code]}</small></span></td>`
        + z.byZone.map((b, s) => {
          if (code === 'D' || !b.T.length) return `<td class="zlist" data-zone="${code}" data-slot="${s}">${list(code, s)}</td>`;
          if (code !== 'Z1') return '';
          return `<td class="zlist zalone" rowspan="3"><span class="z-T">${inZone('T', s).map(p => `<div class="zp" data-person="${p.id}" data-slot="${s}"><b>${esc(p.name)}</b></div>`).join('')}<small>Seul sur le terrain : couvre les 3 zones, il choisit où aller</small></span></td>`;
        }).join('') + '</tr>';
    body += '<tr><td class="name"><b>Pauses</b></td>' + z.slots.map((_, s) => `<td class="zlist">${z.people.filter(p => p.pause && p.pause.slot === s)
      .sort((a, b) => a.pause.start.localeCompare(b.pause.start)).map(p => `<div>☕ ${p.pause.start} ${esc(p.name)}</div>`).join('') || '<span class="muted">—</span>'}</td>`).join('') + '</tr>';
  }
  $('#zBox').innerHTML = `<table class="ztable">${head}${body}</table>`;
}
// Téléphone : des cartes au lieu du grand tableau (une par personne, ou une par créneau).
const isPhone = () => matchMedia('(max-width: 700px)').matches;
matchMedia('(max-width: 700px)').addEventListener('change', () => { if (zData) renderZones(); });
const zCode = c => `<span class="zs-code z-${c}"><b>${c === 'D' ? 'Dispatch' : c === 'T' ? 'Toutes zones' : Z_LABEL[c]}</b><small>${Z_PLACE[c]}</small></span>`;
function zonesCards(z) {
  if (zView === 'people') return '<div class="zcards">' + z.people.map(p => `
    <div class="zcard">
      <div class="zcard-head"><b>${esc(p.name)}</b><span class="muted">${esc(p.shift)}${p.pause ? ` · ☕ ${p.pause.start}-${p.pause.end}` : ''}</span></div>
      ${p.cells.map((c, s) => c ? `<div class="zslot zcell ${c.manual ? 'lock' : ''}" data-person="${p.id}" data-slot="${s}">
        <span class="zs-time">${z.slots[s].label}</span>${c.code ? zCode(c.code) : ''}</div>` : '').join('')}
    </div>`).join('') + '</div>';
  const names = list => list.length ? list.map(esc).join(', ') : '<span class="muted">—</span>';
  return '<div class="zcards">' + z.slots.map((sl, s) => {
    const b = z.byZone[s];
    const pauses = z.people.filter(p => p.pause && p.pause.slot === s).map(p => `☕ ${p.pause.start} ${esc(p.name)}`);
    const zones = b.T.length
      ? `<div class="zline">${zCode('T')}<span>${names(b.T)}</span></div>`
      : ['Z1', 'Z2', 'Z3'].map(c => `<div class="zline">${zCode(c)}<span>${names(b[c])}</span></div>`).join('');
    return `<div class="zcard"><div class="zcard-head"><b>${sl.label}</b></div>${zones}
      <div class="zline">${zCode('D')}<span>${names(b.D)}</span></div>
      ${pauses.length ? `<p class="muted small">${pauses.join(' · ')}</p>` : ''}</div>`;
  }).join('') + '</div>';
}
// Équipe du jour : modifiable avant d'enregistrer (zTeamDirty) ; sinon recopiée de ce que le serveur utilise.
const Z_SHIFTS = [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['11-19', '11-19'], ['FOOT', 'Horaire foot']];
let zTeam = [], zTeamDirty = false;
function syncZTeam() {
  if (zTeamDirty || !zData) return;
  zTeam = zData.people.map(p => ({ id: p.id, name: p.name, shift: p.raw }));
}
function renderZTeam() {
  const z = zData;
  $('#zTeamSrc').textContent = !z ? '' : z.custom ? 'Enregistrée' : z.people.length ? 'Horaire du jour' : 'À faire';
  $('#zTeamSrc').className = 'chip ' + (z && z.custom ? 'z-D' : 'empty');
  $('#zTeamCount').textContent = zTeam.length ? `· ${zTeam.length} personne${zTeam.length > 1 ? 's' : ''}` : '';
  // Repliée par défaut ; ouverte s'il n'y a personne ou si une modification n'est pas enregistrée.
  if (zTeamDirty || (z && !z.people.length)) $('#zTeamCard').open = true;
  $('#zTeamUse').hidden = !(z && z.custom);
  $('#zTeamSave').classList.toggle('pulse', zTeamDirty);
  const emps = data.config.employees.filter(e => !e.end || e.end >= zDate);
  const studs = Array.from({ length: 6 }, (_, k) => `student-${k + 1}`);
  const taken = zTeam.map(t => t.id);
  if (!zTeam.length) { $('#zTeamRows').innerHTML = '<p class="muted empty-rows">Personne pour le moment. Clique sur « + Ajouter une personne ».</p>'; return; }
  $('#zTeamRows').innerHTML = zTeam.map((t, i) => {
    // id '' : pas encore choisi ; 'x-…' : renfort avec un nom libre.
    const other = t.id.startsWith('x-');
    const opt = (v, l) => `<option value="${v}" ${t.id === v ? 'selected' : ''} ${t.id !== v && taken.includes(v) ? 'disabled' : ''}>${esc(l)}</option>`;
    const shifts = Z_SHIFTS.some(s => s[0] === t.shift) ? Z_SHIFTS : [...Z_SHIFTS, [t.shift, t.shift]];
    return `<div class="row">
      <label>Personne <select data-i="${i}" data-k="who">${t.id ? '' : '<option value="" selected disabled>— Choisir —</option>'}
        <optgroup label="Employés">${emps.map(e => opt(e.id, e.name)).join('')}</optgroup>
        <optgroup label="Chef terrain">${opt(data.config.chef.id, data.config.chef.name)}</optgroup>
        <optgroup label="Étudiants">${studs.map(s => opt(s, 'Student ' + s.slice(8))).join('')}</optgroup>
        <option value="__other" ${other ? 'selected' : ''}>Autre (renfort)…</option></select></label>
      ${other ? `<label>Nom <input data-i="${i}" data-k="name" value="${esc(t.name || '')}" placeholder="Nom et prénom" maxlength="40"></label>` : ''}
      <label>Horaire <select data-i="${i}" data-k="shift">${shifts.map(([v, l]) => `<option value="${v}" ${v === t.shift ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button data-rm="${i}" class="ghost" title="Retirer de l'équipe du jour">✕</button>
    </div>`;
  }).join('');
}
$('#zTeamRows').addEventListener('change', e => {
  const { i, k } = e.target.dataset; if (i === undefined) return;
  const t = zTeam[i];
  if (k === 'who') {
    if (e.target.value === '__other') { t.id = 'x-'; t.name = ''; }
    else {
      t.id = e.target.value; delete t.name;
      // Chef terrain : son horaire habituel par défaut.
      if (t.id === data.config.chef.id && Z_SHIFTS.some(s => s[0] === data.config.chef.shift)) t.shift = data.config.chef.shift;
    }
  } else t[k] = e.target.value;
  zTeamDirty = true; renderZTeam();
  if (k === 'who' && t.id === 'x-') document.querySelector(`#zTeamRows input[data-i="${i}"]`)?.focus();
});
$('#zTeamRows').addEventListener('input', e => { if (e.target.dataset.k === 'name') { zTeam[e.target.dataset.i].name = e.target.value; zTeamDirty = true; } });
$('#zTeamRows').addEventListener('click', e => {
  const b = e.target.closest('button[data-rm]'); if (!b) return;
  zTeam.splice(Number(b.dataset.rm), 1); zTeamDirty = true; renderZTeam();
});
$('#zTeamAdd').onclick = () => { zTeam.push({ id: '', shift: '12-20' }); zTeamDirty = true; renderZTeam(); };
$('#zTeamSave').onclick = async () => {
  if (zTeam.some(t => !t.id)) return toast('Choisis la personne sur chaque ligne');
  if (zTeam.some(t => t.id.startsWith('x-') && !(t.name || '').trim())) return toast('Indique le nom de chaque renfort');
  const team = zTeam.map(t => t.id.startsWith('x-') ? { id: t.id === 'x-' ? '' : t.id, name: t.name.trim(), shift: t.shift } : { id: t.id, shift: t.shift });
  const j = await api('/api/zones/team', { date: zDate, team });
  zTeamDirty = false; zData = j.zones; syncZTeam(); renderZones(); toast('Équipe du jour enregistrée');
};
$('#zTeamUse').onclick = async () => {
  if (!confirm("Effacer l'équipe enregistrée et reprendre l'horaire du jour de l'outil ?")) return;
  const j = await api('/api/zones/team', { date: zDate, team: null });
  zTeamDirty = false; zData = j.zones; syncZTeam(); renderZones(); toast("Horaire du jour repris");
};
// Reprend les personnes et les horaires de la veille (à enregistrer ensuite, après d'éventuels changements).
$('#zTeamCopy').onclick = async () => {
  const prev = addDay(zDate, -1);
  const j = await call('/api/zones', null, { month: prev.slice(0, 7), date: prev });
  if (j.error) return toast(j.error);
  if (!j.zones.people.length) return toast("Personne au travail la veille");
  if (zTeam.length && !confirm("Remplacer l'équipe actuelle par celle de la veille ?")) return;
  zTeam = j.zones.people.map(p => ({ id: p.id, name: p.name, shift: p.raw }));
  zTeamDirty = true; renderZTeam(); toast("Équipe de la veille copiée : vérifie puis enregistre");
};

async function zonesCell(body) {
  const j = await api('/api/zones/cell', { date: zDate, ...body });
  zData = j.zones; renderZones();
}
function zGo(date) {
  if (!date) return;
  if (zTeamDirty && !confirm("L'équipe du jour n'est pas enregistrée. Changer de jour quand même ?")) return renderZones();
  zTeamDirty = false; zTeam = []; zDate = date; zData = null; renderZones(); loadZones();
}
$('#zonesOpen').onclick = () => { go('zones'); if (zDate === localDay()) zTab = 'now'; renderZones(); loadZones(); };
$('#zPrev').onclick = () => zGo(addDay(zDate, -1));
$('#zNext').onclick = () => zGo(addDay(zDate, 1));
$('#zToday').onclick = () => { zTab = 'now'; zGo(localDay()); };
$('#zDate').onchange = e => zGo(e.target.value);
$('#zvPeople').onclick = () => { zView = 'people'; try { localStorage.setItem('zView', zView); } catch {} renderZones(); };
$('#zvZones').onclick = () => { zView = 'zones'; try { localStorage.setItem('zView', zView); } catch {} renderZones(); };
$('#zExport').onclick = () => downloadXlsx('/api/export-zones.xlsx', { month: zDate.slice(0, 7), date: zDate });
$('#zReset').onclick = async () => {
  if (!confirm('Enlever tous les changements faits à la main ce jour-là et tout recalculer ?')) return;
  const j = await api('/api/zones/reset', { date: zDate });
  zData = j.zones; renderZones(); toast('Zones remises en automatique');
};
// Clic sur une case : petit menu pour choisir la zone (ou revenir en automatique).
$('#zBox').addEventListener('click', e => {
  const td = e.target.closest('.zcell[data-person], .zp[data-person]');
  if (!td || document.body.classList.contains('readonly')) return;
  document.querySelector('.zmenu')?.remove();
  const m = document.createElement('div');
  m.className = 'zmenu';
  m.innerHTML = ['Z1', 'Z2', 'Z3', 'D', 'T'].map(z => `<button data-z="${z}"><i class="z-${z}"></i>${Z_LABEL[z]} <small>${Z_PLACE[z]}</small></button>`).join('')
    + '<button data-z="">↺ Automatique</button>';
  const r = td.getBoundingClientRect();
  m.style.left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 230) + 'px';
  m.style.top = (r.bottom + window.scrollY + 4) + 'px';
  document.body.appendChild(m);
  m.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    m.remove();
    zonesCell({ personId: td.dataset.person, slot: Number(td.dataset.slot), code: b.dataset.z || null });
  };
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
});

// Glisser-déposer dans les zones (appui long), dans le même créneau :
// sur un collègue = les deux échangent leur place ; sur une zone (vue « Par zone ») = la personne y va.
longPressDrag({
  root: $('#zBox'),
  source: el => el.closest('.zcell[data-person], .zp[data-person]'),
  targets: src => [...document.querySelectorAll(`#zBox [data-person][data-slot="${src.dataset.slot}"], #zBox td.zlist[data-zone][data-slot="${src.dataset.slot}"]`)]
    .filter(x => x.dataset.person !== src.dataset.person && !(x.dataset.zone && x.contains(src))),
  drop: async (src, over) => {
    const body = { date: zDate, slot: Number(src.dataset.slot), a: src.dataset.person };
    if (over.dataset.person) body.b = over.dataset.person; else body.zone = over.dataset.zone;
    const j = await api('/api/zones/swap', body).catch(() => null);
    if (j) { zData = j.zones; renderZones(); toast(body.b ? 'Places échangées.' : 'Personne déplacée.'); }
  },
});

// ----- Zones : onglet « Maintenant » (le créneau en cours, sur le terrain) -----
// Heure du téléphone / du PC (en Belgique) : créneau en cours, rotation, pauses, zones vides.
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const isAdmin = () => data && data.account && data.account.role === 'admin';
const canRemark = id => isAdmin() && data.config.employees.some(e => e.id === id);
function setZTab(t) {
  zTab = t;
  for (const [k, pane] of [['now', '#zNowPane'], ['day', '#zDayPane'], ['team', '#zTeamPane']]) {
    $(pane).hidden = k !== t;
    document.querySelector(`.ztabs [data-ztab="${k}"]`).classList.toggle('on', k === t);
  }
}
document.querySelector('.ztabs').addEventListener('click', e => {
  const b = e.target.closest('[data-ztab]'); if (!b) return;
  setZTab(b.dataset.ztab); renderZones();
});

function renderNow() {
  const z = zData, box = $('#zNow');
  if (!z || z.date !== zDate) { box.innerHTML = '<p class="muted pad">Chargement…</p>'; return; }
  const today = zDate === localDay();
  const absents = (z.absent || []).map(a => `<span class="znow-chip">🚫 ${esc(a.name)} absent <button class="link" data-clear="${a.id}">annuler</button></span>`);
  const lates = z.people.filter(p => p.arrive).map(p => `<span class="znow-chip">⏰ ${esc(p.name)} arrive à ${p.arrive} <button class="link" data-clear="${p.id}">annuler</button></span>`);
  const tools = `<div class="znow-tools">
      <button class="primary" id="znEvent">⚠️ Imprévu (absent, retard)</button>
      ${isAdmin() ? '<button id="znRemark">✍️ Faire une remarque</button>' : ''}
      <button id="znMsg">💬 Message du jour</button>
    </div>${absents.length || lates.length ? `<div class="znow-events">${[...absents, ...lates].join('')}</div>` : ''}`;
  if (z.closed || !z.people.length) {
    box.innerHTML = `<div class="card"><p class="muted">${z.closed ? 'Westland fermé ce jour-là.' : "Personne dans l'équipe de ce jour."} Regarde l'onglet « Équipe » pour ajouter du monde.</p></div>` + (z.people.length || (z.absent || []).length ? tools : '');
    return;
  }
  // Créneau affiché : celui en cours aujourd'hui ; avant l'ouverture le premier ; un autre jour, le premier aussi.
  const m = nowMin(), slots = z.slots;
  let k = today ? slots.findIndex(s => m >= s.start * 60 && m < s.end * 60) : 0;
  const before = today && m < slots[0].start * 60, after = today && m >= slots[slots.length - 1].end * 60;
  if (k < 0) k = after ? slots.length - 1 : 0;
  const sl = slots[k], end = sl.end * 60;
  let head;
  if (!today) head = `<b>${esc($('#zTitle').textContent)}</b> · ce n'est pas aujourd'hui : voici le premier créneau (${sl.label}).`;
  else if (before) head = `Pas encore commencé · premier créneau <b>${sl.label}</b> dans <b>${fmtDelay(slots[0].start * 60 - m)}</b>`;
  else if (after) head = 'Journée terminée · dernier créneau affiché.';
  else head = `Créneau <b>${sl.label}</b> · ${k < slots.length - 1 ? 'rotation' : 'fermeture'} dans <b class="${end - m <= 10 ? 'soon' : ''}">${fmtDelay(end - m)}</b>`;

  const inSlot = code => z.people.filter(p => p.cells[k] && p.cells[k].code === code);
  const fieldCount = z.people.filter(p => p.cells[k] && p.cells[k].code && p.cells[k].code !== 'D').length;
  const onPause = p => today && !before && !after && p.pause && m >= toMin(p.pause.start) && m < toMin(p.pause.end);
  const person = p => {
    const pause = onPause(p);
    const role = z.plan && z.plan.roleOf[p.id];
    return `<button class="znow-person ${pause ? 'pause' : ''}" data-person="${p.id}">${esc(p.name)}${role ? ` <i class="znow-role">${esc(role)}</i>` : ''}${pause ? ` <small>☕ pause jusqu'à ${p.pause.end}</small>` : ''}</button>`;
  };
  const card = (code, people) => {
    const there = people.filter(p => !onPause(p));
    // Zone vide parce qu'il n'y a pas assez de monde dans ce créneau : en orange ; sinon (absent, pause) : en rouge.
    const short = !people.length && code !== 'D' && fieldCount < 3;
    const state = short ? 'short' : !people.length ? 'empty' : !there.length ? 'pauseonly' : '';
    const warn = short ? '<p class="znow-warn">Pas assez de monde : zone pas couverte</p>' : !people.length ? '<p class="znow-warn">⚠️ Personne dans cette zone</p>' : !there.length ? '<p class="znow-warn">⚠️ Zone vide pendant la pause</p>' : '';
    return `<div class="znow-card z-${code} ${state}"><div class="znow-zone"><b>${Z_LABEL[code]}</b><small>${Z_PLACE[code]}</small></div>
      <div class="znow-people">${people.map(person).join('')}</div>${warn}</div>`;
  };
  const alone = inSlot('T');
  const cards = (alone.length ? [card('T', alone)] : ['Z1', 'Z2', 'Z3'].map(c => card(c, inSlot(c)))).concat(card('D', inSlot('D'))).join('');

  // Prochain créneau : qui change de place, qui arrive, qui part.
  let next = '';
  if (k < slots.length - 1) {
    const n = k + 1, place = c => c ? (c.code === 'D' ? 'Dispatch' : c.code === 'T' ? 'Toutes zones' : Z_LABEL[c.code]) : null;
    const rows = z.people.map(p => {
      const a = place(p.cells[k]), b = place(p.cells[n]);
      if (!a && !b) return '';
      if (a && !b) return `<li><b>${esc(p.name)}</b> : termine</li>`;
      if (!a && b) return `<li><b>${esc(p.name)}</b> : arrive → <b>${b}</b></li>`;
      return a === b ? `<li class="muted">${esc(p.name)} : reste ${a}</li>` : `<li><b>${esc(p.name)}</b> : ${a} → <b>${b}</b></li>`;
    }).filter(Boolean);
    next = `<div class="card znow-next"><h3>À ${slots[n].start}h (${slots[n].label})</h3><ul>${rows.join('')}</ul></div>`;
  }
  // Pauses : en cours, puis les suivantes de la journée.
  const pauses = z.people.filter(p => p.pause).sort((a, b) => a.pause.start.localeCompare(b.pause.start));
  const pNow = pauses.filter(onPause), pNext = pauses.filter(p => !today || toMin(p.pause.start) > m);
  const pauseCard = `<div class="card znow-pauses"><h3>☕ Pauses</h3>
    ${pNow.length ? `<p><b>En pause :</b> ${pNow.map(p => `${esc(p.name)} jusqu'à ${p.pause.end}`).join(', ')}</p>` : ''}
    ${pNext.length ? `<p><b>${today ? 'Ensuite' : 'Pauses du jour'} :</b> ${pNext.map(p => `${p.pause.start} ${esc(p.name)}`).join(' · ')}</p>` : (pNow.length ? '' : '<p class="muted">Plus de pause aujourd\'hui.</p>')}
  </div>`;
  const sheetInfo = z.plan ? `<p class="znow-plan">📋 Feuille <b>« ${esc(z.plan.title)} »</b> de l'horaire fixe</p>` : '<p class="znow-plan muted">Pas de feuille de l\'horaire fixe pour cette équipe : tournantes calculées pour le jour.</p>';
  box.innerHTML = `<div class="znow-head">${head}</div>${sheetInfo}${tools}<div class="znow-grid ${alone.length ? 'alone' : ''}">${cards}</div>
    <div class="znow-side">${next}${pauseCard}</div>
    ${isAdmin() ? '<p class="muted small">Touche un nom pour faire une remarque.</p>' : ''}`;
}
const fmtDelay = n => n >= 60 ? `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, '0')}` : `${n} min`;
// Mise à jour de l'heure toutes les 20 secondes quand l'onglet « Maintenant » est ouvert.
setInterval(() => { if (document.body.dataset.page === 'zones' && zTab === 'now' && zData && !$('#zSheet').open) renderNow(); }, 20000);

$('#zNow').addEventListener('click', e => {
  const c = e.target.closest('[data-clear]');
  if (c) return clearEvent(c.dataset.clear);
  if (e.target.closest('#znEvent')) return openEventSheet();
  if (e.target.closest('#znRemark')) return openRemarkSheet(null);
  if (e.target.closest('#znMsg')) return shareDayMessage();
  const p = e.target.closest('.znow-person');
  if (p) openRemarkSheet(p.dataset.person);
});
async function clearEvent(id) {
  const name = (zData.absent || []).concat(zData.people).find(p => p.id === id)?.name || id;
  if (!confirm(`Annuler l'imprévu de ${name} ? Les créneaux pas encore passés seront recalculés.`)) return;
  const j = await api('/api/zones/event', { date: zDate, personId: id, kind: 'clear' }).catch(() => null);
  if (j) { zData = j.zones; zCounts = j.fieldCounts; renderZones(); toast('Imprévu annulé'); }
}

// ----- Message du jour : qui suit quelle ligne de la feuille (ou la journée de chacun), à envoyer au groupe -----
function dayMessage() {
  const z = zData, d = new Date(zDate + 'T12:00:00');
  const place = c => c.code === 'D' ? 'Dispatch' : c.code === 'T' ? 'Toutes zones' : Z_LABEL[c.code];
  const lines = [`📍 Zones & dispatch · ${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()}`];
  if (z.plan) {
    lines.push(`Feuille : « ${z.plan.title} » (horaire fixe)`, '');
    const order = Object.entries(z.plan.roleOf).sort((a, b) => a[1].localeCompare(b[1], 'fr', { numeric: true }));
    for (const [id, role] of order) {
      const p = z.people.find(x => x.id === id);
      if (p) lines.push(`• ${role} : ${p.name}${p.arrive ? ` (arrive à ${p.arrive})` : ''}`);
    }
  } else {
    lines.push('');
    for (const p of z.people) {
      const route = p.cells.map((c, s) => c && c.code ? `${z.slots[s].start}h ${place(c)}` : null).filter(Boolean).join(' · ');
      if (route) lines.push(`• ${p.name} (${p.shift}) : ${route}`);
    }
  }
  const pauses = z.people.filter(p => p.pause).sort((a, b) => a.pause.start.localeCompare(b.pause.start));
  if (pauses.length) lines.push('', '☕ Pauses : ' + pauses.map(p => `${p.pause.start} ${p.name}`).join(' · '));
  if ((z.absent || []).length) lines.push('', '🚫 Absent : ' + z.absent.map(p => p.name).join(', '));
  // Changements par rapport à la feuille (cases changées à la main, retards) : à suivre en priorité.
  const changed = z.plan ? z.people.filter(p => p.cells.some(c => c && c.manual)) : [];
  if (changed.length) lines.push('', '⚠️ Changé aujourd\'hui : ' + changed.map(p => p.name + ' (' + p.cells.map((c, s) => c && c.manual ? `${z.slots[s].start}h ${place(c)}` : null).filter(Boolean).join(', ') + ')').join(' · '));
  return lines.join('\n');
}
async function shareDayMessage() {
  if (!zData || !zData.people.length) return toast("Pas d'équipe ce jour-là");
  const text = dayMessage();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Message copié : colle-le dans le groupe WhatsApp'); }
  catch { prompt('Copie ce message :', text); }
}

// ----- Remarque terrain : motif en 2 touches, texte libre (ou dicté), « dit oralement », récidive -----
const sheet = $('#zSheet');
let remark = null; // { personId, motif, colleague, text, told, time, slot }
function currentSlot() {
  if (zDate !== localDay()) return null;
  const m = nowMin(), k = zData.slots.findIndex(s => m >= s.start * 60 && m < s.end * 60);
  return k < 0 ? null : k;
}
function openRemarkSheet(personId, motif = null, time = null) {
  if (!isAdmin()) return toast('Les remarques sont réservées aux administrateurs.');
  if (personId && !canRemark(personId)) return toast('Remarque possible seulement pour un employé (pas un étudiant ni un renfort).');
  remark = { personId, motif, colleague: '', text: '', told: false, time: time || hhmm(nowMin()), slot: currentSlot() };
  renderRemark(); sheet.showModal();
}
function renderRemark() {
  const r = remark, z = zData;
  const emps = z.people.filter(p => canRemark(p.id));
  const p = z.people.find(x => x.id === r.personId);
  const cnt = r.personId && zCounts ? zCounts[r.personId] : null;
  const cell = p && r.slot !== null ? p.cells[r.slot] : null;
  const motifs = [['zone', 'Pas à sa place / mauvaise zone'], ['talk', "Dans la zone d'un collègue à discuter (pas visible des clients)"], ['late', 'Retard']];
  const others = z.people.filter(x => x.id !== r.personId && (r.slot === null || x.cells[r.slot]));
  $('#zSheetBody').innerHTML = `
    <div class="dlg-head"><h3>✍️ Remarque terrain</h3><button class="ghost" data-close>✕</button></div>
    <label class="zs-field">Personne <select data-r="personId"><option value="">— Choisir —</option>${emps.map(e => `<option value="${e.id}" ${e.id === r.personId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
    ${p ? `<p class="muted small">${cell && cell.code ? `Prévu maintenant : <b>${cell.code === 'D' ? 'Dispatch' : Z_LABEL[cell.code]}</b> (${z.slots[r.slot].label})` : 'Pas dans un créneau en ce moment.'}</p>` : ''}
    ${cnt && (cnt.week || cnt.month) ? `<p class="zs-recid">🔁 Déjà <b>${cnt.week}</b> fois cette semaine, <b>${cnt.month}</b> fois ce mois-ci</p>` : ''}
    <div class="zs-motifs">${motifs.map(([v, l]) => `<button type="button" data-motif="${v}" class="${r.motif === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${r.motif === 'talk' ? `<label class="zs-field">Avec qui ? <select data-r="colleague"><option value="">— Un collègue —</option>${others.map(o => `<option value="${o.id}" ${o.id === r.colleague ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      <p class="muted small">La remarque ne concerne que la personne qui a quitté sa zone.</p>` : ''}
    ${r.motif === 'late' ? `<label class="zs-field">Arrivé à <input type="time" data-r="time" value="${r.time}"></label>` : ''}
    <label class="zs-field">Détail (facultatif) <textarea data-r="text" rows="3" placeholder="Ce que tu as vu…">${esc(r.text)}</textarea></label>
    <div class="row"><button type="button" class="mic" id="zsMic">${zDict ? '■ Arrêter' : '🎤 Dicter'}</button>
      <label class="check"><input type="checkbox" data-r="told" ${r.told ? 'checked' : ''}> Dit oralement à la personne</label></div>
    <div class="row zs-actions"><button class="primary" id="zsSave" ${r.personId && r.motif ? '' : 'disabled'}>Enregistrer la remarque</button><button class="ghost" data-close>Annuler</button></div>
    <p class="muted small">Elle va dans la RH de la personne et dans le Reporting du jour. Seuls les administrateurs la voient.</p>`;
}
// Dictée pour le détail de la remarque.
let zDict = null;
function zDictate() {
  if (zDict) { try { zDict.stop(); } catch {} return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Dictée pas disponible ici : utilise le micro 🎤 du clavier du téléphone.');
  const rec = new SR(); rec.lang = 'fr-BE'; rec.continuous = true; rec.interimResults = true;
  const before = remark.text.trim(); let done = '';
  rec.onresult = e2 => {
    let live = '';
    for (let i = e2.resultIndex; i < e2.results.length; i++) { if (e2.results[i].isFinal) done += e2.results[i][0].transcript + ' '; else live += e2.results[i][0].transcript; }
    remark.text = [before, (done + live).replace(/\s+/g, ' ').trim()].filter(Boolean).join(' ');
    const ta = document.querySelector('#zSheetBody textarea[data-r="text"]'); if (ta) ta.value = remark.text;
  };
  rec.onerror = e2 => { if (e2.error === 'not-allowed') toast('Autorise le micro pour dicter, ou utilise le micro 🎤 du clavier.'); };
  rec.onend = () => { zDict = null; const b = $('#zsMic'); if (b) b.textContent = '🎤 Dicter'; };
  zDict = rec;
  try { rec.start(); $('#zsMic').textContent = '■ Arrêter'; } catch { zDict = null; }
}
sheet.addEventListener('close', () => { if (zDict) try { zDict.stop(); } catch {} remark = null; zEv = null; });
$('#zSheetBody').addEventListener('input', e => {
  const k = e.target.dataset.r;
  if (remark && k === 'text') remark.text = e.target.value;
  if (zEv && e.target.dataset.e === 'time') zEv.time = e.target.value;
});
$('#zSheetBody').addEventListener('change', e => {
  const k = e.target.dataset.r;
  if (remark && k) {
    remark[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'personId') renderRemark();
  }
  const ke = e.target.dataset.e;
  if (zEv && ke) { zEv[ke] = e.target.value; zEv.preview = null; renderEvent(); }
});
$('#zSheetBody').addEventListener('click', async e => {
  if (e.target.closest('[data-close]')) return sheet.close();
  if (remark) {
    const mo = e.target.closest('[data-motif]');
    if (mo) { remark.motif = mo.dataset.motif; return renderRemark(); }
    if (e.target.closest('#zsMic')) return zDictate();
    if (e.target.closest('#zsSave')) {
      const r = remark;
      if (r.motif === 'talk' && !r.colleague && !confirm('Aucun collègue choisi. Enregistrer quand même ?')) return;
      const j = await api('/api/hr/field', { date: zDate, personId: r.personId, motif: r.motif, colleague: r.colleague, text: r.text, told: r.told, time: r.time, slot: r.slot }).catch(() => null);
      if (j) { zData = j.zones; zCounts = j.fieldCounts; sheet.close(); renderZones(); toast('Remarque enregistrée (RH et Reporting du jour)'); }
    }
    return;
  }
  if (zEv) {
    const k = e.target.closest('[data-kind]');
    if (k) { zEv.kind = k.dataset.kind; zEv.preview = null; return renderEvent(); }
    if (e.target.closest('#zeSee')) return previewEvent();
    if (e.target.closest('#zeApply')) return applyEvent();
  }
});

// ----- Imprévu : absent ou arrive en retard → avant / après, puis on valide -----
let zEv = null; // { personId, kind, time, preview }
function openEventSheet() {
  zEv = { personId: '', kind: 'absent', time: hhmm(nowMin()), preview: null };
  renderEvent(); sheet.showModal();
}
function eventDiff(before, after) {
  const today = zDate === localDay(), m = nowMin(), out = [];
  const place = c => c && c.code ? (c.code === 'D' ? 'Dispatch' : c.code === 'T' ? 'Toutes zones' : Z_LABEL[c.code]) : '—';
  before.slots.forEach((s, k) => {
    if (today && s.end * 60 <= m) return; // créneau déjà passé : il ne bouge pas
    const lines = [];
    for (const p of before.people) {
      const q = after.people.find(x => x.id === p.id);
      const a = place(p.cells[k]), b = place(q ? q.cells[k] : null);
      if (a !== b) lines.push(`${esc(p.name)} : ${a} → <b>${b}</b>`);
    }
    for (const q of after.people) if (!before.people.some(p => p.id === q.id) && q.cells[k]) lines.push(`${esc(q.name)} : — → <b>${place(q.cells[k])}</b>`);
    const empty = ['Z1', 'Z2', 'Z3'].filter(c => !after.people.some(q => q.cells[k] && (q.cells[k].code === c || q.cells[k].code === 'T')));
    if (lines.length || empty.length) out.push(`<li><b>${s.label}</b>${lines.length ? ' · ' + lines.join(' · ') : ''}${empty.length ? ` <span class="znow-warn-inline">⚠️ ${empty.map(c => Z_LABEL[c]).join(', ')} sans personne</span>` : ''}</li>`);
  });
  return out.length ? `<ul class="ze-diff">${out.join('')}</ul>` : '<p class="muted">Aucun changement dans les créneaux à venir.</p>';
}
function renderEvent() {
  const z = zData, e = zEv;
  const team = z.people.filter(p => !p.arrive);
  $('#zSheetBody').innerHTML = `
    <div class="dlg-head"><h3>⚠️ Imprévu</h3><button class="ghost" data-close>✕</button></div>
    <label class="zs-field">Qui ? <select data-e="personId"><option value="">— Choisir —</option>${team.map(p => `<option value="${p.id}" ${p.id === e.personId ? 'selected' : ''}>${esc(p.name)} (${esc(p.shift)})</option>`).join('')}</select></label>
    <div class="zs-motifs two"><button type="button" data-kind="absent" class="${e.kind === 'absent' ? 'on' : ''}">🚫 Absent / pas venu</button><button type="button" data-kind="late" class="${e.kind === 'late' ? 'on' : ''}">⏰ Arrive en retard</button></div>
    ${e.kind === 'late' ? `<label class="zs-field">Arrive (ou est arrivé) à <input type="time" data-e="time" value="${e.time}"></label>` : ''}
    ${e.preview ? `<h4>Ce qui change</h4>${e.preview}<p class="muted small">Les créneaux déjà passés ne bougent pas.</p>` : ''}
    <div class="row zs-actions">${e.preview
      ? '<button class="primary" id="zeApply">Valider le changement</button>'
      : `<button class="primary" id="zeSee" ${e.personId ? '' : 'disabled'}>Voir ce qui change</button>`}<button class="ghost" data-close>Annuler</button></div>`;
}
async function previewEvent() {
  const j = await call('/api/zones/event/preview', { month: zDate.slice(0, 7), date: zDate, personId: zEv.personId, kind: zEv.kind, time: zEv.time });
  if (j.error) return toast(j.error);
  zEv.preview = eventDiff(j.before, j.after); renderEvent();
}
async function applyEvent() {
  const e = zEv;
  const j = await api('/api/zones/event', { date: zDate, personId: e.personId, kind: e.kind, time: e.time }).catch(() => null);
  if (!j) return;
  zData = j.zones; zCounts = j.fieldCounts; sheet.close(); renderZones();
  toast(e.kind === 'absent' ? 'Absent enregistré : tournantes mises à jour' : 'Retard enregistré : tournantes mises à jour');
  // Retard d'un employé : proposer la remarque « Retard » (avec l'heure d'arrivée).
  if (e.kind === 'late' && canRemark(e.personId) && confirm('Faire aussi une remarque « Retard » (RH et Reporting) ?')) openRemarkSheet(e.personId, 'late', e.time);
}

// ----- Horaire fixe : un tableau par type de journée, par horaire (8-16, 10-18, 12-20 A…), à imprimer -----
let fxType = 'jour4', fxData = null;
try { fxType = localStorage.getItem('fxType') || fxType; } catch {}
async function loadFixed() {
  const j = await call('/api/fixed', null, { month });
  if (j.error) return toast(j.error);
  fxData = j.fixed; renderFixed();
}
function renderFixed() {
  if (!fxData) { $('#fxBox').innerHTML = '<p class="muted pad">Chargement…</p>'; return; }
  const z = fxData.find(p => p.id === fxType) || fxData[0];
  fxType = z.id;
  $('#fxTypes').innerHTML = fxData.map(p => `<button role="tab" data-fx="${p.id}" class="${p.id === z.id ? 'on' : ''}">${p.custom ? '✏️ ' : ''}${esc(p.title.split(' (')[0])}</button>`).join('');
  $('#fxCustomBar').hidden = !z.custom || !!fxForm;
  renderFxForm();
  $('#fxLegend').innerHTML = ['Z1', 'Z2', 'Z3', 'D', 'T'].map(c => `<span><i class="z-${c}"></i>${Z_LABEL[c]} · ${Z_PLACE[c]}</span>`).join('') + '<span>☕ Pause 30 min</span><span>🔒 Changé à la main</span>';
  $('#fxNote').textContent = z.roles.some(r => / [A-C]$/.test(r)) ? "Même horaire à plusieurs (A, B, C) : ils se mettent d'accord en arrivant sur qui prend quelle ligne." : '';
  let h = `<h3 class="fx-title">${esc(z.title)}</h3><table class="ztable"><tr><th class="name">Horaire</th>${z.slots.map(s => `<th>${s.label}</th>`).join('')}<th>Pause</th></tr>`;
  z.people.forEach((p, k) => {
    h += `<tr><td class="name"><b>${esc(p.name)}</b></td>`;
    p.cells.forEach((c, s) => {
      const pause = p.pause && p.pause.slot === s ? `<small class="z-pause">☕ ${p.pause.start}</small>` : '';
      if (!c) { h += `<td class="zcell off">${pause}</td>`; return; }
      h += `<td class="zcell ${c.manual ? 'lock' : ''}" data-role="${k}" data-slot="${s}">`
        + (c.code ? `<span class="z-${c.code}"><b>${c.code === 'D' ? 'Dispatch' : c.code === 'T' ? 'Toutes zones' : c.code}</b><small>${Z_PLACE[c.code]}</small></span>` : '') + pause + '</td>';
    });
    h += `<td>${p.pause ? `${p.pause.start}-${p.pause.end}` : '<span class="muted">—</span>'}</td></tr>`;
  });
  $('#fxBox').innerHTML = h + '</table>';
}
async function fixedCell(body) {
  const j = await api('/api/fixed/cell', { plan: fxType, ...body });
  fxData = j.fixed; renderFixed();
}
$('#fixedOpen').onclick = () => { go('fixed'); renderFixed(); loadFixed(); };
$('#fxTypes').addEventListener('click', e => {
  const b = e.target.closest('[data-fx]'); if (!b) return;
  fxType = b.dataset.fx; try { localStorage.setItem('fxType', fxType); } catch {}
  renderFixed();
});
$('#fxReset').onclick = async () => {
  if (!confirm('Enlever les changements faits à la main sur ce tableau et tout recalculer ?')) return;
  const j = await api('/api/fixed/reset', { plan: fxType });
  fxData = j.fixed; renderFixed(); toast('Tableau remis en automatique');
};
$('#fxExport').onclick = () => downloadXlsx('/api/export-fixed.xlsx', {});

// Jour créé à la main : nom, nombre de personnes par horaire (horaires connus, ou écrits à la main comme 9-17),
// dimanche d'ouverture, ligne du chef terrain.
const FX_SHIFTS = [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['11-19', '11-19'], ['FOOT', 'Horaire foot (16h-fermeture)']];
let fxForm = null; // { id, title, counts: {…}, extra: [{ shift, n }], sunday, chef }
function openFxForm(plan) {
  const counts = { ...((plan && plan.counts) || {}) };
  const known = FX_SHIFTS.map(s => s[0]);
  fxForm = {
    id: plan ? plan.id : null, title: plan ? plan.title : '', sunday: plan ? plan.sunday : false, chef: plan ? plan.chef : true,
    counts: Object.fromEntries(known.map(s => [s, counts[s] || 0])),
    extra: Object.keys(counts).filter(s => !known.includes(s)).map(s => ({ shift: s, n: counts[s] })),
  };
  renderFixed();
  $('#fxForm').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function renderFxForm() {
  const f = fxForm, box = $('#fxForm');
  box.hidden = !f;
  if (!f) return;
  const num = (k, v, i) => `<input type="number" min="0" max="8" value="${v}" data-fx-n="${k}" ${i !== undefined ? `data-i="${i}"` : ''}>`;
  const total = Object.values(f.counts).reduce((a, x) => a + Number(x || 0), 0) + f.extra.reduce((a, x) => a + Number(x.n || 0), 0);
  box.innerHTML = `<div class="card-head"><h3>${f.id ? 'Modifier le jour' : 'Créer un jour'}</h3><span class="chip">${total} personne${total > 1 ? 's' : ''}</span></div>
    <label class="zs-field">Nom du jour <input data-fx-k="title" value="${esc(f.title)}" placeholder="ex. Samedi chargé" maxlength="50"></label>
    <div class="fx-counts">${FX_SHIFTS.map(([s, l]) => `<label><span>${l}</span>${num(s, f.counts[s])}</label>`).join('')}
      ${f.extra.map((x, i) => `<label class="fx-extra"><input data-fx-x="${i}" value="${esc(x.shift)}" placeholder="ex. 9-17" maxlength="5">${num('x', x.n, i)}<button class="ghost" data-fx-rm="${i}" title="Retirer">✕</button></label>`).join('')}
    </div>
    <button class="ghost" id="fxAddShift">+ Autre horaire (écrit à la main)</button>
    <div class="row">
      <label class="check"><input type="checkbox" data-fx-k="sunday" ${f.sunday ? 'checked' : ''}> Dimanche d'ouverture (11h-19h)</label>
      <label class="check"><input type="checkbox" data-fx-k="chef" ${f.chef && !f.sunday ? 'checked' : ''} ${f.sunday ? 'disabled' : ''}> Ligne chef terrain (un bloc de dispatch)</label>
    </div>
    ${f.id ? '<p class="muted small">Si tu changes les horaires, les cases changées à la main sur ce tableau repartent en automatique.</p>' : ''}
    <div class="row"><button class="primary" id="fxSave">Enregistrer</button><button class="ghost" id="fxCancel">Annuler</button></div>
    <p class="muted small">Un vrai jour qui a exactement cette équipe suivra ce tableau dans « Zones & dispatch ».</p>`;
}
$('#fxNew').onclick = () => openFxForm(null);
$('#fxEdit').onclick = () => openFxForm(fxData.find(p => p.id === fxType));
$('#fxDelete').onclick = async () => {
  const p = fxData.find(x => x.id === fxType);
  if (!p || !confirm(`Supprimer le jour « ${p.title} » ? (« Annuler » en haut permet de revenir en arrière)`)) return;
  const j = await api('/api/fixed/custom/delete', { id: p.id });
  fxData = j.fixed; fxType = 'jour4'; renderFixed(); toast('Jour supprimé');
};
$('#fxForm').addEventListener('input', e => {
  const f = fxForm; if (!f) return;
  const t = e.target;
  if (t.dataset.fxK === 'title') f.title = t.value;
  if (t.dataset.fxN) { const v = Math.max(0, Math.min(8, Number(t.value) || 0)); if (t.dataset.fxN === 'x') f.extra[t.dataset.i].n = v; else f.counts[t.dataset.fxN] = v; }
  if (t.dataset.fxX !== undefined) f.extra[t.dataset.fxX].shift = t.value.trim();
});
$('#fxForm').addEventListener('change', e => {
  const f = fxForm; if (!f) return;
  const k = e.target.dataset.fxK;
  if (k === 'sunday' || k === 'chef') { f[k] = e.target.checked; renderFxForm(); }
  if (e.target.dataset.fxN) renderFxForm();
});
$('#fxForm').addEventListener('click', async e => {
  const f = fxForm; if (!f) return;
  if (e.target.closest('#fxAddShift')) { f.extra.push({ shift: '', n: 1 }); renderFxForm(); return document.querySelector(`#fxForm [data-fx-x="${f.extra.length - 1}"]`)?.focus(); }
  const rm = e.target.closest('[data-fx-rm]');
  if (rm) { f.extra.splice(Number(rm.dataset.fxRm), 1); return renderFxForm(); }
  if (e.target.closest('#fxCancel')) { fxForm = null; return renderFixed(); }
  if (e.target.closest('#fxSave')) {
    const counts = { ...f.counts };
    for (const x of f.extra) if (x.shift && x.n) counts[x.shift] = (counts[x.shift] || 0) + Number(x.n);
    const j = await api('/api/fixed/custom', { id: f.id, title: f.title, counts, sunday: f.sunday, chef: f.chef && !f.sunday }).catch(() => null);
    if (!j) return;
    fxForm = null; fxData = j.fixed; fxType = j.planId; try { localStorage.setItem('fxType', fxType); } catch {}
    renderFixed(); toast(f.id ? 'Jour modifié' : 'Jour créé');
  }
});
// Clic sur une case : choisir la zone (ou revenir en automatique).
$('#fxBox').addEventListener('click', e => {
  const td = e.target.closest('.zcell[data-role]');
  if (!td || document.body.classList.contains('readonly')) return;
  document.querySelector('.zmenu')?.remove();
  const m = document.createElement('div');
  m.className = 'zmenu';
  m.innerHTML = ['Z1', 'Z2', 'Z3', 'D', 'T'].map(c => `<button data-z="${c}"><i class="z-${c}"></i>${Z_LABEL[c]} <small>${Z_PLACE[c]}</small></button>`).join('')
    + '<button data-z="">↺ Automatique</button>';
  const r = td.getBoundingClientRect();
  m.style.left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 230) + 'px';
  m.style.top = (r.bottom + window.scrollY + 4) + 'px';
  document.body.appendChild(m);
  m.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    m.remove();
    fixedCell({ role: Number(td.dataset.role), slot: Number(td.dataset.slot), code: b.dataset.z || null });
  };
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
});
// Appui long puis lâcher sur un autre horaire du même créneau : les deux échangent leur place.
longPressDrag({
  root: $('#fxBox'),
  source: el => el.closest('.zcell[data-role]'),
  targets: src => [...document.querySelectorAll(`#fxBox .zcell[data-role][data-slot="${src.dataset.slot}"]`)].filter(x => x !== src),
  drop: (src, over) => fixedCell({ role: Number(src.dataset.role), slot: Number(src.dataset.slot), swap: Number(over.dataset.role) })
    .then(() => toast('Places échangées.')).catch(() => {}),
});

// ----- Reporting : événements du jour et rapport PDF de fin de journée -----
const LOG_ICONS = { accident: '🚗', client: '🗣️', panne: '🔧', objet: '🔑', securite: '🚓', proprete: '🧹', autre: '📝' };
let logDate = localDay(), logData = null, logForm = null; // logForm : événement en cours d'écriture (id = null si nouveau)
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const lbl = (list, id) => (list.find(x => x.id === id) || {}).label || id;

async function loadLog() {
  const j = await call('/api/log', null, { month: logDate.slice(0, 7), date: logDate });
  if (j.error) return toast(j.error);
  logData = j.log; renderLog();
}
async function logCall(path, body) {
  const j = await call(path, { month: logDate.slice(0, 7), date: logDate, ...body });
  if (j.error) { toast(j.error); throw new Error(j.error); }
  logData = j.log; renderLog(); return j;
}
function renderLog() {
  const d = new Date(logDate + 'T12:00:00');
  $('#lTitle').textContent = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  try { if (!$('#logChief').value) $('#logChief').value = localStorage.getItem('logChief') || (data && data.config.chef.name) || ''; } catch {}
  const L = logData;
  if (!L || L.date !== logDate) { $('#logList').innerHTML = '<p class="muted">Chargement…</p>'; return; }
  const ro = document.body.classList.contains('readonly');
  const edit = L.editable && !ro;
  $('#lState').textContent = L.editable ? "Aujourd'hui · modifiable" : 'Journée figée';
  $('#lState').className = 'chip ' + (L.editable ? 'z-Z2' : 'empty');
  $('#logNew').hidden = !edit;
  $('#logTypes').innerHTML = L.types.map(t => `<button data-type="${t.id}" class="${logForm && logForm.type === t.id ? 'on' : ''}"><span>${LOG_ICONS[t.id] || '📝'}</span>${esc(t.label)}</button>`).join('');
  renderLogForm();
  $('#logReformRow').hidden = document.body.classList.contains('readonly') || !L.entries.some(e => !e.textPro);
  $('#logCount').textContent = L.entries.length ? `${L.entries.length} événement${L.entries.length > 1 ? 's' : ''}` : '';
  $('#logList').innerHTML = L.entries.length ? L.entries.map(e => {
    const sev = L.severities.find(s => s.id === e.severity) || {};
    return `<div class="log-item sev-${e.severity}" data-id="${e.id}">
      <div class="log-head"><b class="log-time">${esc(e.time)}</b><b>${LOG_ICONS[e.type] || ''} ${esc(lbl(L.types, e.type))}</b>
        <span class="log-sev" style="background:#${sev.fill};color:#${sev.ink}">${esc(sev.label || '')}</span></div>
      <div class="muted small">${esc(lbl(L.places, e.place))}${e.plate ? ' · Plaque ' + esc(e.plate) : ''}</div>
      ${(() => {
        // Version reformulée (celle du rapport) ; « Mon texte » montre ce qui a été écrit ou dicté.
        const br = s => esc(s).replace(/\n/g, '<br>');
        const block = (t, a) => `<p>${br(t)}</p>${a ? `<p class="log-action"><b>Action prise :</b> ${br(a)}</p>` : ''}`;
        if (!e.textPro) return block(e.text, e.action);
        return `<div class="log-pro">${block(e.textPro, e.actionPro || e.action)}</div>
          <details class="log-orig"><summary>✨ Reformulé pour le rapport · voir mon texte</summary>${block(e.text, e.action)}</details>`;
      })()}
      ${e.followUp ? '<p class="log-follow">► Suivi nécessaire</p>' : ''}
      ${e.author || e.updatedBy ? `<p class="muted small log-by">${e.author ? 'Noté par ' + esc(e.author) : ''}${e.updatedBy && e.updatedBy !== e.author ? (e.author ? ' · ' : '') + 'modifié par ' + esc(e.updatedBy) : ''}</p>` : ''}
      ${edit ? `<div class="row"><button class="log-edit">Modifier</button> <button class="ghost danger log-del">Supprimer</button></div>` : ''}
    </div>`;
  }).join('') : `<p class="muted">${L.editable ? 'Aucun événement pour le moment. Choisis un type ci-dessus pour en noter un.' : 'Aucun événement ce jour-là.'}</p>`;
}
// Dictée : on parle, le texte s'écrit dans le champ (reconnaissance vocale du navigateur, en français).
let dict = null, dictK = null;
const micButton = k => `<button type="button" class="mic ${dictK === k ? 'on' : ''}" data-mic="${k}">${dictK === k ? '■ Arrêter' : '🎤 Dicter'}</button>`;
const refreshMics = () => document.querySelectorAll('#logForm .mic').forEach(b => { b.outerHTML = micButton(b.dataset.mic); });
function stopDictation() { if (dict) try { dict.stop(); } catch {} }
function startDictation(k) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast("Dictée pas disponible ici : utilise le micro 🎤 du clavier du téléphone.");
  stopDictation();
  const rec = new SR();
  rec.lang = 'fr-BE'; rec.continuous = true; rec.interimResults = true;
  const before = (logForm[k] || '').trim();
  let done = '';
  rec.onresult = ev => {
    let live = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) done += ev.results[i][0].transcript + ' '; else live += ev.results[i][0].transcript;
    }
    let said = (done + live).replace(/\s+/g, ' ').trim();
    if (said && !before) said = said[0].toUpperCase() + said.slice(1);
    const value = [before, said].filter(Boolean).join(' ');
    if (!logForm) return;
    logForm[k] = value;
    const ta = document.querySelector(`#logForm textarea[data-k="${k}"]`);
    if (ta) { ta.value = value; ta.scrollTop = ta.scrollHeight; }
  };
  rec.onerror = ev => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('Autorise le micro pour dicter (Réglages › Safari › Microphone), ou utilise le micro 🎤 du clavier.');
    else if (ev.error !== 'aborted' && ev.error !== 'no-speech') toast('Dictée interrompue (' + ev.error + ')');
  };
  rec.onend = () => { if (dict === rec) { dict = null; dictK = null; refreshMics(); } };
  dict = rec; dictK = k;
  try { rec.start(); } catch { dict = null; dictK = null; toast('Impossible de lancer la dictée'); }
  refreshMics();
}
function renderLogForm() {
  const L = logData, f = logForm;
  $('#logForm').hidden = !f;
  if (!f) { $('#logForm').innerHTML = ''; return; }
  const chips = (k, list, styled) => `<div class="log-chips">${list.map(x => `<button data-k="${k}" data-v="${x.id}" class="${f[k] === x.id ? 'on' : ''}"${styled && f[k] === x.id ? ` style="background:#${x.fill};color:#${x.ink};border-color:#${x.ink}"` : ''}>${esc(x.label)}</button>`).join('')}</div>`;
  $('#logForm').innerHTML = `
    <h4>${f.id ? 'Modifier' : 'Nouveau'} : ${LOG_ICONS[f.type] || ''} ${esc(lbl(L.types, f.type))}</h4>
    <div class="row"><label>Heure <input type="time" data-k="time" value="${esc(f.time)}"></label>
      <label>Plaque <input data-k="plate" value="${esc(f.plate)}" placeholder="1-ABC-234" maxlength="20" autocapitalize="characters"></label></div>
    <label class="block">Lieu</label>${chips('place', L.places)}
    <label class="block">Gravité</label>${chips('severity', L.severities, true)}
    <div class="log-field"><div class="log-field-head"><span>Ce qui s'est passé</span>${micButton('text')}</div>
      <textarea data-k="text" rows="3" maxlength="3000" placeholder="Écris ou touche « Dicter » et parle. Ex. accrochage entre deux voitures près de l'ascenseur, pas de blessé">${esc(f.text)}</textarea></div>
    <div class="log-field"><div class="log-field-head"><span>Action prise</span>${micButton('action')}</div>
      <textarea data-k="action" rows="2" maxlength="2000" placeholder="Ex. constat amiable, zone balisée, technicien appelé">${esc(f.action)}</textarea></div>
    <label class="check"><input type="checkbox" data-k="followUp" ${f.followUp ? 'checked' : ''}> Suivi nécessaire (à régler plus tard)</label>
    <div class="row"><button id="logSave" class="primary">Enregistrer</button> <button id="logCancel" class="ghost">Annuler</button></div>`;
}
$('#logTypes').addEventListener('click', e => {
  const b = e.target.closest('button[data-type]'); if (!b) return;
  if (logForm && !logForm.id) logForm.type = b.dataset.type;
  else logForm = { id: null, type: b.dataset.type, time: nowHM(), place: '', severity: 'faible', plate: '', text: '', action: '', followUp: false };
  renderLog();
  $('#logForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#logForm').addEventListener('input', e => {
  const k = e.target.dataset.k; if (!k || !logForm) return;
  logForm[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
});
$('#logForm').addEventListener('click', async e => {
  const mic = e.target.closest('button[data-mic]');
  if (mic) { if (dictK === mic.dataset.mic) stopDictation(); else startDictation(mic.dataset.mic); return; }
  const chip = e.target.closest('button[data-k]');
  if (chip) { logForm[chip.dataset.k] = chip.dataset.v; renderLogForm(); return; }
  if (e.target.id === 'logCancel') { stopDictation(); logForm = null; renderLog(); return; }
  if (e.target.id !== 'logSave') return;
  stopDictation();
  const f = logForm;
  if (!f.place) return toast('Choisis le lieu');
  if (!f.text.trim()) return toast("Décris ce qui s'est passé");
  e.target.disabled = true;
  try {
    e.target.textContent = 'Enregistrement…';
    const j = await logCall('/api/log/save', { id: f.id, entry: f });
    logForm = null; renderLog();
    toast(j.reformError ? `Événement enregistré (texte gardé tel quel : ${j.reformError})` : 'Événement enregistré');
  } catch { e.target.disabled = false; e.target.textContent = 'Enregistrer'; }
});
$('#logList').addEventListener('click', async e => {
  const item = e.target.closest('.log-item'); if (!item) return;
  const entry = logData.entries.find(x => x.id === item.dataset.id); if (!entry) return;
  if (e.target.closest('.log-edit')) {
    logForm = { ...entry };
    renderLog(); $('#logForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (e.target.closest('.log-del') && confirm(`Supprimer l'événement de ${entry.time} (${lbl(logData.types, entry.type)}) ?`)) {
    await logCall('/api/log/delete', { id: entry.id }); toast('Événement supprimé');
  }
});
function logGo(date) {
  if (!date) return;
  if (logForm && !confirm("L'événement en cours n'est pas enregistré. Changer de jour quand même ?")) return;
  logForm = null; logDate = date; logData = null; renderLog(); loadLog();
}
$('#logOpen').onclick = () => { go('log'); renderLog(); loadLog(); };
$('#lPrev').onclick = () => logGo(addDay(logDate, -1));
$('#lNext').onclick = () => logGo(addDay(logDate, 1));
$('#lToday').onclick = () => logGo(localDay());
$('#logChief').onchange = e => { try { localStorage.setItem('logChief', e.target.value.trim()); } catch {} };
// Rapport PDF : fabriqué dans la page (en ligne) ou par le serveur local.
async function logPdf() {
  const q = { month: logDate.slice(0, 7), date: logDate, chief: $('#logChief').value.trim() };
  if (backend) {
    const out = await backend.handle('GET', '/api/log-report.pdf', q, {});
    if (!out.pdf) throw new Error((out.json && out.json.error) || 'Rapport impossible');
    return new File([out.pdf], out.filename, { type: 'application/pdf' });
  }
  const r = await fetch('/api/log-report.pdf?' + new URLSearchParams(q));
  if (!r.ok) throw new Error('Rapport impossible');
  return new File([await r.arrayBuffer()], `reporting-${logDate}.pdf`, { type: 'application/pdf' });
}
function saveFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#logReform').onclick = async e => {
  const b = e.target; b.disabled = true; b.textContent = 'Reformulation en cours…';
  try {
    const j = await logCall('/api/log/reformulate', {});
    toast(j.reformError ? 'Reformulation impossible : ' + j.reformError : 'Événements reformulés');
  } catch {} finally { b.disabled = false; b.textContent = '✨ Reformuler les événements pas encore reformulés'; }
};
$('#logDownload').onclick = async () => { try { saveFile(await logPdf()); } catch (e) { toast(e.message); } };
$('#logShare').onclick = async () => {
  try {
    const file = await logPdf();
    const d = new Date(logDate + 'T12:00:00');
    const title = `Reporting du ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    // Menu « Partager » du téléphone (mail, WhatsApp, Teams…) ; sinon le PDF est téléchargé.
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title, text: `${title} — Interparking Westland` });
    else { saveFile(file); toast('Partage non disponible ici : le PDF est téléchargé.'); }
  } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
};

// ----- Chef terrain : nom, horaire, jours -----
const DOW_SHORT = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
function openChef() {
  const ch = data.config.chef;
  const days = ch.days || [2, 3, 4, 5, 6];
  $('#chefNameIn').value = ch.name;
  $('#chefNoteIn').value = ch.note || '';
  $('#chefShiftIn').value = ch.shift;
  $('#chefDaysIn').innerHTML = [1, 2, 3, 4, 5, 6].map(d => `<label class="check"><input type="checkbox" value="${d}" ${days.includes(d) ? 'checked' : ''}> ${DOW_SHORT[d]}</label>`).join('');
  $('#chefMonthlyIn').checked = ch.monthlyWeek !== false;
  $('#parkChiefIn').value = (data.config.parkChief && data.config.parkChief.name) || '';
  $('#chefDlg').showModal();
}
$('#chefSave').onclick = async () => {
  const days = [...document.querySelectorAll('#chefDaysIn input:checked')].map(i => Number(i.value));
  await api('/api/chef', { name: $('#chefNameIn').value, note: $('#chefNoteIn').value, shift: $('#chefShiftIn').value, days, monthlyWeek: $('#chefMonthlyIn').checked, parkChief: $('#parkChiefIn').value });
  $('#chefDlg').close(); toast('Chef terrain enregistré');
};

// ----- Une personne : ajouter / modifier / départ / supprimer -----
let empId = null;
function openEmp(id) {
  const c = data.config;
  const e = id && c.employees.find(x => x.id === id);
  empId = id;
  const label = g => c.rotation.groups[g].map(x => (c.employees.find(y => y.id === x) || {}).name).filter(Boolean).join(', ');
  $('#empGroup').innerHTML = c.rotation.groups.map((_, g) => `<option value="${g}">Groupe ${g + 1}${label(g) ? ' (' + esc(label(g)) + ')' : ''}</option>`).join('') + `<option value="${c.rotation.groups.length}">+ Nouveau groupe</option>`;
  $('#empGroup').value = e ? Math.max(0, c.rotation.groups.findIndex(g => g.includes(id))) : 0;
  $('#empTitle').textContent = e ? `Modifier ${e.name}` : 'Ajouter un employé';
  $('#empName').value = e ? e.name : '';
  $('#empNote').value = e ? (e.note || '') : '';
  $('#empStartRow').hidden = !!e;
  $('#empStart').value = today();
  $('#empLeaveBox').hidden = !e;
  $('#empEnd').value = e && e.end ? e.end : today();
  $('#empRejoin').hidden = !(e && e.end);
  $('#empDlg').showModal();
  $('#empName').focus();
}
async function empAction(body, msg) {
  await api('/api/employee', { ...body, id: empId, regenerate: $('#empRegen').checked });
  $('#empDlg').close(); toast(msg);
}
$('#empSave').onclick = () => {
  const name = $('#empName').value.trim();
  if (!name) return toast('Indique un nom');
  const body = { name, note: $('#empNote').value, group: $('#empGroup').value };
  if (empId) empAction({ action: 'update', ...body }, 'Modifications enregistrées');
  else empAction({ action: 'add', start: $('#empStart').value, ...body }, `${name} ajouté à l'équipe`);
};
$('#empLeave').onclick = () => {
  const end = $('#empEnd').value;
  if (!end) return toast('Indique le dernier jour de travail');
  if (confirm(`${$('#empName').value} ne sera plus dans le planning après le ${fmtDate(end)}. Continuer ?`))
    empAction({ action: 'leave', end }, 'Départ enregistré');
};
$('#empRejoin').onclick = () => empAction({ action: 'rejoin' }, 'Départ annulé');
$('#empDelete').onclick = () => {
  if (confirm(`Supprimer définitivement ${$('#empName').value} et tout son historique ? Cette action est irréversible.`))
    empAction({ action: 'delete' }, 'Employé supprimé');
};

// ----- Factures (administrateurs) : stockage des factures envoyées chaque mois, par site et par magasin -----
let invMonth = addMonth(localDay().slice(0, 7), -1), invData = null, invMemoOpen = null;
async function loadInvoices() {
  const j = await call('/api/invoices', null, { month: invMonth });
  if (j.error) { $('#invBox').innerHTML = `<p class="muted pad">${esc(j.error)}</p>`; return; }
  invData = j.invoices; renderInvoices();
}
const invIcon = f => f.type === 'application/pdf' ? '📄' : '🖼️';
const kb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;
function renderInvoices() {
  const [y, m] = invMonth.split('-').map(Number);
  $('#invTitle').textContent = `${MONTHS[m - 1]} ${y}`;
  const d = invData;
  if (!d || d.month !== invMonth) { $('#invBox').innerHTML = '<p class="muted pad">Chargement…</p>'; return; }
  $('#invBox').innerHTML = d.sites.map(site => {
    const done = site.stores.filter(st => (d.files[st.id] || []).length).length;
    return `<div class="card inv-site"><div class="card-head"><h3>${esc(site.name)}</h3><span class="chip">${done} / ${site.stores.length} magasins</span></div>
      ${site.stores.map(st => {
        const files = d.files[st.id] || [];
        const memo = d.memos[st.id] || '';
        const open = invMemoOpen === st.id;
        return `<div class="inv-store ${files.length ? 'done' : ''}">
          <div class="inv-head">
            <b>${esc(st.name)}</b>
            <span class="chip ${files.length ? 'z-D' : 'empty'}">${files.length ? `✓ ${files.length} fichier${files.length > 1 ? 's' : ''}` : 'À faire'}</span>
            <span class="inv-actions">
              <button class="ghost" data-memo="${st.id}">${open ? 'Fermer la fiche' : memo ? '📋 Fiche' : '📋 Ajouter une fiche'}</button>
              <label class="btn primary inv-add">+ Ajouter<input type="file" accept="image/*,application/pdf" multiple data-up="${st.id}" ${st.other ? 'data-other="1"' : ''} hidden></label>
            </span>
          </div>
          ${open ? `<div class="inv-memo"><textarea data-memo-text="${st.id}" rows="8" placeholder="Numéros SAP, règles de facturation, à qui envoyer…">${esc(memo)}</textarea>
            <div class="row"><button class="primary" data-memo-save="${st.id}">Enregistrer la fiche</button></div></div>`
            : memo ? `<p class="inv-memo-preview muted small">${esc(memo.split('\n').filter(Boolean).slice(0, 2).join(' · '))}${memo.split('\n').filter(Boolean).length > 2 ? '…' : ''}</p>` : ''}
          ${files.length ? `<ul class="inv-files">${files.map(f => `<li>
              <button class="link" data-open="${st.id}|${f.id}">${invIcon(f)} ${esc(f.label ? f.label + ' · ' : '')}${esc(f.name)}</button>
              <span class="muted small">${kb(f.size)} · ${new Date(f.at).toLocaleDateString('fr-BE')}${f.by ? ' · ' + esc(f.by) : ''}</span>
              <button class="ghost danger" data-del="${st.id}|${f.id}" title="Supprimer ce fichier">✕</button></li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('')}</div>`;
  }).join('');
}
// Appels des factures : ne redessinent pas le planning (réponse = les factures du mois seulement).
async function invApi(path, body) {
  const j = await call(path, body);
  if (j.needLogin) { showLogin(); throw new Error(j.error); }
  if (j.error) { toast(j.error); throw new Error(j.error); }
  return j;
}
// Lecture d'un fichier choisi : en base64 pour l'envoyer.
const readB64 = file => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => ko(new Error('Lecture du fichier impossible')); r.readAsDataURL(file); });
$('#invBox').addEventListener('change', async e => {
  const input = e.target.closest('input[data-up]'); if (!input || !input.files.length) return;
  const store = input.dataset.up, files = [...input.files];
  let label = '';
  if (input.dataset.other) { label = (prompt('Facture pour qui ? (ex. nom du client)') || '').trim(); if (!label) { input.value = ''; return; } }
  for (const [k, f] of files.entries()) {
    if (f.size > 10 * 1024 * 1024) { toast(`${f.name} : trop lourd (10 Mo maximum)`); continue; }
    toast(`Envoi ${files.length > 1 ? `${k + 1}/${files.length} ` : ''}: ${f.name}…`);
    try {
      const j = await invApi('/api/invoices/upload', { month: invMonth, store, name: f.name, type: f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : ''), data: await readB64(f), label });
      invData = j.invoices; renderInvoices();
    } catch { input.value = ''; return; }
  }
  input.value = '';
  toast(files.length > 1 ? 'Fichiers ajoutés' : 'Fichier ajouté');
});
$('#invBox').addEventListener('click', async e => {
  const memo = e.target.closest('[data-memo]');
  if (memo) { invMemoOpen = invMemoOpen === memo.dataset.memo ? null : memo.dataset.memo; renderInvoices(); return; }
  const save = e.target.closest('[data-memo-save]');
  if (save) {
    const id = save.dataset.memoSave, text = document.querySelector(`[data-memo-text="${id}"]`).value;
    const j = await invApi('/api/invoices/memo', { month: invMonth, store: id, text }).catch(() => null);
    if (j) { invData = j.invoices; invMemoOpen = null; renderInvoices(); toast('Fiche enregistrée'); }
    return;
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    const [store, id] = del.dataset.del.split('|');
    const f = (invData.files[store] || []).find(x => x.id === id);
    if (!confirm(`Supprimer définitivement « ${f ? f.name : 'ce fichier'} » ? Il ne pourra pas être récupéré.`)) return;
    const j = await invApi('/api/invoices/delete', { month: invMonth, store, id }).catch(() => null);
    if (j) { invData = j.invoices; renderInvoices(); toast('Fichier supprimé'); }
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) {
    const [store, id] = open.dataset.open.split('|');
    const q = { month: invMonth, store, id };
    if (!backend) { window.open('/api/invoices/file?' + new URLSearchParams(q), '_blank'); return; }
    const w = window.open('', '_blank'); // ouverte tout de suite (sinon le navigateur bloque la fenêtre)
    const out = await backend.handle('GET', '/api/invoices/file', q, {});
    if (!out.file) { if (w) w.close(); return toast((out.json && out.json.error) || 'Ouverture impossible'); }
    const url = URL.createObjectURL(new Blob([out.file], { type: out.type }));
    if (w) w.location.href = url; else saveFile(new File([out.file], out.filename, { type: out.type }));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
});
function invGo(m) { invMonth = m; invData = null; invMemoOpen = null; renderInvoices(); loadInvoices(); }
$('#invOpen').onclick = () => { go('invoices'); renderInvoices(); loadInvoices(); };
$('#invPrev').onclick = () => invGo(addMonth(invMonth, -1));
$('#invNext').onclick = () => invGo(addMonth(invMonth, 1));

// ----- Roulement foot et dimanches d'ouverture (tour de rôle fixe, compteurs de la saison) -----
function renderDuty() {
  const du = data.duty;
  if (!du) return;
  $('#dutySeason').textContent = `· saison ${du.season}`;
  const row = id => du.rows.find(r => r.id === id) || { name: id, foot: 0, sunday: 0, holiday: 0 };
  const ro = document.body.classList.contains('readonly');
  const table = (kind, head, cells) => `<tr><th>#</th><th>${head}</th>${cells.map(c => `<th>${c[0]}</th>`).join('')}${ro ? '' : '<th></th>'}</tr>`
    + du.order[kind].map((id, k) => `<tr class="${du.next[kind] === id ? 'next' : ''}"><td>${k + 1}</td><td>${esc(row(id).name)}${du.next[kind] === id ? ' <span class="badge foot">prochain</span>' : ''}</td>
      ${cells.map(c => `<td>${row(id)[c[1]]}</td>`).join('')}
      ${ro ? '' : `<td class="duty-move"><button class="ghost" data-duty="${kind}" data-i="${k}" data-d="-1" ${k ? '' : 'disabled'} title="Monter">↑</button><button class="ghost" data-duty="${kind}" data-i="${k}" data-d="1" ${k < du.order[kind].length - 1 ? '' : 'disabled'} title="Descendre">↓</button></td>`}</tr>`).join('');
  $('#dutyFoot').innerHTML = table('foot', 'Ordre foot ⚽', [['Matchs', 'foot']]);
  $('#dutySunday').innerHTML = table('sunday', 'Ordre dimanches', [['Dim. ouverture', 'sunday'], ['Fériés travaillés', 'holiday']]);
}
for (const id of ['#dutyFoot', '#dutySunday']) $(id).addEventListener('click', e => {
  const b = e.target.closest('button[data-duty]'); if (!b) return;
  const kind = b.dataset.duty, i = Number(b.dataset.i), j = i + Number(b.dataset.d);
  const order = data.duty.order[kind].slice();
  [order[i], order[j]] = [order[j], order[i]];
  api('/api/config', { dutyOrder: { [kind]: order } }).then(() => toast('Ordre enregistré : régénère le mois pour l\'appliquer')).catch(() => {});
});

// ----- Équipe -----
let team = [];
// Groupes de week-end : 2 personnes (encore en poste) maximum ; « Nouveau groupe » en crée un.
const activeMember = t => !t.end || t.end >= today();
function groupCount() { return Math.max(data.config.rotation.groups.length, ...team.map(t => Number(t.group) + 1)); }
function groupOptions(i) {
  const n = groupCount(), me = team[i];
  let h = '';
  for (let g = 0; g < n; g++) {
    const others = team.filter((t, k) => k !== i && Number(t.group) === g && activeMember(t));
    const names = team.filter(t => Number(t.group) === g && activeMember(t)).map(t => t.name || '…');
    const full = others.length >= 2 && activeMember(me);
    h += `<option value="${g}" ${Number(me.group) === g ? 'selected' : ''} ${full && Number(me.group) !== g ? 'disabled' : ''}>Groupe ${g + 1}${names.length ? ' (' + esc(names.join(', ')) + ')' : ' (vide)'}${full && Number(me.group) !== g ? ' — complet' : ''}</option>`;
  }
  return h + `<option value="${n}">+ Nouveau groupe</option>`;
}
function renderTeam() {
  const n = groupCount(), used = new Set(team.filter(activeMember).map(t => Number(t.group)));
  const over = [...used].filter(g => team.filter(t => Number(t.group) === g && activeMember(t)).length > 2);
  $('#teamGroupsInfo').innerHTML = `<b>${used.size} groupe${used.size > 1 ? 's' : ''}</b> : chaque groupe a son week-end obligatoire toutes les ${used.size} semaines (2 personnes maximum par groupe).`
    + (over.length ? ` <span class="tag warn">${over.map(g => 'Groupe ' + (g + 1)).join(', ')} : plus de 2 personnes, choisis « + Nouveau groupe » pour l'une d'elles</span>` : '');
  $('#teamList').innerHTML = '<tr><th>Nom</th><th>Note</th><th>Week-end avec</th><th>Arrivée</th><th>Départ</th><th></th></tr>' + team.map((t, i) => `
    <tr class="${t.end && t.end < today() ? 'gone' : ''} ${activeMember(t) && over.includes(Number(t.group)) ? 'over' : ''}">
      <td><input type="text" data-i="${i}" data-k="name" value="${esc(t.name)}"></td>
      <td><input type="text" data-i="${i}" data-k="note" value="${esc(t.note || '')}" placeholder="ex. CDR"></td>
      <td><select data-i="${i}" data-k="group">${groupOptions(i)}</select></td>
      <td><input type="date" data-i="${i}" data-k="start" value="${t.start || ''}"></td>
      <td><input type="date" data-i="${i}" data-k="end" value="${t.end || ''}"></td>
      <td>${t.id ? `<button data-edit="${t.id}" title="Départ ou suppression de ${esc(t.name)}">Supprimer…</button>` : `<button data-rm="${i}">Retirer</button>`}</td>
    </tr>`).join('');
}
// Modifications pas encore enregistrées : on ne les écrase pas quand la page se redessine.
let teamDirty = false;
function loadTeam(force) {
  if (teamDirty && !force) return;
  const c = data.config;
  team = c.employees.map(e => ({ ...e, group: c.rotation.groups.findIndex(g => g.includes(e.id)) }));
  $('#chefNameInput').value = c.chef.name;
  teamDirty = false; $('#teamErr').hidden = true;
  renderTeam();
}
$('#openTeam').onclick = () => { loadTeam(true); $('#teamDlg').showModal(); };
$('#teamChefBtn').onclick = () => openChef();
$('#teamList').addEventListener('change', e => {
  const { i, k } = e.target.dataset; if (i === undefined) return;
  team[i][k] = e.target.value; teamDirty = true;
  if (k === 'group' || k === 'end' || k === 'name') renderTeam();
});
$('#teamList').addEventListener('click', e => {
  const ed = e.target.closest('button[data-edit]');
  // Personne déjà enregistrée : départ (garde l'historique) ou suppression définitive, dans la fiche de la personne.
  if (ed) { teamDirty = false; openEmp(ed.dataset.edit); return; }
  const b = e.target.closest('button[data-rm]'); if (!b) return;
  team.splice(Number(b.dataset.rm), 1); renderTeam();
});
// Nouvelle personne : dans le premier groupe qui a encore de la place, sinon dans un nouveau groupe.
$('#teamAdd').onclick = () => {
  const n = groupCount();
  let g = 0;
  while (g < n && team.filter(t => Number(t.group) === g && activeMember(t)).length >= 2) g++;
  team.push({ name: '', note: '', group: g, start: today() }); teamDirty = true;
  renderTeam(); $('#teamList tr:last-child input').focus();
};
$('#teamSave').onclick = async () => {
  $('#teamErr').hidden = true;
  try {
    await api('/api/team', { employees: team, chefName: $('#chefNameInput').value });
  } catch (err) {
    $('#teamErr').textContent = `Pas enregistré : ${err.message}`; $('#teamErr').hidden = false;
    return;
  }
  loadTeam(true); toast('Équipe enregistrée');
};

// ----- Actions -----
$('#prev').onclick = () => { month = addMonth(month, -1); api('/api/state'); };
$('#next').onclick = () => { month = addMonth(month, 1); api('/api/state'); };
$('#print').onclick = () => window.print();
$('#generate').onclick = async e => {
  if (data.view.generated && !confirm('Régénérer le mois ? Les cases non verrouillées seront remplacées.')) return;
  const b = $('#generate');
  b.disabled = true; b.textContent = 'Calcul en cours…';
  try { await api('/api/generate', {}); toast('Planning généré'); } finally { b.disabled = false; b.innerHTML = 'Générer<span class="long"> le mois</span>'; }
};

// ----- Connexion -----
const loginMsg = (text, ok) => { $('#lMsg').textContent = text || ''; $('#lMsg').classList.toggle('ok', !!ok); };
function showLogin() {
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  $('#login').hidden = false;
  $('#loginForm').hidden = false; $('#forgotForm').hidden = true; $('#resetForm').hidden = true;
  $('#lPass').value = '';
  $('#lEmail').focus();
}
async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Un instant…';
  try { await fn(); } catch (e) { loginMsg(e.message); } finally { btn.disabled = false; btn.textContent = label; }
}
$('#loginForm').onsubmit = e => {
  e.preventDefault(); loginMsg('');
  busy($('#lSubmit'), async () => {
    await authCall('/api/auth/login', { email: $('#lEmail').value, password: $('#lPass').value });
    $('#login').hidden = true;
    await api('/api/state');
  });
};
$('#lForgot').onclick = () => {
  loginMsg('');
  $('#loginForm').hidden = true; $('#forgotForm').hidden = false;
  $('#fEmail').value = $('#lEmail').value;
  $('#fEmail').focus();
};
$('#fBack').onclick = () => { loginMsg(''); $('#forgotForm').hidden = true; $('#loginForm').hidden = false; };
$('#forgotForm').onsubmit = e => {
  e.preventDefault(); loginMsg('');
  busy($('#fSend'), async () => {
    await authCall('/api/auth/forgot', { email: $('#fEmail').value });
    loginMsg('Si cette adresse a un compte, un email vient d\'être envoyé (regarde aussi dans les spams). Clique sur « Reset password » dans l\'email.', true);
  });
};
// Arrivée depuis le lien de l'email : choisir le nouveau mot de passe.
$('#resetForm').onsubmit = e => {
  e.preventDefault(); loginMsg('');
  if ($('#rPass').value !== $('#rPass2').value) return loginMsg('Les deux mots de passe ne sont pas identiques.');
  busy($('#rSave'), async () => {
    await authCall('/api/auth/password', { password: $('#rPass').value });
    history.replaceState(null, '', location.pathname);
    $('#login').hidden = true;
    await api('/api/state');
    toast('Mot de passe changé');
  });
};
$('#accountBtn').onclick = () => { $('#accPass').value = ''; $('#accountDlg').showModal(); };
$('#accSave').onclick = async () => {
  try {
    await authCall('/api/auth/password', { password: $('#accPass').value });
    $('#accPass').value = ''; $('#accountDlg').close(); toast('Mot de passe changé');
  } catch (e) { toast(e.message); }
};
$('#accLogout').onclick = async () => {
  await authCall('/api/auth/logout', {});
  data = null;
  showLogin();
};

// ----- Mises à jour (seulement dans l'application Windows) -----
if (window.planningApp) {
  window.planningApp.version().then(v => { $('#appVersion').hidden = false; $('#appVersion').textContent = `Planning Interparking, version ${v}`; });
  window.planningApp.onUpdateReady(v => {
    $('#updateText').textContent = `Une nouvelle version (${v}) est prête.`;
    $('#updateBar').hidden = false;
  });
  $('#updateNow').onclick = () => window.planningApp.installUpdate();
  $('#updateLater').onclick = () => { $('#updateBar').hidden = true; toast('La mise à jour s\'installera à la fermeture du planning'); };
}

// Version web : export Excel fabriqué dans la page.
if (backend) $('#csv').addEventListener('click', async e => {
  e.preventDefault();
  const out = await backend.handle('GET', '/api/export.xlsx', { month }, {});
  if (!out.xlsx) return toast((out.json && out.json.error) || 'Export impossible');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = out.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
// Version web : icône installable (application sur le bureau).
if (backend && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

(async () => {
  const params = new URLSearchParams(location.search);
  const here = location.pathname;
  // Version web : retour du lien « mot de passe oublié » (#access_token=…&type=recovery, ou #error=…).
  const hash = location.hash.slice(1);
  if (backend && /type=recovery|error_description=/.test(hash)) {
    history.replaceState(null, '', here);
    try { await backend.recoverFromLink(hash); params.set('reset', '1'); } catch (e) { params.set('resetError', e.message); }
  }
  const s = await authCall('/api/auth/status');
  if (params.has('reset') && s.loggedIn) {
    showLogin();
    $('#loginForm').hidden = true; $('#resetForm').hidden = false;
    $('#rPass').focus();
  } else if (s.mode === 'cloud' && !s.loggedIn) {
    showLogin();
    if (params.has('resetError')) loginMsg(params.get('resetError'));
    history.replaceState(null, '', here);
  } else api('/api/state').then(restorePage);
})();
function restorePage() {
  let p = 'dashboard';
  try { p = localStorage.getItem('page') || p; } catch {}
  const nav = document.querySelector(`.nav[data-go="${p}"]`);
  if (nav && nav.onclick) nav.click(); else go(p);
}
