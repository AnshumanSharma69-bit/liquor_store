// ── Config ────────────────────────────────────────────────────
const KEY     = 'd2e7549f2dmsh60ea559d8ec69e5p1199f5jsnbb7bcc8a8a0c';
const HOST    = 'google-map-places.p.rapidapi.com';
const HEADERS = { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST };
const DAYS    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const FAV_KEY = 'sf_favs';

// ── State ─────────────────────────────────────────────────────
let compassHeading = 0, targetBearing = 0, demoTimer = null;
let stores = [], activeIdx = 0, deferredPrompt = null;
let searchRadius = 3000;
let userLat = null, userLng = null;
let watchId = null, storesSearched = false;
let closeAlertShown = false, lastAlertIdx = -1;
let isScanning = false, scanAngle = 0, scanFrameId = null;
let swipeStartX = 0, swipeStartY = 0, swipeLocked = false;

// ── PWA ───────────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPrompt = e;
  document.getElementById('install-banner').style.display = 'flex';
});
function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => {
    document.getElementById('install-banner').style.display = 'none';
    deferredPrompt = null;
  });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ── Radius ────────────────────────────────────────────────────
function setRadius(btn) {
  document.querySelectorAll('.rpill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  searchRadius = parseInt(btn.dataset.r, 10);
}

// ── Favourites ────────────────────────────────────────────────
function getFavs()       { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; } }
function saveFavs(f)     { try { localStorage.setItem(FAV_KEY, JSON.stringify(f)); } catch {} }
function isFav(placeId)  { return !!placeId && getFavs().some(f => f.id === placeId); }

function toggleFav() {
  const s = stores[activeIdx];
  if (!s?.placeId) return;
  let favs = getFavs();
  const idx = favs.findIndex(f => f.id === s.placeId);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push({ id: s.placeId, name: s.name });
  saveFavs(favs);
  updateFavBtn();
  renderList();
}
function updateFavBtn() {
  const s   = stores[activeIdx];
  const btn = document.getElementById('btn-fav');
  if (!btn) return;
  const on = isFav(s?.placeId);
  const ic = btn.querySelector('i');
  ic.className   = on ? 'ti ti-heart-filled' : 'ti ti-heart';
  ic.style.color = on ? '#FF5C7A' : '';
  btn.className  = on ? 'action-btn fav on' : 'action-btn fav';
}

// ── Math ──────────────────────────────────────────────────────
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

function haversine(la1, lo1, la2, lo2) {
  const R = 6371, dLa = toRad(la2-la1), dLo = toRad(lo2-lo1);
  const a = Math.sin(dLa/2)**2 + Math.cos(toRad(la1))*Math.cos(toRad(la2))*Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function calcBearing(la1, lo1, la2, lo2) {
  const dL = toRad(lo2-lo1), r1 = toRad(la1), r2 = toRad(la2);
  return (toDeg(Math.atan2(Math.sin(dL)*Math.cos(r2), Math.cos(r1)*Math.sin(r2)-Math.sin(r1)*Math.cos(r2)*Math.cos(dL)))+360)%360;
}
function dirLabel(b) { return ['N','NE','E','SE','S','SW','W','NW','N'][Math.round(b/45)]; }
function fmtDist(d)  { return d < 1 ? Math.round(d*1000)+'m' : d.toFixed(1)+'km'; }

// ── UI helpers ────────────────────────────────────────────────
function setStatus(txt, col) {
  document.getElementById('status-text').textContent = txt;
  document.getElementById('status-dot').style.background = col || '#333';
}
function showErr(msg) {
  const el = document.getElementById('err-box');
  el.textContent = msg; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 6000);
}
function updateCompass(b) {
  const rel = (b - compassHeading + 360) % 360;
  document.getElementById('bearing-arrow').style.transform = `rotate(${rel}deg)`;
  document.getElementById('bearing-arrow').style.display   = '';
  document.getElementById('compass-wrap').classList.add('active');
  document.getElementById('i-bearing').textContent = Math.round(b) + '°';
}
function setHdrCoords(lat, lng) {
  document.getElementById('hdr-lat').textContent = 'LAT ' + lat.toFixed(4);
  document.getElementById('hdr-lng').textContent = 'LNG ' + lng.toFixed(4);
}

