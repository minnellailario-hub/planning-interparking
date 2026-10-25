'use strict';
const $ = s => document.querySelector(s);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const OFF = { REPOS: 'Repos', WE: 'Week-end', RTT: 'RTT', RECUP: 'Récup foot', CONGE: 'Congé', MALADIE: 'Maladie' };
const SHORT = { REPOS: 'R', WE: 'WE', RTT: 'RTT', RECUP: 'Réc', CONGE: 'CG', MALADIE: 'Mal' };

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

function cellHtml(c) {
  if (!c) return '';
  if (c.kind === 'off') return `<span class="c-${c.code}">${SHORT[c.code] || c.code}</span>`;
  return `<span class="c-${c.shift}">${esc(c.label)}</span>`;
}

function render() {
  const v = data.view;
  const [y, m] = month.split('-').map(Number);
  $('#monthTitle').textContent = `${MONTHS[m - 1]} ${y}`;
  $('#csv').href = `/api/export.csv?month=${month}`;
  try { localStorage.setItem('month', month); } catch {}
  $('#syncBar').hidden = !data.syncError;
  $('#syncBar').textContent = data.syncError || '';

  const colCls = d => [d.dow === 1 ? 'monday' : '', d.closed ? 'closed' : '', d.dow === 6 ? 'sat' : ''].join(' ');
  let h = '<thead><tr><th class="name">Employé</th>';
  for (const d of v.days) {
    const title = [d.closed ? 'Fermé' : '', d.weGroup.length ? 'Week-end : ' + d.weGroup.join(', ') : '',
      d.match ? `Anderlecht – ${d.match.opponent} (${d.match.competition}) ${d.match.time}${d.match.confirmed ? '' : ' – heure à confirmer'}` : ''].filter(Boolean).join('\n');
    h += `<th class="${colCls(d)}" data-date="${d.date}" title="${esc(title)}"><span class="d">${d.dowLabel}</span><br>${d.day}`;
    if (d.openSunday) h += `<span class="o">Ouvert</span>`;
    if (d.match) h += `<span class="m ${d.match.confirmed ? '' : 'tbc'}">⚽ ${d.match.time}</span>`;
    h += '</th>';
  }
  h += '</tr></thead><tbody>';
  for (const r of v.rows) {
    if (r.isChef) h += `<tr class="addrow"><td class="name"><button class="add-emp">+ Ajouter un employé</button></td><td colspan="${v.days.length}"></td></tr>`;
    h += `<tr class="${r.isChef ? 'chef sep' : ''}"><td class="name"><div class="namebox"><span>${esc(r.name)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span>${r.isChef ? '' : `<button class="edit-emp ghost" data-id="${r.id}" title="Modifier ou supprimer ${esc(r.name)}">✎</button>`}</div></td>`;
    for (const d of v.days) {
      const c = r.cells[d.date];
      h += `<td class="cell ${colCls(d)} ${c && c.locked ? 'lock' : ''}" data-emp="${r.id}" data-date="${d.date}">${cellHtml(c)}</td>`;
    }
    h += '</tr>';
  }
  h += '<tr class="sum sep"><td class="name">Étudiants</td>';
  for (const d of v.days) h += `<td class="stud ${colCls(d)}">${d.students.map(s => s.replace('FOOT', '⚽')).join('<br>')}</td>`;
  h += '</tr><tr class="sum"><td class="name">Présents</td>';
  for (const d of v.days) {
    if (d.closed && !d.present) { h += `<td class="${colCls(d)}"></td>`; continue; }
    const tot = d.present + d.students.length;
    h += `<td class="${colCls(d)} ${d.missing || d.warnings.length ? 'bad' : ''}" title="${esc(d.warnings.join('\n'))}">${tot}${d.need ? '/' + d.need : ''}</td>`;
  }
  h += '</tr></tbody>';
  $('#grid').innerHTML = h;

  $('#legend').innerHTML = [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['FOOT', '⚽ Horaire foot'], ['11-19', 'Chef terrain'],
    ['REPOS', 'R = Repos'], ['WE', 'WE = Week-end'], ['RTT', 'RTT'], ['RECUP', 'Réc = Récup foot'], ['CONGE', 'CG = Congé / Mal = Maladie']]
    .map(([c, l]) => `<span><span class="sw c-${c}">&nbsp;</span>${l}</span>`).join('');

  $('#warnings').innerHTML = !v.generated ? '<li class="ok">Mois pas encore généré.</li>'
    : v.warnings.length ? v.warnings.map(w => `<li>${esc(w)}</li>`).join('') : '<li class="ok">Aucune alerte, toutes les règles sont respectées.</li>';

  const cols = [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['foot', '⚽ mois'], ['footSeason', '⚽ saison'], ['REPOS', 'Repos'], ['RTT', 'RTT'], ['worked', 'Jours trav.']];
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

  renderMatches();
  renderSettings();
}

