// ── Config ───────────────────────────────────────────────────
const KEY     = 'd2e7549f2dmsh60ea559d8ec69e5p1199f5jsnbb7bcc8a8a0c';
const HOST    = 'google-map-places.p.rapidapi.com';
const HEADERS = { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST };
const DAYS    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ── State ─────────────────────────────────────────────────────
let compassHeading = 0, targetBearing = 0, demoTimer = null;
let stores = [], activeIdx = 0, deferredPrompt = null;
let searchRadius = 3000;   // default 3 km
let userLat = null, userLng = null;

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

// ── Radius selector ───────────────────────────────────────────
function setRadius(btn) {
  document.querySelectorAll('.rpill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  searchRadius = parseInt(btn.dataset.r, 10);
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

// ── Skeleton ──────────────────────────────────────────────────
function showSkeleton() {
  document.getElementById('skel-photo').classList.add('on');
  document.getElementById('skel-title').classList.add('on');
  document.getElementById('skel-meta').classList.add('on');
  document.getElementById('store-title').style.display = 'none';
  document.getElementById('store-meta').style.display  = 'none';
}
function hideSkeleton() {
  document.getElementById('skel-photo').classList.remove('on');
  document.getElementById('skel-title').classList.remove('on');
  document.getElementById('skel-meta').classList.remove('on');
  document.getElementById('store-title').style.display = '';
  document.getElementById('store-meta').style.display  = '';
}

// ── Photo loader ──────────────────────────────────────────────
function loadPhoto(photoRef) {
  const img         = document.getElementById('store-photo');
  const placeholder = document.getElementById('photo-placeholder');
  img.style.display = 'none';
  placeholder.style.display = 'flex';
  img.src = '';
  if (!photoRef) return;
  img.onload = () => { img.style.display = 'block'; placeholder.style.display = 'none'; };
  img.onerror = () => { img.style.display = 'none'; placeholder.style.display = 'flex'; };
  img.src = `/api/photo?ref=${encodeURIComponent(photoRef)}`;
}

// ── Weekly hours ──────────────────────────────────────────────
function renderHours(weekdayText) {
  const list    = document.getElementById('hours-list');
  const today   = new Date().getDay(); // 0 = Sunday
  list.innerHTML = '';

  // weekday_text starts Monday (index 0 = Monday in Google's format)
  // Reorder to match JS day (0 = Sunday)
  // Google: 0=Mon,1=Tue,...,6=Sun
  // JS:     0=Sun,1=Mon,...,6=Sat
  weekdayText.forEach((line, i) => {
    const googleDayIdx = i;                          // 0=Mon..6=Sun
    const jsDayIdx     = (i + 1) % 7;               // 0=Sun,1=Mon..6=Sat
    const isToday      = jsDayIdx === today;
    const [day, ...rest] = line.split(': ');
    const time = rest.join(': ') || 'Closed';
    const row  = document.createElement('div');
    row.className = 'hour-row' + (isToday ? ' today' : '');
    row.innerHTML = `<span class="day">${day}</span><span class="time">${time}</span>`;
    list.appendChild(row);
  });
}

function toggleHours() {
  const badge = document.getElementById('open-badge');
  const panel = document.getElementById('hours-panel');
  const list  = document.getElementById('hours-list');
  if (!list.children.length) return; // no hours loaded yet
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  badge.classList.toggle('expanded', !isOpen);
}

// ── Device orientation ────────────────────────────────────────
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

      setStatus(`Found ${stores.length} store(s) nearby`, '#22C77A');
      document.getElementById('list-toggle').style.display = 'flex';
      activateStore(0);
      fetchDetails(0);
      btn.innerHTML = '<i class="ti ti-refresh"></i> Refresh';
    } else {
      hideSkeleton();
      setStatus('No stores found — try a larger radius', '#FF5C7A');
      showErr('Increase the radius above and tap Refresh.');
      btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
    }
  } catch (err) {
    hideSkeleton();
    setStatus('API error — showing demo', '#F5A833');
    showErr('RapidAPI call failed: ' + err.message);
    demoMode(lat, lng);
    btn.innerHTML = '<i class="ti ti-current-location"></i> Retry';
  }
  btn.disabled = false;
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

    // Phone
    if (d.formatted_phone_number) {
      const btn = document.getElementById('btn-call');
      btn.href = 'tel:' + d.formatted_phone_number.replace(/\s/g, '');
      btn.className = 'action-btn call';
    }

    // Hours
    if (d.opening_hours) {
      const open  = d.opening_hours.open_now;
      const badge = document.getElementById('open-badge');
      badge.className     = open ? 'open' : 'closed';
      badge.style.display = 'flex';
      document.getElementById('open-txt').textContent          = open ? 'Open now' : 'Closed';
      document.getElementById('store-hours-short').textContent = open ? 'Open now' : 'Closed';
      document.getElementById('store-hours-short').style.color = open ? '#22C77A' : '#FF5C7A';
      stores[idx].isOpen = open;

      // Weekly schedule
      if (d.opening_hours.weekday_text?.length) {
        renderHours(d.opening_hours.weekday_text);
      }
      renderList();
    }

    // Better photo from details
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

  // Close hours panel when switching store
  document.getElementById('hours-panel').classList.remove('open');
  document.getElementById('open-badge').classList.remove('expanded');
  document.getElementById('hours-list').innerHTML = '';

  // Title + distance
  document.getElementById('store-title').textContent = s.name;
  document.getElementById('store-title').style.color = '#F0EDF8';
  document.getElementById('dist-val').textContent    = s.dist < 1 ? Math.round(s.dist*1000) : s.dist.toFixed(1);
  document.getElementById('dist-unit').textContent   = s.dist < 1 ? 'm away' : 'km away';
  document.getElementById('i-walk').textContent      = Math.round(s.dist*13) + ' min';
  document.getElementById('i-rating').textContent    = s.rating || '—';
  document.getElementById('store-rating').textContent = s.rating ? '★'.repeat(Math.round(s.rating))+'  '+s.rating : '';

  // Reset open badge + hours short
  document.getElementById('open-badge').style.display      = 'none';
  document.getElementById('open-badge').className          = '';
  document.getElementById('store-hours-short').textContent = '';

  // Directions always active
  const dirBtn = document.getElementById('btn-dir');
  dirBtn.className = 'action-btn dir';
  dirBtn.href      = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;

  // Call disabled until details
  const callBtn = document.getElementById('btn-call');
  callBtn.className = 'action-btn call off';
  callBtn.href      = '#';

  // Load photo from nearbysearch ref first (fast)
  loadPhoto(s.photoRef);
  renderList();
}

