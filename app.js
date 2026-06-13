// ── Config ───────────────────────────────────────────────────
const KEY     = 'd2e7549f2dmsh60ea559d8ec69e5p1199f5jsnbb7bcc8a8a0c';
const HOST    = 'google-map-places.p.rapidapi.com';
const HEADERS = { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST };

// ── State ────────────────────────────────────────────────────
let compassHeading = 0, targetBearing = 0, demoTimer = null;
let stores = [], activeIdx = 0, deferredPrompt = null;

// ── PWA Install ──────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
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
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Math ─────────────────────────────────────────────────────
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

function haversine(la1, lo1, la2, lo2) {
  const R = 6371, dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
  const a = Math.sin(dLa/2)**2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function calcBearing(la1, lo1, la2, lo2) {
  const dL = toRad(lo2 - lo1), r1 = toRad(la1), r2 = toRad(la2);
  return (toDeg(Math.atan2(Math.sin(dL)*Math.cos(r2), Math.cos(r1)*Math.sin(r2) - Math.sin(r1)*Math.cos(r2)*Math.cos(dL))) + 360) % 360;
}
function dirLabel(b) { return ['N','NE','E','SE','S','SW','W','NW','N'][Math.round(b / 45)]; }
function fmtDist(d)  { return d < 1 ? Math.round(d * 1000) + 'm' : d.toFixed(1) + 'km'; }

// ── UI helpers ───────────────────────────────────────────────
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

// ── Device orientation ───────────────────────────────────────
function onOrient(e) {
  compassHeading = e.webkitCompassHeading != null
    ? e.webkitCompassHeading
    : (360 - (e.alpha || 0)) % 360;
  document.getElementById('needle-group').style.transform = `rotate(${-compassHeading}deg)`;
  updateCompass(targetBearing);
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

// ── Photo loader ─────────────────────────────────────────────
// Points img.src directly at our /api/photo proxy (Vercel serverless).
// No client-side fetch needed — the browser loads it like any image URL.
function loadPhoto(photoRef) {
  const img         = document.getElementById('store-photo');
  const placeholder = document.getElementById('photo-placeholder');

  if (!photoRef) {
    img.style.display         = 'none';
    placeholder.style.display = 'flex';
    return;
  }

  // Reset display while loading
  img.style.display         = 'none';
  placeholder.style.display = 'flex';
  img.src = '';

  img.onload = () => {
    img.style.display         = 'block';
    placeholder.style.display = 'none';
  };
  img.onerror = () => {
    img.style.display         = 'none';
    placeholder.style.display = 'flex';
  };

  // /api/photo is the Vercel serverless proxy that adds RapidAPI headers server-side
  img.src = `/api/photo?ref=${encodeURIComponent(photoRef)}`;
}

// ── API: nearby stores ───────────────────────────────────────
async function fetchStores(lat, lng) {
  const btn = document.getElementById('locate-btn');
  try {
    const res  = await fetch(
      `https://${HOST}/maps/api/place/nearbysearch/json?location=${lat}%2C${lng}&radius=3000&type=liquor_store`,
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

      setStatus(`Found ${stores.length} store(s) nearby`, '#22C77A');
      document.getElementById('list-toggle').style.display = 'flex';
      activateStore(0);               // show immediately with nearbysearch data
      fetchDetails(0);                // enrich in background (phone, hours, better photo)
      btn.innerHTML = '<i class="ti ti-refresh"></i> Refresh';
    } else {
      setStatus('No stores found within 3 km', '#FF5C7A');
      showErr('Try moving to a different area and tapping Refresh.');
      btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
    }
  } catch (err) {
    setStatus('API error — showing demo', '#F5A833');
    showErr('RapidAPI call failed: ' + err.message);
    demoMode(lat, lng);
    btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
  }
  btn.disabled = false;
}

// ── API: place details ───────────────────────────────────────
async function fetchDetails(idx) {
  const s = stores[idx];
  if (!s?.placeId) return;
  try {
    const res  = await fetch(
      `https://${HOST}/maps/api/place/details/json?place_id=${s.placeId}&fields=formatted_phone_number,opening_hours,photos`,
      { headers: HEADERS }
    );
    const data = await res.json();
    const d    = data.result || {};

    // Only update UI if this store is still active
    if (idx !== activeIdx) return;

    // Phone number → enable Call button
    if (d.formatted_phone_number) {
      const btn = document.getElementById('btn-call');
      btn.href      = 'tel:' + d.formatted_phone_number.replace(/\s/g, '');
      btn.className = 'action-btn call';
    }

    // Opening hours → badge + subtitle
    if (d.opening_hours != null) {
      const open  = d.opening_hours.open_now;
      const badge = document.getElementById('open-badge');
      badge.className     = open ? 'open' : 'closed';
      badge.style.display = 'flex';
      document.getElementById('open-txt').textContent          = open ? 'Open now' : 'Closed';
      document.getElementById('store-hours-short').textContent = open ? 'Open now' : 'Closed';
      document.getElementById('store-hours-short').style.color = open ? '#22C77A' : '#FF5C7A';
      stores[idx].isOpen = open;
      renderList();
    }

    // Better quality photo from details endpoint
    const betterRef = d.photos?.[0]?.photo_reference;
    if (betterRef) loadPhoto(betterRef);

  } catch { /* silently ignore */ }
}

// ── Activate store ───────────────────────────────────────────
function activateStore(idx) {
  activeIdx = idx;
  const s = stores[idx];
  targetBearing = s.bearing;
  updateCompass(s.bearing);

  // Store title
  const titleEl = document.getElementById('store-title');
  titleEl.textContent = s.name;
  titleEl.style.color = '#F0EDF8';

  // Distance + walk time
  document.getElementById('dist-val').textContent  = s.dist < 1 ? Math.round(s.dist * 1000) : s.dist.toFixed(1);
  document.getElementById('dist-unit').textContent = s.dist < 1 ? 'm away' : 'km away';
  document.getElementById('i-walk').textContent    = Math.round(s.dist * 13) + ' min';
  document.getElementById('i-rating').textContent  = s.rating || '—';

  // Rating stars
  document.getElementById('store-rating').textContent = s.rating
    ? '★'.repeat(Math.round(s.rating)) + '  ' + s.rating : '';

  // Reset open badge + hours text (fetchDetails will fill these)
  document.getElementById('open-badge').style.display      = 'none';
  document.getElementById('open-badge').className          = '';
  document.getElementById('store-hours-short').textContent = '';

  // Directions always available
  const dirBtn  = document.getElementById('btn-dir');
  dirBtn.className = 'action-btn dir';
  dirBtn.href      = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;

  // Call disabled until details load
  const callBtn  = document.getElementById('btn-call');
  callBtn.className = 'action-btn call off';
  callBtn.href      = '#';

  // Load photo from nearbysearch ref straight away
  loadPhoto(s.photoRef);

  renderList();
}

// ── Store list ───────────────────────────────────────────────
function renderList() {
  const el = document.getElementById('store-list');
  el.innerHTML = '';
  stores.forEach((s, i) => {
    const div   = document.createElement('div');
    div.className = 'sl-item' + (i === activeIdx ? ' active' : '');
    const badge = s.isOpen === true  ? '<span class="sl-badge open">Open</span>'
                : s.isOpen === false ? '<span class="sl-badge closed">Closed</span>'
                : '';
    div.innerHTML = `
      <span class="sl-num">${i + 1}</span>
      <div>
        <div class="sl-name">${s.name}</div>
        <div class="sl-meta">${fmtDist(s.dist)} · ${dirLabel(s.bearing)}${s.rating ? ' · ★' + s.rating : ''}</div>
      </div>
      ${badge}`;
    div.onclick = () => { activateStore(i); fetchDetails(i); };
    el.appendChild(div);
  });
}

function toggleList() {
  const el   = document.getElementById('store-list');
  const open = el.style.display === 'flex';
  el.style.display = open ? 'none' : 'flex';
  document.getElementById('list-txt').textContent = open ? 'Show nearby stores' : 'Hide store list';
}

// ── Start locating ───────────────────────────────────────────
function startLocating() {
  const btn = document.getElementById('locate-btn');
  btn.disabled  = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Locating…';
  setStatus('Getting your location…', '#F5A833');
  document.getElementById('err-box').style.display = 'none';

  if (!navigator.geolocation) {
    setStatus('Geolocation not supported', '#FF5C7A');
    btn.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      setStatus('Searching nearby stores…', '#F5A833');
      fetchStores(pos.coords.latitude, pos.coords.longitude);
      attachOrientation();
    },
    () => {
      setStatus('Location denied — demo mode', '#F5A833');
      btn.disabled  = false;
      btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
      demoMode();
    },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

// ── Demo mode ─────────────────────────────────────────────────
function demoMode(lat, lng) {
  const bLat = lat || 20.0059, bLng = lng || 73.7898;
  stores = [
    { name: 'Nashik Wine Depot',   dlat:  0.012, dlng:  0.008, rating: 4.2, isOpen: true  },
    { name: 'Grape & Grain Wines', dlat: -0.005, dlng:  0.015, rating: 4.5, isOpen: false },
    { name: 'City Liquor Shop',    dlat:  0.009, dlng: -0.011, rating: 3.9, isOpen: true  },
  ].map(s => ({
    name:     s.name,
    lat:      bLat + s.dlat,
    lng:      bLng + s.dlng,
    dist:     haversine(bLat, bLng, bLat + s.dlat, bLng + s.dlng),
    bearing:  calcBearing(bLat, bLng, bLat + s.dlat, bLng + s.dlng),
    rating:   s.rating,
    isOpen:   s.isOpen,
    placeId:  null,
    photoRef: null,
  }));

  setStatus('Demo mode — 3 stores shown', '#22C77A');
  document.getElementById('list-toggle').style.display = 'flex';
  activateStore(0);

  // Show open badge for demo
  const badge = document.getElementById('open-badge');
  badge.className = 'open'; badge.style.display = 'flex';
  document.getElementById('open-txt').textContent = 'Open now';
  document.getElementById('store-hours-short').textContent = 'Open now';
  document.getElementById('store-hours-short').style.color = '#22C77A';

  if (demoTimer) clearInterval(demoTimer);
  let deg = 0;
  demoTimer = setInterval(() => {
    deg = (deg + 1) % 360;
    compassHeading = deg;
    document.getElementById('needle-group').style.transform =
      `rotate(${-deg + Math.sin(Date.now() / 700) * 2}deg)`;
    updateCompass(targetBearing);
  }, 40);

  const btn = document.getElementById('locate-btn');
  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-current-location"></i> Retry with Location';
}