// ── Skeleton ──────────────────────────────────────────────────
function showSkeleton() {
  ['skel-photo','skel-title','skel-meta'].forEach(id => document.getElementById(id).classList.add('on'));
  document.getElementById('store-title').style.display = 'none';
  document.getElementById('store-meta').style.display  = 'none';
}
function hideSkeleton() {
  ['skel-photo','skel-title','skel-meta'].forEach(id => document.getElementById(id).classList.remove('on'));
  document.getElementById('store-title').style.display = '';
  document.getElementById('store-meta').style.display  = '';
}

// ── Photo ─────────────────────────────────────────────────────
function loadPhoto(photoRef) {
  const img = document.getElementById('store-photo');
  const ph  = document.getElementById('photo-placeholder');
  img.style.display = 'none'; ph.style.display = 'flex'; img.src = '';
  if (!photoRef) return;
  img.onload  = () => { img.style.display = 'block'; ph.style.display = 'none'; };
  img.onerror = () => { img.style.display = 'none';  ph.style.display = 'flex'; };
  img.src = `/api/photo?ref=${encodeURIComponent(photoRef)}`;
}

// ── Hours ─────────────────────────────────────────────────────
function renderHours(weekdayText) {
  const list  = document.getElementById('hours-list');
  const today = new Date().getDay();
  list.innerHTML = '';
  weekdayText.forEach((line, i) => {
    const jsDayIdx = (i + 1) % 7;
    const [day, ...rest] = line.split(': ');
    const time = rest.join(': ') || 'Closed';
    const row  = document.createElement('div');
    row.className = 'hour-row' + (jsDayIdx === today ? ' today' : '');
    row.innerHTML = `<span class="day">${day}</span><span class="time">${time}</span>`;
    list.appendChild(row);
  });
}
function toggleHours() {
  const panel = document.getElementById('hours-panel');
  const badge = document.getElementById('open-badge');
  if (!document.getElementById('hours-list').children.length) return;
  panel.classList.toggle('open');
  badge.classList.toggle('expanded');
}

// ── Device orientation ────────────────────────────────────────
function onOrient(e) {
  compassHeading = e.webkitCompassHeading != null
    ? e.webkitCompassHeading
    : (360 - (e.alpha || 0)) % 360;
  document.getElementById('needle-group').style.transform = `rotate(${-compassHeading}deg)`;
  updateCompass(targetBearing);
  updateNavMap();
  drawMinimap();
}
function attachOrientation() {
  if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    DeviceOrientationEvent.requestPermission()
      .then(p => { if (p === 'granted') window.addEventListener('deviceorientation', onOrient); })
      .catch(() => window.addEventListener('deviceorientation', onOrient));
  } else {
    window.addEventListener('deviceorientation', onOrient);
  }
}

// ── Proximity Alert ───────────────────────────────────────────
function checkProximity(store) {
  if (!store) return;
  const isClose  = store.dist < 0.2; // 200m threshold
  const sameStore = lastAlertIdx === activeIdx;

  if (isClose && (!sameStore || !closeAlertShown)) {
    lastAlertIdx = activeIdx;
    closeAlertShown = true;
    showCloseAlert(store);
  } else if (!isClose && sameStore && closeAlertShown) {
    closeAlertShown = false;
    hideCloseAlert();
  }
}
function showCloseAlert(store) {
  const el = document.getElementById('close-alert');
  document.getElementById('close-dist').textContent = Math.round(store.dist * 1000) + 'm away';
  el.classList.add('show');
  if (navigator.vibrate) navigator.vibrate([150, 80, 150, 80, 300]);
  const cw = document.getElementById('compass-wrap');
  cw.classList.add('close-pulse');
  setTimeout(() => cw.classList.remove('close-pulse'), 3000);
  setTimeout(hideCloseAlert, 6000);
}
function hideCloseAlert() {
  document.getElementById('close-alert').classList.remove('show');
}

