export function logAudit(event, metadata = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...metadata
  };
  console.log(JSON.stringify(entry));
}

export function estimateInputLength(req) {
  if (typeof req.body?.policyText === "string") return req.body.policyText.length;
  if (typeof req.body?.url === "string") return req.body.url.length;
  if (req.file?.size) return req.file.size;
  return 0;
}
