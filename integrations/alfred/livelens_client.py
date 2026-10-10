"""Read-only LiveLens HTTP client. ALFRED connector registration is a later job.

This client never registers itself, starts collection, changes ALFRED memory or
sends evidence to a model. Credentials belong in the caller's private runtime.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LiveLensClient:
    def __init__(self, base_url: str, token: str, timeout: float = 10):
        url = urlsplit(base_url)
        if url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
            raise ValueError('invalid_base_url')
        if url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost', '::1')):
            raise ValueError('https_or_loopback_required')
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token):
            raise ValueError('invalid_token')
        self.base_url, self.token, self.timeout = base_url.rstrip('/'), token, timeout
        self.opener = build_opener(NoRedirect())

    def _get(self, path: str):
        request = Request(self.base_url + path, headers={'Authorization': 'Bearer ' + self.token})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(2_097_153)
                if len(raw) > 2_097_152:
                    raise ValueError('response_too_large')
                return json.loads(raw)
        except HTTPError as error:
            raise RuntimeError('livelens_http_' + str(error.code)) from None

    def capabilities(self):
        return self._get('/v1/capabilities')

    def sessions(self):
        return self._get('/v1/sessions')

    def search(self, query='', account=None, session=None, limit=100):
        params = {'q': query, 'limit': limit}
        if account is not None:
            params['account'] = account
        if session is not None:
            params['session'] = session
        return self._get('/v1/evidence/search?' + urlencode(params))

    def report(self, case_id):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', case_id):
            raise ValueError('invalid_case_id')
        return self._get('/v1/cases/' + quote(case_id, safe='') + '/report')


def main():
    parser = argparse.ArgumentParser(description='Read LiveLens evidence using a scoped API key')
    parser.add_argument('command', choices=('capabilities', 'sessions', 'search', 'report'))
    parser.add_argument('--query', default='')
    parser.add_argument('--case')
    args = parser.parse_args()
    client = LiveLensClient(os.environ['LIVELENS_URL'], os.environ['LIVELENS_TOKEN'])
    if args.command == 'search':
        result = client.search(args.query)
    elif args.command == 'report':
        if not args.case:
            parser.error('--case is required for report')
        result = client.report(args.case)
    else:
        result = getattr(client, args.command)()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