// ── Live position update (watchPosition callback) ─────────────
function updateLivePosition(lat, lng) {
  userLat = lat; userLng = lng;
  setHdrCoords(lat, lng);

  if (!storesSearched) {
    storesSearched = true;
    setStatus('Searching nearby stores…', '#F5A833');
    fetchStores(lat, lng);
    return;
  }
  if (!stores.length) return;

  // Recalculate all distances + bearings live
  stores = stores.map(s => ({
    ...s,
    dist:    haversine(lat, lng, s.lat, s.lng),
    bearing: calcBearing(lat, lng, s.lat, s.lng),
  }));

  const active = stores[activeIdx];
  targetBearing = active.bearing;
  updateCompass(active.bearing);

  // Update distance + walk display
  document.getElementById('dist-val').textContent  = active.dist < 1 ? Math.round(active.dist * 1000) : active.dist.toFixed(1);
  document.getElementById('dist-unit').textContent = active.dist < 1 ? 'm' : 'km';
  document.getElementById('i-walk').textContent    = Math.round(active.dist * 13) + ' min';

  checkProximity(active);
  drawMinimap();
  updateNavMap();
  updateNavDistance();
  renderList();
}

// ── API: nearby stores ────────────────────────────────────────
async function fetchStores(lat, lng) {
  const btn = document.getElementById('locate-btn');
  try {
    const res  = await fetch(
      `https://${HOST}/maps/api/place/nearbysearch/json?location=${lat}%2C${lng}&radius=${searchRadius}&type=liquor_store`,
      { headers: HEADERS }
    );
    const data = await res.json();

    if (data.results?.length > 0) {
      stores = data.results.slice(0, 5).map(p => ({
        name:     p.name,
        lat:      p.geometry.location.lat,
        lng:      p.geometry.location.lng,
        dist:     haversine(lat, lng, p.geometry.location.lat, p.geometry.location.lng),
        bearing:  calcBearing(lat, lng, p.geometry.location.lat, p.geometry.location.lng),
        rating:   p.rating   || null,
        placeId:  p.place_id || null,
        photoRef: p.photos?.[0]?.photo_reference || null,
        isOpen:   p.opening_hours?.open_now ?? null,
      })).sort((a, b) => a.dist - b.dist);

      setStatus(`Live · ${stores.length} stores nearby`, '#CC0000');
      document.getElementById('status-dot').classList.add('active');
      document.getElementById('list-toggle').style.display = 'flex';
      stopScanning();
      initSwipe();
      activateStore(0);
      fetchDetails(0);
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-radar"></i> Live Tracking';
    } else {
      hideSkeleton();
      stopScanning();
      setStatus('No stores found — try larger radius', '#FF5C7A');
      showErr('Increase the range above and tap Retry.');
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
    }
  } catch (err) {
    hideSkeleton();
    stopScanning();
    setStatus('API error — demo mode', '#F5A833');
    showErr('RapidAPI: ' + err.message);
    demoMode(lat, lng);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
  }
}