// ----- Édition d'une case -----
const pop = $('#popover');
document.addEventListener('click', e => {
  const th = e.target.closest('#grid thead th[data-date]');
  if (th) {
    const d = data.view.days.find(x => x.date === th.dataset.date);
    if (d.dow === 0) return;
    if (confirm(d.closed ? `Rouvrir le ${fmtDate(d.date)} ?` : `Marquer le ${fmtDate(d.date)} comme jour de fermeture ?`))
      api('/api/config', { toggleClosed: d.date });
    return;
  }
  if (e.target.closest('#grid .add-emp')) { openEmp(null); return; }
  const ed = e.target.closest('#grid .edit-emp');
  if (ed) { openEmp(ed.dataset.id); return; }
  const td = e.target.closest('#grid td.cell');
  if (td) { openPop(td); return; }
  if (!e.target.closest('#popover')) pop.hidden = true;
});
function openPop(td) {
  const { emp, date } = td.dataset;
  const day = data.view.days.find(x => x.date === date);
  const row = data.view.rows.find(r => r.id === emp);
  const opts = row.isChef ? ['11-19'] : ['8-16', '10-18', '12-20'];
  if (day.match && !row.isChef) opts.push('FOOT');
  let h = `<div class="ttl">${esc(row.name)} – ${day.dowLabel} ${fmtDate(date)}</div>`;
  for (const o of opts) h += `<button data-v="${o}" class="c-${o}">${o === 'FOOT' ? '⚽ ' + day.match.shift : o}</button>`;
  for (const k of Object.keys(OFF)) if (!row.isChef || ['REPOS', 'CONGE', 'MALADIE', 'RTT'].includes(k)) h += `<button data-v="${k}" class="c-${k}">${OFF[k]}</button>`;
  h += `<button data-v="auto" class="auto">Automatique (déverrouiller)</button>`;
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
function renderSettings() {
  $('#accountBox').hidden = data.account.mode !== 'cloud';
  $('#accEmail').textContent = data.account.email || '';
  const c = data.config;
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

function entriesDialog({ prefix, endpoint, withValue, describe }) {
  let rows = [];
  const el = id => $('#' + prefix + id);
  function render() {
    const opts = activeEmps();
    el('Rows').innerHTML = rows.map((s, i) => `
      <div class="row">
        <label>Employé <select data-i="${i}" data-k="empId">${opts.map(e => `<option value="${e.id}" ${e.id === s.empId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
        ${withValue ? `<label>Quoi <select data-i="${i}" data-k="value">${REQUEST_CHOICES.map(([v, l]) => `<option value="${v}" ${v === s.value ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        <label>Du <input type="date" data-i="${i}" data-k="from" value="${s.from}"></label>
        <label>Au <input type="date" data-i="${i}" data-k="to" value="${s.to}"></label>
        ${rows.length > 1 ? `<button data-rm="${i}" class="ghost" title="Retirer">✕</button>` : ''}
      </div>`).join('');
  }
  const blank = from => ({ empId: activeEmps()[0].id, value: '8-16', from, to: from });
  el('Open').onclick = () => {
    rows = [blank(today())];
    render(); el('Result').innerHTML = ''; el('Dlg').showModal();
  };
  el('Add').onclick = () => {
    const last = rows[rows.length - 1];
    const next = withValue ? last.empId : (activeEmps().find(e => !rows.some(r => r.empId === e.id)) || activeEmps()[0]).id;
    rows.push({ ...last, empId: next });
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
    if (rows.some(s => !s.from || !s.to)) return toast('Indique les dates');
    e.target.disabled = true; e.target.textContent = 'Calcul en cours…';
    try {
      month = rows.map(s => s.from).sort()[0].slice(0, 7);
      const r = await api(endpoint, { entries: rows, regenerate: el('Regen').checked });
      const { regenerated, changes } = r.result;
      const nameOf = id => data.config.employees.find(x => x.id === id).name;
      const period = s => s.from === s.to ? `le ${fmtDate(s.from)}` : `du ${fmtDate(s.from)} au ${fmtDate(s.to)}`;
      let h = `<div class="ok-box">${rows.map(s => esc(describe(nameOf(s.empId), s, period(s)))).join('<br>')}`;
      h += regenerated.length ? '<br>Horaire recalculé.' : '<br>Horaire non recalculé (mois pas encore généré ou option décochée).';
      h += '</div>';
      if (changes.length) {
        h += `<h4>Changements à prévenir (${changes.length})</h4><div class="changes"><table class="list"><tr><th>Date</th><th>Qui</th><th>Avant</th><th>Après</th></tr>`
          + changes.map(c => `<tr><td>${fmtDate(c.date)}</td><td>${esc(c.name)}</td><td>${esc(c.before)}</td><td><b>${esc(c.after)}</b></td></tr>`).join('')
          + '</table></div>';
      } else if (regenerated.length) h += '<p class="muted">Aucun autre horaire ne change.</p>';
      el('Result').innerHTML = h;
    } finally { e.target.disabled = false; e.target.textContent = 'Valider'; }
  };
}
entriesDialog({ prefix: 'sick', endpoint: '/api/sick', withValue: false,
  describe: (name, s, period) => `${name} est en maladie ${period}.` });
entriesDialog({ prefix: 'req', endpoint: '/api/requests', withValue: true,
  describe: (name, s, period) => `${name} : ${(REQUEST_CHOICES.find(c => c[0] === s.value) || [, s.value])[1]} ${period}.` });

// ----- Une personne : ajouter / modifier / départ / supprimer -----
let empId = null;
function openEmp(id) {
  const c = data.config;
  const e = id && c.employees.find(x => x.id === id);
  empId = id;
  const label = g => c.rotation.groups[g].map(x => (c.employees.find(y => y.id === x) || {}).name).filter(Boolean).join(', ');
  $('#empGroup').innerHTML = c.rotation.groups.map((_, g) => `<option value="${g}">Groupe ${g + 1}${label(g) ? ' (' + esc(label(g)) + ')' : ''}</option>`).join('');
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

// ----- Équipe -----
let team = [];
function groupLabels() {
  return data.config.rotation.groups.map((_, i) => {
    const names = team.filter(t => Number(t.group) === i && (!t.end || t.end >= today())).map(t => t.name || '…');
    return `Groupe ${i + 1}${names.length ? ' (' + names.join(', ') + ')' : ''}`;
  });
}
function renderTeam() {
  const labels = groupLabels();
  $('#teamList').innerHTML = '<tr><th>Nom</th><th>Note</th><th>Week-end avec</th><th>Arrivée</th><th>Départ</th><th></th></tr>' + team.map((t, i) => `
    <tr class="${t.end && t.end < today() ? 'gone' : ''}">
      <td><input type="text" data-i="${i}" data-k="name" value="${esc(t.name)}"></td>
      <td><input type="text" data-i="${i}" data-k="note" value="${esc(t.note || '')}" placeholder="ex. CDR"></td>
      <td><select data-i="${i}" data-k="group">${labels.map((l, g) => `<option value="${g}" ${Number(t.group) === g ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
      <td><input type="date" data-i="${i}" data-k="start" value="${t.start || ''}"></td>
      <td><input type="date" data-i="${i}" data-k="end" value="${t.end || ''}"></td>
      <td>${t.id ? '' : `<button data-rm="${i}">Retirer</button>`}</td>
    </tr>`).join('');
}
$('#openTeam').onclick = () => {
  const c = data.config;
  team = c.employees.map(e => ({ ...e, group: c.rotation.groups.findIndex(g => g.includes(e.id)) }));
  $('#chefNameInput').value = c.chef.name;
  renderTeam();
  $('#teamDlg').showModal();
};
$('#teamList').addEventListener('change', e => {
  const { i, k } = e.target.dataset; if (i === undefined) return;
  team[i][k] = e.target.value;
  if (k === 'group' || k === 'end' || k === 'name') renderTeam();
});
$('#teamList').addEventListener('click', e => {
  const b = e.target.closest('button[data-rm]'); if (!b) return;
  team.splice(Number(b.dataset.rm), 1); renderTeam();
});
$('#teamAdd').onclick = () => { team.push({ name: '', note: '', group: 0, start: today() }); renderTeam(); $('#teamList tr:last-child input').focus(); };
$('#teamSave').onclick = async () => {
  await api('/api/team', { employees: team, chefName: $('#chefNameInput').value });
  $('#teamDlg').close(); toast('Équipe enregistrée');
};

// ----- Actions -----
$('#prev').onclick = () => { month = addMonth(month, -1); api('/api/state'); };
$('#next').onclick = () => { month = addMonth(month, 1); api('/api/state'); };
$('#print').onclick = () => window.print();
$('#generate').onclick = async e => {
  if (data.view.generated && !confirm('Régénérer le mois ? Les cases non verrouillées seront remplacées.')) return;
  e.target.disabled = true; e.target.textContent = 'Calcul en cours…';
  try { await api('/api/generate', {}); toast('Planning généré'); } finally { e.target.disabled = false; e.target.textContent = 'Générer le mois'; }
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
$('#accSave').onclick = async () => {
  try {
    await authCall('/api/auth/password', { password: $('#accPass').value });
    $('#accPass').value = ''; toast('Mot de passe changé');
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
  const out = await backend.handle('GET', '/api/export.csv', { month }, {});
  if (!out.csv) return toast((out.json && out.json.error) || 'Export impossible');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.csv], { type: 'text/csv;charset=utf-8' }));
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
  } else api('/api/state');
})();
