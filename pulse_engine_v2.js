/*
 * Fantasy HQ Pulse Engine V2
 *
 * This file is the single active Pulse contract for the review build.  It is
 * deliberately independent from the predictor formulas and from the future
 * local-LLM writer.  The engine accepts verified snapshots, validates their
 * evidence boundary, and renders the saved narrative without creating a
 * second browser-only history.
 */
(function (global) {
  'use strict';

  const CHECKPOINTS = ['PRE', 'Q1', 'HALF', 'Q3', 'FINAL', 'POSTGAME'];
  const PRE_PHASES = ['PRE', 'PRE_AM', 'PRE_PM', 'PRE_T10'];
  const NO_UPDATE = 'No relevant verified news/data at this checkpoint.';
  const NO_GRAPH = 'N/A — checkpoint graph not preserved';
  const NO_SNAPSHOT = 'No saved snapshot exists for this checkpoint.';
  const POSITIONS = /\b(QB|RB|FB|WR|TE|LT|LG|C|RG|RT|OL|DE|DT|NT|DL|LB|OLB|ILB|MLB|CB|S|FS|SS|DB|K|P|LS)\b/i;

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function cleanTeam(value) {
    const raw = String(value || '').toUpperCase();
    return raw === 'WSH' ? 'WAS' : raw;
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function iso(value) {
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function checkpointName(value) {
    const raw = String(value || '').toUpperCase();
    if (raw === 'HALFTIME') return 'HALF';
    if (raw === 'POST') return 'POSTGAME';
    if (raw === 'Q1_END') return 'Q1';
    if (raw === 'Q3_END') return 'Q3';
    if (raw === 'PREGAME_10M') return 'PRE_T10';
    if (raw === 'MIDNIGHT') return 'PRE_AM';
    if (raw === 'MIDDAY') return 'PRE_PM';
    return raw;
  }

  function isPregame(value) {
    return PRE_PHASES.includes(checkpointName(value));
  }

  function checkpointKey({ season, week, away, home, checkpoint, capturedAt }) {
    const normalized = checkpointName(checkpoint);
    const timestamp = iso(capturedAt) || new Date().toISOString();
    return `${normalized}-${Number(season)}-${Number(week)}-${cleanTeam(away)}-${cleanTeam(home)}-${timestamp}`;
  }

  function probabilityPoint(point) {
    if (!point) return null;
    const home = finite(point.homeWinProbability != null ? point.homeWinProbability : point.home_probability);
    const away = finite(point.awayWinProbability != null ? point.awayWinProbability : point.away_probability);
    const value = home != null ? (home > 1 ? home / 100 : home) : null;
    const other = away != null ? (away > 1 ? away / 100 : away) : (value != null ? 1 - value : null);
    return {
      capturedAt: iso(point.capturedAt || point.captured_at || point.t),
      evidenceCutoff: iso(point.evidenceCutoff || point.evidence_cutoff || point.capturedAt || point.captured_at || point.t),
      homeWinProbability: value,
      awayWinProbability: other,
      score: point.score || { away: finite(point.awayScore || point.away_score), home: finite(point.homeScore || point.home_score) },
      period: finite(point.period),
      clock: point.clock || '',
      possession: point.possession || null,
      modelVersion: point.modelVersion || point.model_version || null,
      sourceSeriesId: point.sourceSeriesId || point.series_id || null
    };
  }

  function normalizeSource(source) {
    if (!source) return null;
    const url = String(source.url || source.source_url || source.sourceUrl || '').trim();
    return {
      sourceId: String(source.sourceId || source.source_id || url || `source-${Math.random().toString(36).slice(2)}`),
      url,
      publisher: String(source.publisher || source.source_name || source.source || 'UNAVAILABLE'),
      sourceType: String(source.sourceType || source.source_type || 'UNAVAILABLE'),
      retrievedAt: iso(source.retrievedAt || source.retrieved_at),
      publishedAt: iso(source.publishedAt || source.published_at),
      evidenceCutoff: iso(source.evidenceCutoff || source.evidence_cutoff),
      reliabilityTier: source.reliabilityTier || source.reliability_tier || null,
      title: String(source.title || source.headline || source.publisher || 'Source')
    };
  }

  function normalizeSnapshot(input) {
    const x = input || {};
    const game = x.game || {};
    const checkpoint = checkpointName(x.checkpoint || x.label || x.snapshot_type);
    const capturedAt = iso(x.capturedAt || x.captured_at || x.created_at);
    const season = finite(x.season || game.season);
    const week = finite(x.week || game.week);
    const away = cleanTeam(x.away || x.away_team || game.away);
    const home = cleanTeam(x.home || x.home_team || game.home);
    const narrative = x.narrative || {};
    const sourceRows = Array.isArray(x.sources) ? x.sources : [];
    const sourceIds = Array.isArray(x.sourceIds) ? x.sourceIds : sourceRows.map((s) => normalizeSource(s)?.sourceId).filter(Boolean);
    return {
      pulseId: String(x.pulseId || x.pulse_id || `${checkpoint}-${capturedAt || 'missing'}`),
      checkpoint,
      checkpointKey: x.checkpointKey || x.checkpoint_key || checkpointKey({ season, week, away, home, checkpoint, capturedAt }),
      season,
      week,
      eventId: String(x.eventId || x.event_id || game.eventId || ''),
      gameId: String(x.gameId || x.game_id || x.game_key || game.gameId || `${season}-${week}-${away}-${home}`),
      away,
      home,
      kickoffAt: iso(x.kickoffAt || x.kickoff_at || game.kickoffAt),
      timezone: x.timezone || game.timezone || null,
      venue: x.venue || game.venue || null,
      capturedAt,
      evidenceCutoff: iso(x.evidenceCutoff || x.sourceCutoffAt || x.source_cutoff_at || capturedAt),
      modelVersion: x.modelVersion || x.model_version || x.model_state?.modelVersion || null,
      probability: probabilityPoint(x.probability || x.probabilityPoint || x.model_state || x),
      probabilityDelta: finite(x.probabilityDelta || x.probability_delta),
      evidence: x.evidence || x.raw_snapshot || {},
      narrative,
      sections: x.sections || narrative.sections || {},
      paragraphs: Array.isArray(x.paragraphs) ? x.paragraphs : (Array.isArray(narrative.paragraphs) ? narrative.paragraphs : []),
      players: Array.isArray(x.players) ? x.players : [],
      sources: sourceRows.map(normalizeSource).filter(Boolean),
      sourceIds,
      impactPlays: Array.isArray(x.impactPlays) ? x.impactPlays : (Array.isArray(x.play_events) ? x.play_events : []),
      missingData: x.missingData || x.missing_data || '',
      immutable: x.immutable !== false
    };
  }

  function validation(snapshot) {
    const x = normalizeSnapshot(snapshot);
    const errors = [];
    const warnings = [];
    if (!CHECKPOINTS.includes(x.checkpoint) && !isPregame(x.checkpoint)) errors.push('invalid checkpoint');
    if (!x.season || !x.week || !x.away || !x.home) errors.push('game identity is incomplete');
    if (!x.capturedAt) errors.push('capturedAt is required');
    if (!x.evidenceCutoff) errors.push('evidenceCutoff is required');
    if (x.capturedAt && x.evidenceCutoff && new Date(x.evidenceCutoff) > new Date(x.capturedAt)) errors.push('evidenceCutoff cannot be later than capturedAt');
    if (x.probability) {
      const home = x.probability.homeWinProbability;
      const away = x.probability.awayWinProbability;
      if (home != null && (home < 0 || home > 1)) errors.push('home probability is outside 0-1');
      if (away != null && (away < 0 || away > 1)) errors.push('away probability is outside 0-1');
      if (home != null && away != null && Math.abs(home + away - 1) > 0.00001) errors.push('probabilities do not sum to one');
    } else {
      warnings.push('probability unavailable');
    }
    if (x.checkpoint === 'POSTGAME' && !x.sections['Postgame'] && !x.paragraphs.length && !x.narrative.text) warnings.push('postgame narrative is empty');
    if (!x.sources.length) warnings.push('no source links supplied');
    if (!x.missingData && (!x.sections || Object.keys(x.sections).length === 0) && !x.paragraphs.length && !x.narrative.text) warnings.push('narrative is empty');
    const text = [x.narrative.text, ...x.paragraphs, ...Object.values(x.sections || {})].join(' ');
    if (/\bI\b/i.test(text)) errors.push('first-person language is not allowed');
    if (/next checkpoint/i.test(text)) errors.push('next checkpoint language is not allowed');
    if (/\b(TODO|TBD|PLACEHOLDER)\b/i.test(text)) errors.push('placeholder language is not allowed');
    (x.players || []).forEach((player) => {
      const name = typeof player === 'string' ? player : `${player.name || ''} ${player.position || player.pos || ''}`;
      if (!POSITIONS.test(name)) warnings.push(`player position unavailable: ${name.trim()}`);
    });
    return { ok: errors.length === 0, errors, warnings, snapshot: x };
  }

  function linkSource(source, label) {
    const s = normalizeSource(source);
    if (!s || !s.url || !/^https?:\/\//i.test(s.url)) return esc(label || s?.title || 'Source');
    return `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(label || s.title || s.publisher)}</a>`;
  }

  function renderProbability(x) {
    const home = x.probability?.homeWinProbability;
    const away = x.probability?.awayWinProbability;
    if (home == null && away == null) return NO_GRAPH;
    const h = home == null ? 'N/A' : `${Math.round(home * 100)}%`;
    const a = away == null ? 'N/A' : `${Math.round(away * 100)}%`;
    const delta = x.probabilityDelta == null ? '' : ` · change ${x.probabilityDelta > 0 ? '+' : ''}${Number(x.probabilityDelta).toFixed(1)} points`;
    return `${esc(x.away)} ${esc(a)} · ${esc(x.home)} ${esc(h)}${esc(delta)}`;
  }

  function renderNarrative(x) {
    const sections = x.sections || {};
    const paragraphs = x.paragraphs || [];
    if (x.narrative && typeof x.narrative.html === 'string' && x.narrative.html.trim()) return x.narrative.html;
    if (x.narrative && typeof x.narrative.text === 'string' && x.narrative.text.trim()) return x.narrative.text.split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join('');
    const entries = Object.entries(sections);
    if (entries.length) return entries.map(([title, body]) => `<section class="fhq-pulse-v2-section"><h4>${esc(title)}</h4><div>${String(body).split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join('')}</div></section>`).join('');
    if (paragraphs.length) return paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
    if (x.missingData) return `<p class="fhq-pulse-v2-missing">${esc(x.missingData)}</p>`;
    return `<p class="fhq-pulse-v2-missing">${esc(NO_SNAPSHOT)}</p>`;
  }

  function render(snapshot) {
    const result = validation(snapshot);
    const x = result.snapshot;
    const title = isPregame(x.checkpoint) ? 'Pregame Pulse' : `${x.checkpoint} Pulse`;
    const timestamp = x.capturedAt ? new Date(x.capturedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'UNAVAILABLE';
    const sourceHtml = x.sources.length ? `<div class="fhq-pulse-v2-sources">${x.sources.map((s) => linkSource(s, s.title || s.publisher)).join(' · ')}</div>` : '';
    const warning = result.errors.length ? `<div class="fhq-pulse-v2-warning">Snapshot validation: ${esc(result.errors.join('; '))}</div>` : '';
    return `<article class="fhq-pulse-v2 rc17-pulse-report" data-fhq-pulse-engine="v2" data-rc24-pulse-v2="1" data-checkpoint="${esc(x.checkpoint)}"><header><div class="fhq-pulse-v2-kicker">MATCHUP PULSE · ${esc(title)}</div><div class="fhq-pulse-v2-meta">${esc(x.away)} @ ${esc(x.home)} · ${esc(timestamp)} · ${esc(renderProbability(x))}</div></header><div class="fhq-pulse-v2-body">${renderNarrative(x)}</div>${warning}${sourceHtml}</article>`;
  }

  function localRows(gameId) {
    try {
      const raw = JSON.parse(global.localStorage?.getItem('fhq_pulse_snapshots_v1') || '[]');
      if (Array.isArray(raw)) return raw.filter((x) => !gameId || String(x.gameId || x.game_key || '') === String(gameId));
    } catch (_) { /* local fallback is optional */ }
    return [];
  }

  async function loadRemote(game) {
    if (typeof global.FHQLoadPulseSpecV1 !== 'function') return [];
    try {
      const result = await global.FHQLoadPulseSpecV1(game);
      return Array.isArray(result?.snapshots) ? result.snapshots : [];
    } catch (_) {
      return [];
    }
  }

  function cardGame(card) {
    const away = cleanTeam(card?.dataset?.away);
    const home = cleanTeam(card?.dataset?.home);
    const week = finite(card?.dataset?.week || global.document?.getElementById('predWeekSel')?.value);
    if (!away || !home || !week) return null;
    return { week, away, home, game: `${week}:${away}:${home}` };
  }

  function snapshotFor(rows, phase) {
    const wanted = checkpointName(phase || 'PRE');
    const normalized = rows.map(normalizeSnapshot).filter((x) => checkpointName(x.checkpoint) === wanted || (wanted === 'PRE' && isPregame(x.checkpoint)));
    normalized.sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')));
    return normalized[normalized.length - 1] || null;
  }

  function availablePhases(rows) {
    const found = new Set(rows.map((x) => checkpointName(x.checkpoint)));
    return CHECKPOINTS.filter((x) => found.has(x) || (x === 'PRE' && [...found].some(isPregame)));
  }

  function controls(card, rows, active) {
    const host = card.querySelector('[data-fhq-pulse-v2-controls]') || card.querySelector('.rc10-checkpoint-row') || card.querySelector('.rc4-checkpoints');
    if (!host) return;
    const phases = availablePhases(rows);
    const labels = phases.length ? phases : ['PRE'];
    host.setAttribute('data-fhq-pulse-v2-controls', '1');
    host.innerHTML = labels.map((phase) => `<button type="button" class="rc4-checkpoint-btn fhq-pulse-v2-checkpoint ${active === phase ? 'active' : ''}" data-fhq-pulse-phase="${esc(phase)}">${esc(phase)}</button>`).join('');
  }

  async function refreshCard(card, phase) {
    const game = cardGame(card);
    if (!game) return;
    const report = card.querySelector('.rc4-report-content');
    if (!report) return;
    const rows = [];
    const remote = await loadRemote(game.game);
    remote.forEach((row) => rows.push(row));
    localRows(game.game).forEach((row) => { if (!rows.some((x) => String(x.pulse_id || x.pulseId) === String(row.pulse_id || row.pulseId))) rows.push(row); });
    const active = checkpointName(phase || card.dataset.activeCheckpoint || 'PRE');
    controls(card, rows, active);
    const snapshot = snapshotFor(rows, active);
    report.dataset.fhqPulseV2Rendered = '1';
    report.innerHTML = render(snapshot || { season: 2026, week: game.week, away: game.away, home: game.home, checkpoint: active, missingData: NO_SNAPSHOT });
  }

  function install() {
    if (global.__FHQ_PULSE_ENGINE_V2_INSTALLED) return;
    global.__FHQ_PULSE_ENGINE_V2_INSTALLED = true;
    global.FHQ_PULSE_ENGINE_V2_ACTIVE = true;
    global.FHQPulseEngineV2 = { CHECKPOINTS, PRE_PHASES, NO_UPDATE, NO_GRAPH, NO_SNAPSHOT, checkpointKey, normalizeSnapshot, validate: validation, render, refreshCard };
    global.FHQValidatePulseV2 = validation;
    global.FHQCheckpointKeyV2 = checkpointKey;

    global.modelPulseSelectCheckpoint = function (button, phase) {
      const card = button?.closest?.('.model-match-card');
      if (!card) return;
      card.dataset.activeCheckpoint = checkpointName(phase);
      refreshCard(card, phase);
      if (typeof global.renderStatsForCard === 'function') global.renderStatsForCard(card, phase);
    };

    const refresh = () => global.document?.querySelectorAll('.model-match-card.open').forEach((card) => {
      if (!card.querySelector('[data-fhq-pulse-v2-controls]')) refreshCard(card);
      else if (!card.querySelector('.fhq-pulse-v2')) refreshCard(card);
    });
    global.document?.addEventListener('click', (event) => {
      const button = event.target.closest?.('.fhq-pulse-v2-checkpoint');
      if (button) {
        event.preventDefault();
        event.stopPropagation();
        const card = button.closest('.model-match-card');
        if (card) {
          card.dataset.activeCheckpoint = button.dataset.fhqPulsePhase;
          refreshCard(card, button.dataset.fhqPulsePhase);
        }
      }
    }, true);
    global.document?.addEventListener('click', (event) => {
      if (event.target.closest?.('.model-match-main')) setTimeout(refresh, 120);
    }, true);
    if (typeof global.MutationObserver === 'function' && global.document?.body) {
      const observer = new global.MutationObserver(() => { clearTimeout(observer.timer); observer.timer = setTimeout(refresh, 100); });
      observer.observe(global.document.body, { childList: true, subtree: true });
    }
    global.setTimeout(refresh, 700);
  }

  if (global.document?.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', install);
  else install();
})(window);
