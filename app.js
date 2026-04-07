(() => {
  const STORAGE_KEYS = { points: 'arazide_points_v1', rights: 'arazide_rights_v1', selected: 'arazide_selected_v1' };
  const VALID_CATEGORIES = ['Altın', 'Taş', 'Diğer', 'Serbest'];
  const state = {
    points: [],
    selectedId: null,
    rights: 2,
    editingId: null,
    analysisMap: null,
    mapTabMap: null,
    markers: {},
    tabMarkers: {},
    activeFilter: 'all',
    activeSearch: ''
  };

  const byId = (id) => document.getElementById(id);

  function init() {
    loadState();
    bindEvents();
    initMaps();
    renderAll();
    registerSW();
  }

  function parseJSON(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function normalizePoint(point, idx = 0) {
    if (!point || typeof point !== 'object') return null;
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    const category = VALID_CATEGORIES.includes(point.category) ? point.category : 'Serbest';
    const id = String(point.id || `imp_${Date.now()}_${idx}`);
    const name = String(point.name || 'İsimsiz nokta').trim();
    const city = String(point.city || '-').trim();
    const district = String(point.district || '-').trim();
    const village = String(point.village || '-').trim();
    const summary = String(point.summary || 'Özet yok.').trim();

    return {
      id,
      name,
      city,
      district,
      village,
      category,
      lat,
      lng,
      summary,
      score: Number(point.score) || 50,
      confidence: String(point.confidence || 'Orta'),
      nextStep: String(point.nextStep || 'Kaydet, tekrar ziyaret planla'),
      stoneSignal: Math.max(0, Math.min(100, Number(point.stoneSignal) || 35)),
      stoneLevel: String(point.stoneLevel || 'Orta'),
      detailAnalysis: typeof point.detailAnalysis === 'object' && point.detailAnalysis ? point.detailAnalysis : {
        'Taş yoğunluğu': 'Orta',
        'Suya yakınlık': 'Orta',
        'Topoğrafik yapı': 'Karma',
        'Saha erişimi': 'Orta',
        'Önerilen işlem': 'Sahada doğrulama'
      },
      tags: Array.isArray(point.tags) && point.tags.length ? point.tags.map((x) => String(x)) : ['İlçe ölçeği', 'Orta güven'],
      createdAt: point.createdAt || new Date().toISOString()
    };
  }

  function sanitizePoints(points) {
    if (!Array.isArray(points)) return [];
    const used = new Set();
    return points
      .map((p, idx) => normalizePoint(p, idx))
      .filter(Boolean)
      .map((p) => {
        if (used.has(p.id)) p.id = `${p.id}_${Math.random().toString(36).slice(2, 6)}`;
        used.add(p.id);
        return p;
      });
  }

  function loadState() {
    const seed = sanitizePoints(window.APP_SEED_POINTS);
    const storedPoints = sanitizePoints(parseJSON(localStorage.getItem(STORAGE_KEYS.points) || '', []));
    state.points = storedPoints.length ? storedPoints : seed;
    state.rights = Math.max(0, Number(localStorage.getItem(STORAGE_KEYS.rights) || 2) || 2);

    const selectedCandidate = localStorage.getItem(STORAGE_KEYS.selected) || state.points[0]?.id;
    state.selectedId = state.points.some((x) => x.id === selectedCandidate) ? selectedCandidate : state.points[0]?.id || null;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEYS.points, JSON.stringify(state.points));
    localStorage.setItem(STORAGE_KEYS.rights, String(Math.max(0, state.rights)));
    localStorage.setItem(STORAGE_KEYS.selected, state.selectedId || '');
  }

  function initMaps() {
    state.analysisMap = L.map('analysisMap', { zoomControl: true }).setView([39.0, 35.0], 6);
    state.mapTabMap = L.map('mapTabMap', { zoomControl: true }).setView([39.0, 35.0], 6);
    const tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    [state.analysisMap, state.mapTabMap].forEach((m) => {
      L.tileLayer(tileUrl, { attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(m);
    });
    refreshMarkers();
  }

  function markerColor(point, isSelected) {
    if (isSelected) return '#ff4d5d';
    return ({ Altın: '#ffce67', Taş: '#5ab0ff', Diğer: '#7f7cff', Serbest: '#8e9cb6' }[point.category] || '#8e9cb6');
  }

  function refreshMarkers() {
    Object.values(state.markers).forEach((m) => m.remove());
    Object.values(state.tabMarkers).forEach((m) => m.remove());
    state.markers = {};
    state.tabMarkers = {};

    state.points
      .filter((p) => state.activeFilter === 'all' || p.category === state.activeFilter)
      .forEach((p) => {
        const isSel = p.id === state.selectedId;
        const style = { radius: isSel ? 9 : 7, color: markerColor(p, isSel), fillColor: markerColor(p, isSel), fillOpacity: .92, weight: 2 };
        const mk1 = L.circleMarker([p.lat, p.lng], style).addTo(state.analysisMap);
        const mk2 = L.circleMarker([p.lat, p.lng], style).addTo(state.mapTabMap);
        [mk1, mk2].forEach((mk) => mk.bindPopup(`<strong>${p.name}</strong><br>${p.district} / ${p.city}`).on('click', () => selectPoint(p.id, true)));
        state.markers[p.id] = mk1;
        state.tabMarkers[p.id] = mk2;
      });
  }

  function filteredPoints(search, filter) {
    const q = (search || '').toLowerCase().trim();
    return state.points.filter((p) => (filter === 'all' || p.category === filter) && (`${p.name} ${p.district} ${p.city} ${p.village}`.toLowerCase().includes(q)));
  }

  function renderRecordList(el, points, withActions = false) {
    el.innerHTML = points.map((p) => `<li class="record-item ${p.id === state.selectedId ? 'active' : ''}" data-id="${p.id}">
      <div class="record-meta"><div><span class="pin" style="background:${markerColor(p, false)}"></span><strong>${p.name}</strong></div><small>${p.district} / ${p.city}</small></div>
      ${withActions ? `<div><button type="button" data-edit="${p.id}">Düzenle</button><button type="button" data-del="${p.id}">Sil</button></div>` : ''}
    </li>`).join('');
  }

  function renderAll() {
    const points = filteredPoints(state.activeSearch, state.activeFilter);
    byId('rightsButton').textContent = `${state.rights} Hak Kaldı`;
    byId('rightsCountText').textContent = `Kalan hak: ${state.rights}`;
    renderRecordList(byId('analysisRecordList'), points);
    renderRecordList(byId('recordsList'), points, true);
    renderRecordList(byId('mapTabList'), points);
    renderMapChips();
    refreshMarkers();

    let selected = state.points.find((x) => x.id === state.selectedId);
    if (!selected) {
      selected = state.points[0] || null;
      state.selectedId = selected?.id || null;
    }
    if (selected) renderSelected(selected);
    saveState();
  }

  function renderSelected(p) {
    byId('selectedTitle').textContent = `${p.district} / ${p.city} ön değerlendirmesi`;
    byId('scoreValue').textContent = `${p.score}/100`;
    byId('confidenceValue').textContent = p.confidence;
    byId('nextStepValue').textContent = p.nextStep;
    byId('summaryText').textContent = p.summary;
    byId('stonePercent').textContent = `${p.stoneSignal}%`;
    byId('gaugeFill').style.width = `${p.stoneSignal}%`;
    byId('stoneText').textContent = `${p.stoneLevel} taş yoğunluğu, kasaba/mahalle etkisi`;
    byId('tagRow').innerHTML = p.tags.map((t) => `<span>${t}</span>`).join('') + '<span>Devamını gör</span>';
    byId('summaryModalText').textContent = `${p.summary} Analiz notu: ${p.nextStep}.`;
    byId('detailList').innerHTML = Object.entries(p.detailAnalysis).map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`).join('');
    state.analysisMap.flyTo([p.lat, p.lng], 10, { duration: .6 });
    state.mapTabMap.flyTo([p.lat, p.lng], 9, { duration: .6 });
  }

  function selectPoint(id, fly = false) {
    if (!state.points.some((x) => x.id === id)) return;
    state.selectedId = id;
    if (fly) {
      const p = state.points.find((x) => x.id === id);
      if (p) {
        state.analysisMap.flyTo([p.lat, p.lng], 11);
        state.mapTabMap.flyTo([p.lat, p.lng], 10);
      }
    }
    renderAll();
  }

  function openTab(tab) {
    document.querySelectorAll('.screen').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
    document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('active', x.dataset.openTab === tab));
    setTimeout(() => {
      state.analysisMap?.invalidateSize();
      state.mapTabMap?.invalidateSize();
    }, 120);
  }

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const actionButton = e.target.closest('[data-edit], [data-del]');
      if (actionButton) e.stopPropagation();

      const item = e.target.closest('.record-item');
      if (item?.dataset.id && !actionButton) selectPoint(item.dataset.id, true);
      if (e.target.matches('[data-open-tab]')) openTab(e.target.dataset.openTab);
      if (e.target.matches('[data-close-modal]')) e.target.closest('.modal').classList.add('hidden');
      if (e.target.classList.contains('modal')) e.target.classList.add('hidden');
      if (e.target.matches('[data-close-popover]')) byId('rightsPopup').classList.add('hidden');
      if (e.target.id === 'rightsButton') byId('rightsPopup').classList.toggle('hidden');
      if (e.target.id === 'goPremiumBtn' || e.target.id === 'premiumInfoBtn') byId('premiumModal').classList.remove('hidden');
      if (e.target.id === 'watchAdBtn') simulateAd();
      if (e.target.id === 'openSummaryBtn') byId('summaryModal').classList.remove('hidden');
      if (e.target.id === 'openDetailBtn') byId('detailDrawer').classList.remove('hidden');
      if (e.target.id === 'closeDrawerBtn') byId('detailDrawer').classList.add('hidden');
      if (e.target.id === 'addRecordOpenBtn' || e.target.id === 'recordsAddBtn') openRecordModal();
      if (e.target.id === 'toggleRecordPanel') byId('recordPanel').classList.toggle('hidden');
      if (e.target.dataset.edit) openRecordModal(e.target.dataset.edit);
      if (e.target.dataset.del) deletePoint(e.target.dataset.del);
      if (e.target.id === 'exportBtn') exportData();
      if (e.target.id === 'clearAllBtn') clearAll();
    });

    byId('analysisSearch').addEventListener('input', (e) => { state.activeSearch = e.target.value; byId('recordsSearch').value = e.target.value; renderAll(); });
    byId('recordsSearch').addEventListener('input', (e) => { state.activeSearch = e.target.value; byId('analysisSearch').value = e.target.value; renderAll(); });
    byId('analysisFilter').addEventListener('change', (e) => { state.activeFilter = e.target.value; byId('recordsFilter').value = e.target.value; renderAll(); });
    byId('recordsFilter').addEventListener('change', (e) => { state.activeFilter = e.target.value; byId('analysisFilter').value = e.target.value; renderAll(); });

    byId('recordForm').addEventListener('submit', onRecordSubmit);
    byId('geoFillBtn').addEventListener('click', fillGeolocation);
    byId('importInput').addEventListener('change', importData);
  }

  function simulateAd() {
    const btn = byId('watchAdBtn');
    btn.textContent = 'Yükleniyor...';
    btn.disabled = true;
    setTimeout(() => {
      state.rights += 1;
      btn.textContent = '▶ Reklam izle (+1 hak)';
      btn.disabled = false;
      byId('rightsPopup').classList.add('hidden');
      toast('Hak eklendi');
      renderAll();
    }, 1400);
  }

  function openRecordModal(id = null) {
    state.editingId = id;
    const modal = byId('recordModal');
    modal.classList.remove('hidden');
    const form = byId('recordForm');
    form.reset();
    byId('recordModalTitle').textContent = id ? 'Kaydı düzenle' : 'Yeni kayıt ekle';
    if (!id) return;
    const p = state.points.find((x) => x.id === id);
    if (!p) return;
    Object.entries({ name: p.name, city: p.city, district: p.district, village: p.village, summary: p.summary, category: p.category, lat: p.lat, lng: p.lng }).forEach(([k, v]) => {
      if (form.elements[k]) form.elements[k].value = v;
    });
  }

  function onRecordSubmit(e) {
    e.preventDefault();
    const f = e.target;
    const lat = Number(f.lat.value);
    const lng = Number(f.lng.value);
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return toast('Geçerli koordinat girin');

    const base = {
      name: f.name.value.trim(),
      city: f.city.value.trim(),
      district: f.district.value.trim(),
      village: f.village.value.trim(),
      category: f.category.value,
      lat,
      lng,
      summary: f.summary.value.trim(),
      score: Math.floor(45 + Math.random() * 45),
      confidence: ['Düşük', 'Orta', 'Yüksek'][Math.floor(Math.random() * 3)],
      nextStep: 'Kaydet, tekrar ziyaret planla',
      stoneSignal: Math.floor(30 + Math.random() * 60),
      stoneLevel: ['Düşük', 'Orta', 'Orta+', 'Yüksek'][Math.floor(Math.random() * 4)],
      detailAnalysis: { 'Taş yoğunluğu': 'Orta', 'Suya yakınlık': 'Orta', 'Topoğrafik yapı': 'Karma', 'Saha erişimi': 'Orta', 'Önerilen işlem': 'Sahada doğrulama' },
      tags: ['İlçe ölçeği', 'Bölgesel özet', 'Orta güven']
    };

    if (state.editingId) {
      state.points = state.points.map((p) => p.id === state.editingId ? { ...p, ...base } : p);
      toast('Kayıt güncellendi');
    } else {
      const point = { ...base, id: `p${Date.now()}`, createdAt: new Date().toISOString() };
      state.points.unshift(point);
      state.selectedId = point.id;
      toast('Kayıt eklendi');
    }
    byId('recordModal').classList.add('hidden');
    renderAll();
  }

  function deletePoint(id) {
    if (!confirm('Kaydı silmek istediğinize emin misiniz?')) return;
    state.points = state.points.filter((p) => p.id !== id);
    if (state.selectedId === id) state.selectedId = state.points[0]?.id || null;
    toast('Kayıt silindi');
    renderAll();
  }

  function fillGeolocation() {
    if (!navigator.geolocation) return toast('Konum desteği yok');
    navigator.geolocation.getCurrentPosition((pos) => {
      byId('recordForm').elements.lat.value = pos.coords.latitude.toFixed(6);
      byId('recordForm').elements.lng.value = pos.coords.longitude.toFixed(6);
      toast('Konum alındı');
    }, () => toast('Konum alınamadı'));
  }

  function exportData() {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), rights: state.rights, points: state.points }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'arazide-noktalarim-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Dışa aktarıldı');
  }

  function importData(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = parseJSON(String(reader.result || '{}'), null);
        const imported = sanitizePoints(data?.points || []);
        if (!imported.length) throw new Error('format');
        state.points = imported;
        state.rights = Math.max(0, Number(data?.rights || 2) || 2);
        state.selectedId = state.points[0]?.id || null;
        toast('İçe aktarıldı');
        renderAll();
      } catch {
        toast('Dosya formatı geçersiz');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!confirm('Tüm veriler silinsin mi?')) return;
    state.points = sanitizePoints(window.APP_SEED_POINTS);
    state.rights = 2;
    state.selectedId = state.points[0]?.id || null;
    toast('Veriler sıfırlandı');
    renderAll();
  }

  function renderMapChips() {
    const categories = ['all', 'Altın', 'Taş', 'Diğer', 'Serbest'];
    byId('mapFilterChips').innerHTML = categories.map((c) => `<button data-chip="${c}" class="${state.activeFilter === c ? 'active' : ''}">${c === 'all' ? 'Tümü' : c}</button>`).join('');
    byId('mapFilterChips').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.activeFilter = b.dataset.chip;
        byId('analysisFilter').value = state.activeFilter;
        byId('recordsFilter').value = state.activeFilter;
        renderAll();
      };
    });
  }

  function toast(msg) {
    const n = document.createElement('div');
    n.className = 'toast';
    n.textContent = msg;
    byId('toastBox').appendChild(n);
    setTimeout(() => n.remove(), 1900);
  }

  function registerSW() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => null);
  }

  init();
})();