// ── API: place details ────────────────────────────────────────
async function fetchDetails(idx) {
  const s = stores[idx];
  if (!s?.placeId) { hideSkeleton(); return; }
  try {
    const res  = await fetch(
      `https://${HOST}/maps/api/place/details/json?place_id=${s.placeId}&fields=formatted_phone_number,opening_hours,photos`,
      { headers: HEADERS }
    );
    const data = await res.json();
    const d    = data.result || {};
    hideSkeleton();
    if (idx !== activeIdx) return;

    if (d.formatted_phone_number) {
      const btn = document.getElementById('btn-call');
      btn.href = 'tel:' + d.formatted_phone_number.replace(/\s/g, '');
      btn.className = 'action-btn call';
    }
    if (d.opening_hours) {
      const open  = d.opening_hours.open_now;
      const badge = document.getElementById('open-badge');
      badge.className = open ? 'open' : 'closed';
      badge.style.display = 'flex';
      document.getElementById('open-txt').textContent          = open ? 'Open now' : 'Closed';
      document.getElementById('store-hours-short').textContent = open ? 'Open now' : 'Closed';
      document.getElementById('store-hours-short').style.color = open ? '#1DB87A' : '#FF5C7A';
      stores[idx].isOpen = open;
      if (d.opening_hours.weekday_text?.length) renderHours(d.opening_hours.weekday_text);
      renderList();
    }
    const betterRef = d.photos?.[0]?.photo_reference;
    if (betterRef) loadPhoto(betterRef);
  } catch { hideSkeleton(); }
}

// ── Activate store ────────────────────────────────────────────
function activateStore(idx) {
  activeIdx = idx;
  const s = stores[idx];
  targetBearing = s.bearing;
  updateCompass(s.bearing);
  showSkeleton();

  document.getElementById('hours-panel').classList.remove('open');
  document.getElementById('open-badge').classList.remove('expanded');
  document.getElementById('hours-list').innerHTML = '';

  document.getElementById('store-title').textContent = s.name;
  document.getElementById('store-title').style.color = '#F2EEF2';

  document.getElementById('dist-val').textContent  = s.dist < 1 ? Math.round(s.dist*1000) : s.dist.toFixed(1);
  document.getElementById('dist-unit').textContent = s.dist < 1 ? 'm' : 'km';
  document.getElementById('i-walk').textContent    = Math.round(s.dist*13) + ' min';
  document.getElementById('i-rating').textContent  = s.rating || '—';
  document.getElementById('store-rating').textContent = s.rating ? '★'.repeat(Math.round(s.rating)) + '  ' + s.rating : '';

  document.getElementById('open-badge').style.display      = 'none';
  document.getElementById('open-badge').className          = '';
  document.getElementById('store-hours-short').textContent = '';

  const dirBtn = document.getElementById('btn-dir');
  dirBtn.className = 'action-btn dir';
  dirBtn.href      = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;

  const callBtn = document.getElementById('btn-call');
  callBtn.className = 'action-btn call off';
  callBtn.href      = '#';

  updateFavBtn();
  loadPhoto(s.photoRef);
  renderList();
  drawMinimap();
  updateDots();
}

// ── Store list ────────────────────────────────────────────────
function renderList() {
  const el   = document.getElementById('store-list');
  const favs = getFavs();
  el.innerHTML = '';
  stores.forEach((s, i) => {
    const div    = document.createElement('div');
    div.className = 'sl-item' + (i === activeIdx ? ' active' : '');
    const badge  = s.isOpen === true  ? '<span class="sl-badge open">Open</span>'
                 : s.isOpen === false ? '<span class="sl-badge closed">Closed</span>' : '';
    const faved  = isFav(s.placeId);
    div.innerHTML = `
      <span class="sl-num">${i+1}</span>
      <div style="flex:1">
        <div class="sl-name">${s.name}</div>
        <div class="sl-meta">${fmtDist(s.dist)} · ${dirLabel(s.bearing)}${s.rating ? ' · ★'+s.rating : ''}</div>
      </div>
      ${badge}
      <button class="sl-fav${faved?' on':''}" onclick="event.stopPropagation();quickFav('${s.placeId}','${s.name.replace(/'/g,'\\\'')}')" title="Favourite">
        <i class="ti ti-heart${faved?'-filled':''}"></i>
      </button>`;
    div.onclick = () => { activateStore(i); fetchDetails(i); };
    el.appendChild(div);
  });
}

function quickFav(placeId, name) {
  if (!placeId || placeId === 'null') return;
  let favs = getFavs();
  const idx = favs.findIndex(f => f.id === placeId);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push({ id: placeId, name });
  saveFavs(favs);
  updateFavBtn();
  renderList();
}