// ── Store list ────────────────────────────────────────────────
function renderList() {
  const el = document.getElementById('store-list');
  el.innerHTML = '';
  stores.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'sl-item' + (i === activeIdx ? ' active' : '');
    const badge = s.isOpen === true  ? '<span class="sl-badge open">Open</span>'
                : s.isOpen === false ? '<span class="sl-badge closed">Closed</span>' : '';
    div.innerHTML = `
      <span class="sl-num">${i+1}</span>
      <div>
        <div class="sl-name">${s.name}</div>
        <div class="sl-meta">${fmtDist(s.dist)} · ${dirLabel(s.bearing)}${s.rating ? ' · ★'+s.rating : ''}</div>
      </div>${badge}`;
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

// ── Start locating ────────────────────────────────────────────
function startLocating() {
  const btn = document.getElementById('locate-btn');
  btn.disabled  = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Locating…';
  setStatus('Getting your location…', '#F5A833');
  document.getElementById('err-box').style.display = 'none';

  if (!navigator.geolocation) {
    setStatus('Geolocation not supported', '#FF5C7A');
    btn.disabled = false; return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude; userLng = pos.coords.longitude;
      setStatus('Searching nearby stores…', '#F5A833');
      fetchStores(userLat, userLng);
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
    name: s.name, rating: s.rating, isOpen: s.isOpen,
    lat:  bLat + s.dlat, lng: bLng + s.dlng,
    dist: haversine(bLat, bLng, bLat+s.dlat, bLng+s.dlng),
    bearing: calcBearing(bLat, bLng, bLat+s.dlat, bLng+s.dlng),
    placeId: null, photoRef: null,
  }));

  // Demo hours
  const demoHours = [
    'Monday: 10:00 AM – 10:00 PM','Tuesday: 10:00 AM – 10:00 PM',
    'Wednesday: 10:00 AM – 10:00 PM','Thursday: 10:00 AM – 10:00 PM',
    'Friday: 10:00 AM – 11:00 PM','Saturday: 10:00 AM – 11:00 PM','Sunday: Closed',
  ];

  setStatus('Demo mode — 3 stores shown', '#22C77A');
  document.getElementById('list-toggle').style.display = 'flex';
  activateStore(0);
  hideSkeleton();

  const badge = document.getElementById('open-badge');
  badge.className = 'open'; badge.style.display = 'flex';
  document.getElementById('open-txt').textContent          = 'Open now';
  document.getElementById('store-hours-short').textContent = 'Open now';
  document.getElementById('store-hours-short').style.color = '#22C77A';
  document.getElementById('btn-dir').className = 'action-btn dir';
  renderHours(demoHours);

  if (demoTimer) clearInterval(demoTimer);
  let deg = 0;
  demoTimer = setInterval(() => {
    deg = (deg + 1) % 360; compassHeading = deg;
    document.getElementById('needle-group').style.transform =
      `rotate(${-deg + Math.sin(Date.now()/700)*2}deg)`;
    updateCompass(targetBearing);
  }, 40);

  const btn = document.getElementById('locate-btn');
  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-current-location"></i> Retry with Location';
}