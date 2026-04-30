const autocannon = require('autocannon');

async function run() {
  console.log('Registering test user...');
  const res = await fetch('http://localhost:8301/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `loadtest-${Date.now()}@flowra.test`,
      password: 'TestPassword123!',
      name: 'Load Tester'
    })
  });
  
  if (!res.ok) {
    console.error('Failed to register user:', await res.text());
    return;
  }
  
  const data = await res.json();
  const token = data.data.accessToken;
  
  console.log('User registered. Token acquired. Starting load test on GET /api/v1/items...');
  
  const instance = autocannon({
    url: 'http://localhost:8301/api/v1/items',
    connections: 50, // 50 concurrent connections
    duration: 10, // 10 seconds
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  
  autocannon.track(instance, { renderProgressBar: true });
  
  instance.on('done', (result) => {
    console.log('\n--- Load Test Results ---');
    console.log(`Endpoint: GET /api/v1/items (Authenticated + DB query)`);
    console.log(`Requests/sec: ${result.requests.average}`);
    console.log(`Latency avg: ${result.latency.average} ms`);
    console.log(`Total Requests: ${result.requests.total}`);
    console.log(`2xx Responses: ${result['2xx']}`);
    console.log(`Non-2xx Responses: ${result.non2xx}`);
  });
}

run().catch(console.error);