function toggleList() {
  const el   = document.getElementById('store-list');
  const open = el.style.display === 'flex';
  el.style.display = open ? 'none' : 'flex';
  document.getElementById('list-txt').textContent = open ? 'Show nearby targets' : 'Hide store list';
}

// ── Start locating (watchPosition) ───────────────────────────
function startLocating() {
  // Clear any existing watch
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  storesSearched    = false;
  closeAlertShown   = false;
  lastAlertIdx      = -1;

  const btn = document.getElementById('locate-btn');
  btn.disabled  = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Acquiring Signal…';
  setStatus('Getting your location…', '#F5A833');
  document.getElementById('err-box').style.display = 'none';
  startScanning();

  if (!navigator.geolocation) {
    setStatus('Geolocation not supported', '#FF5C7A');
    btn.disabled = false; return;
  }

  watchId = navigator.geolocation.watchPosition(
    pos => {
      updateLivePosition(pos.coords.latitude, pos.coords.longitude);
      attachOrientation();
    },
    () => {
      if (!storesSearched) {
        setStatus('Location denied — demo mode', '#F5A833');
        btn.disabled  = false;
        btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
        demoMode();
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

// ── Swipe between stores ──────────────────────────────────────
function initSwipe() {
  const card    = document.getElementById('store-card');
  const overlay = document.getElementById('photo-overlay');
  if (!card || card._swipeInit) return;
  card._swipeInit = true;

  card.addEventListener('touchstart', e => {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeLocked = false;
    overlay.style.transition = 'none';
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    if (swipeLocked || !stores.length) return;
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;
    if (Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx)) return;
    overlay.style.transition = 'none';
    overlay.style.transform  = `translateX(${dx * 0.25}px)`;
  }, { passive: true });

  card.addEventListener('touchend', e => {
    if (swipeLocked || !stores.length) return;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;

    overlay.style.transition = 'transform 0.18s ease, opacity 0.18s ease';
    overlay.style.transform  = 'translateX(0)';

    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;

    if (dx < 0 && activeIdx < stores.length - 1) animateSwipe(activeIdx + 1, 'left');
    else if (dx > 0 && activeIdx > 0)             animateSwipe(activeIdx - 1, 'right');
  }, { passive: true });
}

function animateSwipe(newIdx, dir) {
  swipeLocked = true;
  const overlay = document.getElementById('photo-overlay');
  const exitX   = dir === 'left' ? '-45px' : '45px';
  const enterX  = dir === 'left' ? '45px'  : '-45px';

  overlay.style.transition = 'transform 0.18s ease, opacity 0.18s ease';
  overlay.style.transform  = `translateX(${exitX})`;
  overlay.style.opacity    = '0';

  setTimeout(() => {
    activateStore(newIdx);
    fetchDetails(newIdx);
    overlay.style.transition = 'none';
    overlay.style.transform  = `translateX(${enterX})`;
    overlay.style.opacity    = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
      overlay.style.transform  = 'translateX(0)';
      overlay.style.opacity    = '1';
      setTimeout(() => { swipeLocked = false; }, 240);
    }));
  }, 180);
}

function updateDots() {
  const el = document.getElementById('store-dots');
  if (!el) return;
  if (stores.length <= 1) { el.classList.remove('visible'); return; }
  el.classList.add('visible');
  el.innerHTML = '';
  stores.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'store-dot' + (i === activeIdx ? ' active' : '');
    dot.onclick   = () => {
      if (i === activeIdx || swipeLocked) return;
      animateSwipe(i, i > activeIdx ? 'left' : 'right');
    };
    el.appendChild(dot);
  });
}

