const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const liveTwin = process.env.NEXT_PUBLIC_ENABLE_LIVE_K8S_TWIN?.trim();
const isVercelBuild = Boolean(process.env.VERCEL_ENV);

function fail(message) {
  console.error(`Environment validation failed: ${message}`);
  process.exit(1);
}

if (!apiUrl) {
  fail("NEXT_PUBLIC_API_URL is required for builds.");
}

if (apiUrl) {
  const isRelativeProxyPath = apiUrl.startsWith("/");
  if (isRelativeProxyPath && apiUrl === "/") {
    fail("NEXT_PUBLIC_API_URL cannot be just '/'. Use a proxy path such as /api.");
  }

  if (isVercelBuild && isRelativeProxyPath) {
    fail("NEXT_PUBLIC_API_URL must be an absolute backend URL on Vercel.");
  }

  if (!isRelativeProxyPath) {
    let parsed;
    try {
      parsed = new URL(apiUrl);
    } catch {
      fail("NEXT_PUBLIC_API_URL must be an absolute http(s) URL or a relative proxy path.");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      fail("NEXT_PUBLIC_API_URL must use http or https.");
    }

    if (isVercelBuild && parsed.protocol !== "https:") {
      fail("NEXT_PUBLIC_API_URL must use https on Vercel.");
    }
  }
}

if (liveTwin && !["true", "false"].includes(liveTwin)) {
  fail("NEXT_PUBLIC_ENABLE_LIVE_K8S_TWIN must be true or false when set.");
}
