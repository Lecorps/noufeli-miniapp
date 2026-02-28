export async function callConvex(functionName, args) {
  const CONVEX_URL = process.env.CONVEX_URL;
  const url = `${CONVEX_URL}/api/query`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: functionName, args })
  });

    
  // Check if response is OK before parsing JSON
  if (!response.ok) {
    console.error(`Convex error: ${response.status} ${response.statusText}`);
    return null;
  }
  
  const text = await response.text();
  if (!text) {
    console.error('Empty response from Convex');
    return null;
  }
  
  const data = JSON.parse(text);
  return data.value;

}