// ── Scanning animation ────────────────────────────────────────
function startScanning() {
  isScanning = true; scanAngle = 0;
  document.getElementById('compass-wrap').classList.add('scanning');
  if (scanFrameId) cancelAnimationFrame(scanFrameId);
  animateScan();
}
function stopScanning() {
  isScanning = false;
  document.getElementById('compass-wrap').classList.remove('scanning');
  if (scanFrameId) { cancelAnimationFrame(scanFrameId); scanFrameId = null; }
  drawMinimap();
}
function animateScan() {
  if (!isScanning) return;
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W/2, cy = H/2, R = W/2 - 1;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.clip();
  ctx.fillStyle = '#0c0408'; ctx.fillRect(0, 0, W, H);

  // Grid rings
  [22, 45, 68].forEach(r => {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,30,30,0.08)'; ctx.lineWidth = 0.7; ctx.stroke();
  });
  ctx.strokeStyle = 'rgba(255,30,30,0.06)'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(cx,cy-R); ctx.lineTo(cx,cy+R); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx-R,cy); ctx.lineTo(cx+R,cy); ctx.stroke();

  // Sweep trail
  ctx.save();
  ctx.translate(cx, cy);
  const trail = 1.4, steps = 36;
  for (let i = 0; i < steps; i++) {
    const a  = scanAngle - (i/steps)*trail;
    const op = (1 - i/steps) * 0.32;
    ctx.beginPath(); ctx.moveTo(0,0);
    ctx.arc(0, 0, R-1, a, a + trail/steps + 0.01);
    ctx.closePath();
    ctx.fillStyle = `rgba(170,0,0,${op})`; ctx.fill();
  }
  // Leading line
  ctx.beginPath(); ctx.moveTo(0,0);
  ctx.lineTo((R-1)*Math.cos(scanAngle), (R-1)*Math.sin(scanAngle));
  ctx.strokeStyle = 'rgba(220,20,20,0.9)'; ctx.lineWidth = 1.8;
  ctx.shadowColor = 'rgba(200,0,0,0.5)'; ctx.shadowBlur = 5; ctx.stroke();
  ctx.restore();

  // Blinking center dot
  const blink = Math.sin(Date.now()/260) > 0;
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI*2);
  ctx.fillStyle = blink ? '#3490D8' : 'rgba(52,144,216,0.25)'; ctx.fill();

  // Scanning text
  ctx.fillStyle = 'rgba(180,0,0,0.38)';
  ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('SCANNING', cx, cy + 19);

  // N label
  ctx.fillStyle = '#BB0000'; ctx.font = 'bold 9px sans-serif'; ctx.textBaseline = 'top';
  ctx.fillText('N', cx, 5);

  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(160,0,0,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();

  scanAngle += 0.04;
  scanFrameId = requestAnimationFrame(animateScan);
}

// ── Navigate mode (Pokémon Go style map) ─────────────────────
let navMap = null, navUserMarker = null, navStoreMarker = null, navRouteLine = null;

