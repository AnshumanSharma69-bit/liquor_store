// ── Config ──────────────────────────────────────────────────
const KEY  = 'd2e7549f2dmsh60ea559d8ec69e5p1199f5jsnbb7bcc8a8a0c';
const HOST = 'google-map-places.p.rapidapi.com';
const HEADERS = { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST };

// ── State ────────────────────────────────────────────────────
let compassHeading = 0, targetBearing = 0, demoTimer = null;
let stores = [], activeIdx = 0;
let deferredPrompt = null;
const blobURLs = [];

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

// ── Math helpers ─────────────────────────────────────────────
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

function haversine(la1, lo1, la2, lo2) {
  const R = 6371, dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function calcBearing(la1, lo1, la2, lo2) {
  const dL = toRad(lo2 - lo1), r1 = toRad(la1), r2 = toRad(la2);
  return (toDeg(Math.atan2(Math.sin(dL) * Math.cos(r2), Math.cos(r1) * Math.sin(r2) - Math.sin(r1) * Math.cos(r2) * Math.cos(dL))) + 360) % 360;
}
function dirLabel(b) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'][Math.round(b / 45)];
}
function fmtDist(d) {
  return d < 1 ? Math.round(d * 1000) + 'm' : d.toFixed(1) + 'km';
}

// ── UI helpers ───────────────────────────────────────────────
function setStatus(txt, col) {
  document.getElementById('status-text').textContent = txt;
  document.getElementById('status-dot').style.background = col || '#333';
}
function showErr(msg) {
  const el = document.getElementById('err-box');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 6000);
}
function updateCompass(b) {
  const rel = (b - compassHeading + 360) % 360;
  document.getElementById('bearing-arrow').style.transform = `rotate(${rel}deg)`;
  document.getElementById('bearing-arrow').style.display = '';
  document.getElementById('compass-wrap').classList.add('active');
  document.getElementById('i-bearing').textContent = Math.round(b) + '°';
}

// ── Compass orientation ──────────────────────────────────────
function onOrient(e) {
  compassHeading = e.webkitCompassHeading != null
    ? e.webkitCompassHeading
    : (360 - (e.alpha || 0)) % 360;
  document.getElementById('needle-group').style.transform = `rotate(${-compassHeading}deg)`;
  updateCompass(targetBearing);
}

// ── API calls ────────────────────────────────────────────────
async function fetchPhoto(ref) {
  try {
    // Use our Vercel serverless proxy to avoid CORS issues
    const proxyUrl = `/api/photo?ref=${encodeURIComponent(ref)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image')) return null;
    return proxyUrl; // use directly as img src — already proxied
  } catch { return null; }
}

async function fetchDetails(placeId) {
  try {
    const res = await fetch(
      `https://${HOST}/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,opening_hours,website,photos`,
      { headers: HEADERS }
    );
    const data = await res.json();
    return data.result || {};
  } catch { return {}; }
}

async function fetchStores(lat, lng) {
  const btn = document.getElementById('locate-btn');
  try {
    const res = await fetch(
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
        rating:   p.rating || null,
        placeId:  p.place_id,
        photoRef: p.photos?.[0]?.photo_reference || null,
        isOpen:   p.opening_hours?.open_now ?? null,
      })).sort((a, b) => a.dist - b.dist);

      setStatus(`Found ${stores.length} store(s) nearby`, '#22C77A');
      document.getElementById('list-toggle').style.display = 'flex';
      await activateStore(0);
      btn.innerHTML = '<i class="ti ti-refresh"></i> Refresh';
    } else {
      setStatus('No stores found within 3 km', '#FF5C7A');
      showErr('Try moving to a different area and tapping Refresh.');
      btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
    }
  } catch (err) {
    setStatus('API error — showing demo', '#F5A833');
    showErr('API call failed: ' + err.message);
    demoMode(lat, lng);
    btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
  }
  btn.disabled = false;
}

// ── Activate a store ─────────────────────────────────────────
async function activateStore(idx) {
  activeIdx = idx;
  const s = stores[idx];
  targetBearing = s.bearing;
  updateCompass(s.bearing);

  // Immediate info
  const titleEl = document.getElementById('store-title');
  titleEl.textContent = s.name;
  titleEl.style.color = '#F0EDF8';

  document.getElementById('dist-val').textContent  = s.dist < 1 ? Math.round(s.dist * 1000) : s.dist.toFixed(1);
  document.getElementById('dist-unit').textContent = s.dist < 1 ? 'm away' : 'km away';
  document.getElementById('i-walk').textContent    = Math.round(s.dist * 13) + ' min';
  document.getElementById('i-rating').textContent  = s.rating || '—';

  const ratingEl = document.getElementById('store-rating');
  ratingEl.textContent = s.rating ? '★'.repeat(Math.round(s.rating)) + '  ' + s.rating : '';
  ratingEl.style.color = '#F5A833';

  // Reset photo
  document.getElementById('store-photo').style.display = 'none';
  document.getElementById('photo-placeholder').style.display = 'flex';
  document.getElementById('open-badge').style.display = 'none';
  document.getElementById('open-badge').className = '';
  document.getElementById('store-hours-short').textContent = '';

  // Reset action buttons
  document.getElementById('btn-call').className = 'action-btn call off';
  document.getElementById('btn-call').href = '#';
  document.getElementById('btn-dir').className  = 'action-btn dir';
  document.getElementById('btn-dir').href = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
  document.getElementById('btn-web').className  = 'action-btn web off';
  document.getElementById('btn-web').href = '#';

  renderList();

  // Fetch full details
  if (!s.placeId) return;
  const details = await fetchDetails(s.placeId);

  // Phone
  if (details.formatted_phone_number) {
    document.getElementById('btn-call').href = 'tel:' + details.formatted_phone_number.replace(/\s/g, '');
    document.getElementById('btn-call').className = 'action-btn call';
  }

  // Website
  if (details.website) {
    document.getElementById('btn-web').href = details.website;
    document.getElementById('btn-web').className = 'action-btn web';
  }

  // Hours
  if (details.opening_hours) {
    const open = details.opening_hours.open_now;
    const badge = document.getElementById('open-badge');
    badge.className = open ? 'open' : 'closed';
    badge.style.display = 'flex';
    document.getElementById('open-txt').textContent = open ? 'Open now' : 'Closed';
    const hoursEl = document.getElementById('store-hours-short');
    hoursEl.textContent = open ? 'Open now' : 'Closed';
    hoursEl.style.color = open ? '#22C77A' : '#FF5C7A';
    stores[idx].isOpen = open;
    renderList();
  }

  // Photo
  const photoRef = details.photos?.[0]?.photo_reference || s.photoRef;
  if (photoRef) {
    const url = await fetchPhoto(photoRef);
    if (url) {
      const img = document.getElementById('store-photo');
      img.onerror = () => {
        img.style.display = 'none';
        document.getElementById('photo-placeholder').style.display = 'flex';
      };
      img.onload = () => {
        img.style.display = 'block';
        document.getElementById('photo-placeholder').style.display = 'none';
      };
      img.src = url;
    }
  }
}

