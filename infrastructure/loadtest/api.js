// k6 load test: realistic read mix with a ramp to VUS concurrent users; fails when p95 exceeds P95_MS.
// Run with infrastructure/scripts/loadtest.sh (uses the grafana/k6 container on the Docker network).
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE || 'http://nginx';
const VUS = Number(__ENV.VUS || 200);
const P95 = Number(__ENV.P95_MS || 200);

export const options = {
  scenarios: {
    members: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: VUS },
        { duration: __ENV.HOLD || '2m', target: VUS },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: [`p(95)<${P95}`],
    'http_req_duration{name:site}': [`p(95)<${P95}`],
    'http_req_duration{name:me}': [`p(95)<${P95}`],
    'http_req_duration{name:users}': [`p(95)<${P95}`],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const r = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ email: __ENV.EMAIL, password: __ENV.PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } });
  check(r, { 'signed in': (x) => x.status === 200 });
  return { token: r.json('data.access_token') };
}

export default function (data) {
  const auth = { headers: { Authorization: `Bearer ${data.token}` } };
  const pick = Math.random();
  if (pick < 0.4) http.get(`${BASE}/api/v1/public/site`, { tags: { name: 'site' } });
  else if (pick < 0.65) http.get(`${BASE}/api/v1/auth/me`, { ...auth, tags: { name: 'me' } });
  else if (pick < 0.8) http.get(`${BASE}/api/v1/admin/users?page_size=20`, { ...auth, tags: { name: 'users' } });
  else if (pick < 0.9) http.get(`${BASE}/api/v1/admin/dashboard`, { ...auth, tags: { name: 'dashboard' } });
  else http.get(`${BASE}/`, { tags: { name: 'website' } });
  sleep(Math.random() * 2 + 0.5); // think time: each user makes ~1 request every 1.5 s
}
