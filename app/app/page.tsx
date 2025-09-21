export const dynamic = "force-dynamic";

async function getJSON(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

// We call the FastAPI service directly via the compose DNS name "server".
export default async function Page() {
  let serverOk = "unknown";
  let mongoOk = "unknown";
  try {
    const h = await getJSON("http://server:8000/health");
    serverOk = h.ok ? "ok" : "not ok";
  } catch {
    serverOk = "error";
  }
  try {
    const d = await getJSON("http://server:8000/health/db");
    mongoOk = d.mongo === "ok" ? "ok" : "not ok";
  } catch {
    mongoOk = "error";
  }

  return (
    <main>
      <h1>✅ Foundation Online</h1>
      <p>Server health: <strong>{serverOk}</strong></p>
      <p>Mongo health: <strong>{mongoOk}</strong></p>
      <p style={{marginTop: 24, opacity: 0.8}}>
        Next steps: we’ll add simple pages to create a template and an object, then render a form from YAML.
      </p>
    </main>
  );
}