// ── Store list ───────────────────────────────────────────────
function renderList() {
  const el = document.getElementById('store-list');
  el.innerHTML = '';
  stores.forEach((s, i) => {
    const div = document.createElement('div');
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
    div.onclick = () => activateStore(i);
    el.appendChild(div);
  });
}

function toggleList() {
  const el   = document.getElementById('store-list');
  const open = el.style.display === 'flex';
  el.style.display = open ? 'none' : 'flex';
  document.getElementById('list-txt').textContent = open ? 'Show nearby stores' : 'Hide store list';
}

// ── Locate ───────────────────────────────────────────────────
function startLocating() {
  const btn = document.getElementById('locate-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Locating…';
  setStatus('Getting your location…', '#F5A833');
  document.getElementById('err-box').style.display = 'none';

  if (!navigator.geolocation) {
    setStatus('Geolocation not supported', '#FF5C7A');
    btn.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(pos => {
    setStatus('Searching nearby stores…', '#F5A833');
    fetchStores(pos.coords.latitude, pos.coords.longitude);

    const attach = () => window.addEventListener('deviceorientation', onOrient);
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().then(p => { if (p === 'granted') attach(); }).catch(attach);
    } else {
      attach();
    }
  }, () => {
    setStatus('Location denied — demo mode', '#F5A833');
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
    demoMode();
  }, { timeout: 10000, enableHighAccuracy: true });
}

// ── Demo mode ────────────────────────────────────────────────
function demoMode(lat, lng) {
  const bLat = lat || 20.0059, bLng = lng || 73.7898;
  const raw = [
    { name: 'Nashik Wine Depot',   dlat:  0.012, dlng:  0.008, rating: 4.2, isOpen: true  },
    { name: 'Grape & Grain Wines', dlat: -0.005, dlng:  0.015, rating: 4.5, isOpen: false },
    { name: 'City Liquor Shop',    dlat:  0.009, dlng: -0.011, rating: 3.9, isOpen: true  },
  ];
  stores = raw.map(s => ({
    name:    s.name,
    lat:     bLat + s.dlat,
    lng:     bLng + s.dlng,
    dist:    haversine(bLat, bLng, bLat + s.dlat, bLng + s.dlng),
    bearing: calcBearing(bLat, bLng, bLat + s.dlat, bLng + s.dlng),
    rating:  s.rating,
    isOpen:  s.isOpen,
    placeId: null, photoRef: null,
  }));

  activeIdx = 0;
  setStatus('Demo mode — 3 stores shown', '#22C77A');
  document.getElementById('list-toggle').style.display = 'flex';

  const s = stores[0];
  targetBearing = s.bearing;
  document.getElementById('store-title').textContent = s.name;
  document.getElementById('store-title').style.color = '#F0EDF8';
  document.getElementById('dist-val').textContent  = s.dist.toFixed(1);
  document.getElementById('dist-unit').textContent = 'km away';
  document.getElementById('i-walk').textContent    = Math.round(s.dist * 13) + ' min';
  document.getElementById('i-rating').textContent  = s.rating;
  document.getElementById('store-rating').textContent = '★★★★ ' + s.rating;
  document.getElementById('store-rating').style.color = '#F5A833';
  document.getElementById('btn-dir').className = 'action-btn dir';
  document.getElementById('btn-dir').href = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;

  const badge = document.getElementById('open-badge');
  badge.className = 'open'; badge.style.display = 'flex';
  document.getElementById('open-txt').textContent = 'Open now';

  updateCompass(s.bearing);
  renderList();

  if (demoTimer) clearInterval(demoTimer);
  let deg = 0;
  demoTimer = setInterval(() => {
    deg = (deg + 1) % 360;
    compassHeading = deg;
    document.getElementById('needle-group').style.transform =
      `rotate(${-deg + Math.sin(Date.now() / 700) * 2}deg)`;
    updateCompass(targetBearing);
  }, 40);

  document.getElementById('locate-btn').disabled = false;
  document.getElementById('locate-btn').innerHTML = '<i class="ti ti-current-location"></i> Retry with Location';
}