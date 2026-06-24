export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Hit</title><style>*{margin:0;padding:0}body{background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif}p{font-size:18px;color:#111}</style></head><body><p>You hit the site.</p></body></html>`,
    {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
        "CDN-Cache-Control": "public, max-age=31536000, immutable",
      },
    }
  );
}
