/** Client transport for the console and agent tools. No token is embedded in source. */
export class LiveLensClient {
  constructor({ baseUrl, token, timeoutMs = 10_000 }) {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('invalid_base_url');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('https_or_loopback_required');
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('invalid_token');
    this.baseUrl = url.origin; this.token = token; this.timeoutMs = timeoutMs;
  }

  async request(method, path, body) {
    const response = await fetch(this.baseUrl + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { Authorization: 'Bearer ' + this.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error('livelens_http_' + response.status);
    return response.json();
  }

  capabilities() { return this.request('GET', '/v1/capabilities'); }
  sessions() { return this.request('GET', '/v1/sessions'); }
  search({ query = '', account, sessionId, limit = 100 } = {}) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (account) params.set('account', account);
    if (sessionId) params.set('session', sessionId);
    return this.request('GET', '/v1/evidence/search?' + params);
  }
  report(caseId) { return this.request('GET', '/v1/cases/' + encodeURIComponent(caseId) + '/report'); }
  createSession(value) { return this.request('POST', '/v1/sessions', value); }
  append(sessionId, events) { return this.request('POST', '/v1/sessions/' + encodeURIComponent(sessionId) + '/events', { events }); }
}
