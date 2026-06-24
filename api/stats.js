export const config = {
  runtime: 'edge',
};

let cache = null;
let cacheTime = 0;

export default async function handler(req) {
  const ZONE_ID = process.env.CF_ZONE_ID;
  const API_EMAIL = process.env.CF_EMAIL;
  const API_KEY = process.env.CF_AUTH_KEY;

  if (!ZONE_ID || !API_EMAIL || !API_KEY) {
    return Response.json({ error: "Missing Cloudflare credentials in environment" }, { status: 500 });
  }

  const nowTime = Date.now();
  if (cache && (nowTime - cacheTime) < 10000) {
    return Response.json(cache, {
      headers: {
        "Cache-Control": "no-cache, no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const now = new Date();
  const since = new Date(now.getTime() - 60 * 60 * 1000);

  const query = `query {
    viewer {
      zones(filter: { zoneTag: "${ZONE_ID}" }) {
        httpRequestsAdaptiveGroups(
          limit: 10000
          filter: {
            datetime_geq: "${since.toISOString()}"
            datetime_leq: "${now.toISOString()}"
          }
          orderBy: [datetimeMinute_DESC]
        ) {
          dimensions {
            datetimeMinute
            cacheStatus
            securityAction
            sampleInterval
          }
          count
        }
      }
    }
  }`;

  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        "X-Auth-Email": API_EMAIL,
        "X-Auth-Key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    const json = await response.json();

    if (json.errors && json.errors.length > 0) {
      return Response.json({ error: json.errors[0].message }, { status: 500 });
    }

    const zones = json.data?.viewer?.zones;
    if (!zones || zones.length === 0) {
      return Response.json({
        current: { total: 0, origin: 0, cached: 0, mitigated: 0 },
        history: { total: [], origin: [], cached: [], mitigated: [] },
        timestamp: Date.now(),
      });
    }

    const groups = zones[0].httpRequestsAdaptiveGroups || [];
    const minuteMap = {};

    for (let i = 59; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60 * 1000);
      d.setSeconds(0, 0);
      const key = d.toISOString().substring(0, 16) + ":00Z";
      minuteMap[key] = { total: 0, cached: 0, mitigated: 0 };
    }

    for (const g of groups) {
      const minute = g.dimensions.datetimeMinute;
      const cacheStatus = (g.dimensions.cacheStatus || "").toLowerCase();
      const securityAction = (g.dimensions.securityAction || "").toLowerCase();
      const sampleInterval = g.dimensions.sampleInterval || 1;
      const count = g.count;

      const requests = count * sampleInterval;
      const key = minute;

      if (!minuteMap[key]) {
        minuteMap[key] = { total: 0, cached: 0, mitigated: 0 };
      }

      minuteMap[key].total += requests;

      const isCached = ["hit", "stale", "revalidated", "updating"].includes(cacheStatus);
      if (isCached) {
        minuteMap[key].cached += requests;
      }

      const isMitigated = securityAction !== "unknown" && securityAction !== "allow" && securityAction !== "none";
      if (isMitigated) {
        minuteMap[key].mitigated += requests;
      }
    }

    const sortedKeys = Object.keys(minuteMap).sort();

    const total = [];
    const origin = [];
    const cached = [];
    const mitigated = [];

    for (const key of sortedKeys) {
      const m = minuteMap[key];
      const orig = Math.max(m.total - m.cached - m.mitigated, 0);

      total.push(Math.round((m.total / 60) * 10) / 10);
      origin.push(Math.round((orig / 60) * 10) / 10);
      cached.push(Math.round((m.cached / 60) * 10) / 10);
      mitigated.push(Math.round((m.mitigated / 60) * 10) / 10);
    }

    let latestMinuteData = { total: 0, cached: 0, mitigated: 0 };
    if (sortedKeys.length > 0) {
      let maxTotal = -1;
      const scanWindow = sortedKeys.slice(-3);
      for (const key of scanWindow) {
        const m = minuteMap[key];
        if (m.total > maxTotal) {
          maxTotal = m.total;
          latestMinuteData = m;
        }
      }
    }

    const current = {
      total: Math.round((latestMinuteData.total / 60) * 10) / 10,
      cached: Math.round((latestMinuteData.cached / 60) * 10) / 10,
      mitigated: Math.round((latestMinuteData.mitigated / 60) * 10) / 10,
      origin: Math.round(Math.max(latestMinuteData.total - latestMinuteData.cached - latestMinuteData.mitigated, 0) / 60 * 10) / 10
    };

    const result = {
      current,
      history: { total, origin, cached, mitigated },
      timestamp: Date.now()
    };

    cache = result;
    cacheTime = nowTime;

    return Response.json(result, {
      headers: {
        "Cache-Control": "no-cache, no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return Response.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}
