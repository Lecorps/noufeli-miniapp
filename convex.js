export async function callConvex(functionName, args) {
  const CONVEX_URL = process.env.CONVEX_URL;
  const url = `${CONVEX_URL}/api/query`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: functionName, args })
  });
  
  const data = await response.json();
  return data.value;
}