function makeUserIcon(heading) {
  return L.divIcon({
    className: '',
    html: `<div class="nav-user-wrap">
      <div class="nav-user-cone" style="transform:rotate(${heading}deg)"></div>
      <div class="nav-user-dot"></div>
    </div>`,
    iconSize: [50, 50], iconAnchor: [25, 25],
  });
}
function makeStoreIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="nav-store-wrap">
      <div class="nav-store-pulse"></div>
      <div class="nav-store-dot"><i class="ti ti-bottle"></i></div>
    </div>`,
    iconSize: [44, 44], iconAnchor: [22, 22],
  });
}

function initNavMap() {
  const lat = userLat || 20.0059, lng = userLng || 73.7898;
  const s   = stores[activeIdx];
  if (!s) return;

  if (!navMap) {
    navMap = L.map('nav-map', {
      center: [lat, lng], zoom: 17,
      zoomControl: false, attributionControl: false,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd',
    }).addTo(navMap);

    navUserMarker  = L.marker([lat, lng],    { icon: makeUserIcon(compassHeading), zIndexOffset: 1000 }).addTo(navMap);
    navStoreMarker = L.marker([s.lat, s.lng], { icon: makeStoreIcon() }).addTo(navMap);
    navRouteLine   = L.polyline([[lat, lng], [s.lat, s.lng]], {
      color: '#CC0000', weight: 2.5, opacity: 0.45, dashArray: '7 10',
    }).addTo(navMap);

    navMap.fitBounds([[lat, lng], [s.lat, s.lng]], { padding: [60, 60] });
  } else {
    // Update for new store
    navUserMarker.setLatLng([lat, lng]).setIcon(makeUserIcon(compassHeading));
    navStoreMarker.setLatLng([s.lat, s.lng]);
    navRouteLine.setLatLngs([[lat, lng], [s.lat, s.lng]]);
    navMap.fitBounds([[lat, lng], [s.lat, s.lng]], { padding: [60, 60] });
  }
  setTimeout(() => navMap?.invalidateSize(), 320);
}

function updateNavMap() {
  if (!navMap || !navUserMarker) return;
  const lat = userLat || 20.0059, lng = userLng || 73.7898;
  const s   = stores[activeIdx];
  navUserMarker.setLatLng([lat, lng]).setIcon(makeUserIcon(compassHeading));
  if (s && navRouteLine) navRouteLine.setLatLngs([[lat, lng], [s.lat, s.lng]]);
  // Keep user in view
  if (navMap.getBounds && !navMap.getBounds().contains([lat, lng])) {
    navMap.panTo([lat, lng], { animate: true, duration: 0.4 });
  }
}

function enterNavMode() {
  const s = stores[activeIdx];
  if (!s) return;
  document.getElementById('nav-store-name').textContent = s.name;
  const parts = [s.rating ? '★ ' + s.rating : '', s.isOpen === true ? 'Open now' : s.isOpen === false ? 'Closed' : ''].filter(Boolean);
  document.getElementById('nav-store-meta').textContent = parts.join(' · ');
  updateNavDistance();
  document.getElementById('nav-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(initNavMap, 350);
}

function exitNavMode() {
  document.getElementById('nav-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

function updateNavDistance() {
  const overlay = document.getElementById('nav-overlay');
  if (!overlay?.classList.contains('active')) return;
  const s = stores[activeIdx]; if (!s) return;
  const dv  = document.getElementById('nav-dist-val');
  const dl  = document.getElementById('nav-dist-lbl');
  const wv  = document.getElementById('nav-walk-val');
  const bt  = document.getElementById('nav-bearing-text');
  const dt  = document.getElementById('nav-dir-text');
  if (dv) dv.textContent = s.dist < 1 ? Math.round(s.dist * 1000) : s.dist.toFixed(2);
  if (dl) dl.textContent = s.dist < 1 ? 'm away' : 'km away';
  if (wv) wv.textContent = Math.round(s.dist * 13) + ' min';
  if (bt) bt.textContent = Math.round(s.bearing) + '°';
  if (dt) dt.textContent = dirLabel(s.bearing);
}

// ── Minimap ───────────────────────────────────────────────────
function drawMinimap() {
  if (!stores.length) return;
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W   = canvas.width, H = canvas.height;
  const cx  = W/2, cy = H/2, R = W/2 - 1;
  const lat = userLat || 20.0059, lng = userLng || 73.7898;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.clip();

  ctx.fillStyle = '#0c0408'; ctx.fillRect(0, 0, W, H);

  const maxDistKm = Math.max(...stores.map(s => s.dist), 0.3) * 1.3;
  const scale     = (R * 0.80) / maxDistKm;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-toRad(compassHeading));
  ctx.translate(-cx, -cy);

  [0.2, 0.5, 1, 2, 5].forEach(km => {
    const r = km * scale;
    if (r >= R) return;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,30,30,0.09)'; ctx.lineWidth = 0.7; ctx.stroke();
  });

  ctx.strokeStyle = 'rgba(255,30,30,0.07)'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(cx, cy-R); ctx.lineTo(cx, cy+R); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx-R, cy); ctx.lineTo(cx+R, cy); ctx.stroke();

  const cosLat = Math.cos(toRad(lat));
  stores.forEach((s, i) => {
    const dxKm = (s.lng - lng) * 111 * cosLat;
    const dyKm = (s.lat - lat) * 111;
    let px = cx + dxKm * scale, py = cy - dyKm * scale;
    const d = Math.sqrt((px-cx)**2 + (py-cy)**2);
    if (d > R-9) { const a = Math.atan2(py-cy, px-cx); px = cx+(R-9)*Math.cos(a); py = cy+(R-9)*Math.sin(a); }

    const active = i === activeIdx;
    if (active) {
      ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(200,0,0,0.18)'; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI*2);
      ctx.fillStyle = '#DD0000'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,140,140,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI*2);
      ctx.fillStyle = isFav(s.placeId) ? '#FF5C7A' : 'rgba(170,50,50,0.65)'; ctx.fill();
    }
    ctx.fillStyle = active ? '#fff' : 'rgba(255,255,255,0.3)';
    ctx.font = active ? 'bold 7px sans-serif' : '7px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(i+1, px, py-7);
  });

  ctx.restore();

  ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(59,158,232,0.15)'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI*2);
  ctx.fillStyle = '#3B9EE8'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();

  ctx.fillStyle = '#BB0000'; ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('N', cx, 5);

  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(160,0,0,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
}

// ── Demo mode ─────────────────────────────────────────────────
function demoMode(lat, lng) {
  const bLat = lat || 20.0059, bLng = lng || 73.7898;
  stores = [
    { name:'Nashik Wine Depot',   dlat: 0.012, dlng: 0.008, rating:4.2, isOpen:true  },
    { name:'Grape & Grain Wines', dlat:-0.005, dlng: 0.015, rating:4.5, isOpen:false },
    { name:'City Liquor Shop',    dlat: 0.009, dlng:-0.011, rating:3.9, isOpen:true  },
  ].map(s => ({
    name:s.name, rating:s.rating, isOpen:s.isOpen,
    lat:bLat+s.dlat, lng:bLng+s.dlng,
    dist:    haversine(bLat,bLng,bLat+s.dlat,bLng+s.dlng),
    bearing: calcBearing(bLat,bLng,bLat+s.dlat,bLng+s.dlng),
    placeId:null, photoRef:null,
  }));

  const demoHours = [
    'Monday: 10:00 AM – 10:00 PM','Tuesday: 10:00 AM – 10:00 PM',
    'Wednesday: 10:00 AM – 10:00 PM','Thursday: 10:00 AM – 10:00 PM',
    'Friday: 10:00 AM – 11:00 PM','Saturday: 10:00 AM – 11:00 PM','Sunday: Closed',
  ];

  setStatus('Demo mode · 3 stores shown', '#CC0000');
  document.getElementById('status-dot').classList.add('active');
  document.getElementById('list-toggle').style.display = 'flex';
  activateStore(0); hideSkeleton(); stopScanning();
  initSwipe();

  const badge = document.getElementById('open-badge');
  badge.className = 'open'; badge.style.display = 'flex';
  document.getElementById('open-txt').textContent          = 'Open now';
  document.getElementById('store-hours-short').textContent = 'Open now';
  document.getElementById('store-hours-short').style.color = '#1DB87A';
  document.getElementById('btn-dir').className = 'action-btn dir';
  renderHours(demoHours);

  if (demoTimer) clearInterval(demoTimer);
  let deg = 0;
  demoTimer = setInterval(() => {
    deg = (deg+1)%360; compassHeading = deg;
    document.getElementById('needle-group').style.transform =
      `rotate(${-deg + Math.sin(Date.now()/700)*2}deg)`;
    updateCompass(targetBearing);
    updateNavCompass(targetBearing);
    drawMinimap();
  }, 40);

  const btn = document.getElementById('locate-btn');
  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-current-location"></i> Retry with Location';
}