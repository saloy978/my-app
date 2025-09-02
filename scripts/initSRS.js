// Run: node scripts/initSRS.js
const BASE = 'http://localhost:5000';

async function main() {
  try {
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin1@example.com', password: 'Passw0rd!' })
    });
    if (!loginRes.ok) {
      const t = await loginRes.text();
      throw new Error(`Login failed: ${loginRes.status} ${t}`);
    }
    const { token } = await loginRes.json();
    const initRes = await fetch(`${BASE}/admin/srs/init`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const text = await initRes.text();
    console.log('Init response:', initRes.status, text);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();


