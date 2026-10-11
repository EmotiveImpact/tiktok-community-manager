import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync, readFileSync, existsSync, openSync, closeSync, writeFileSync, renameSync, rmSync, statSync, fsyncSync, constants } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hmac = (key, bytes) => createHmac('sha256', key).update(bytes).digest();
function namespace(workspace, key) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(workspace) || typeof key !== 'string' || key.length > 1024 || !/^[A-Za-z0-9_./-]+$/.test(key) || key.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('invalid_object_key');
  return workspace + '/' + key;
}
function payload(value) { if (!Buffer.isBuffer(value) || value.length > 1024 ** 3) throw new Error('bounded_buffer_required'); return value; }
function byteLimit(options = {}) { const max = options.maxBytes ?? 1024 ** 3; if (!Number.isSafeInteger(max) || max < 0 || max > 1024 ** 3 + 34) throw new Error('invalid_object_byte_limit'); return max; }

/** Workspace namespacing is enforced by the adapter, never accepted in a key. */
export class FilesystemObjectStorage {
  constructor(root) { mkdirSync(resolve(root), { recursive: true, mode: 0o700 }); this.root = realpathSync(root); }
  path(workspace, key, create = false) {
    const target = join(this.root, namespace(workspace, key)), workspaceRoot = join(this.root, workspace);
    if (create) mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const parent = realpathSync(dirname(target));
    if (!parent.startsWith(workspaceRoot + sep) && parent !== workspaceRoot) throw new Error('object_namespace_escape');
    if (existsSync(target) && (!realpathSync(target).startsWith(workspaceRoot + sep))) throw new Error('object_namespace_escape');
    return target;
  }
  async put(workspace, key, value) {
    payload(value); const target = this.path(workspace, key, true), temp = target + '.partial-' + randomBytes(8).toString('hex');
    const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, value); fsyncSync(fd); closeSync(fd); renameSync(temp, target); const directoryFd = openSync(dirname(target), constants.O_RDONLY); try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); } } catch (error) { try { closeSync(fd); } catch {} rmSync(temp, { force: true }); throw error; }
    return { key, bytes: value.length, sha256: sha256(value), backend: 'filesystem' };
  }
  async get(workspace, key, options) { const path = this.path(workspace, key), max = byteLimit(options); if (statSync(path).size > max) throw new Error('object_too_large'); const value = readFileSync(path); if (value.length > max) throw new Error('object_too_large'); return value; }
  async delete(workspace, key) { rmSync(this.path(workspace, key)); return { deleted: true, key }; }
}

/** Dependency-free S3 Signature V4 adapter. No credentials or signed URL are returned. */
export class S3ObjectStorage {
  constructor({ endpoint, bucket, region, accessKeyId, secretAccessKey, sessionToken, timeoutMs = 15_000, fetcher = fetch, now = () => new Date() }) {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('https_or_loopback_s3_endpoint_required');
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || !/^[a-z0-9-]{1,64}$/.test(region) || !accessKeyId || !secretAccessKey || timeoutMs < 100 || timeoutMs > 60_000) throw new Error('invalid_s3_configuration');
    Object.assign(this, { url, bucket, region, accessKeyId, secretAccessKey, sessionToken, timeoutMs, fetcher, now });
  }
  async request(method, workspace, key, bytes = Buffer.alloc(0), options) {
    payload(bytes); const objectKey = namespace(workspace, key), path = '/' + this.bucket + '/' + objectKey.split('/').map(encodeURIComponent).join('/');
    const instant = this.now().toISOString().replace(/[:-]|\.\d{3}/g, ''), date = instant.slice(0, 8), scope = `${date}/${this.region}/s3/aws4_request`, contentHash = sha256(bytes);
    const headers = { host: this.url.host, 'x-amz-content-sha256': contentHash, 'x-amz-date': instant, ...(this.sessionToken ? { 'x-amz-security-token': this.sessionToken } : {}) };
    const names = Object.keys(headers).sort(), canonicalHeaders = names.map(name => name + ':' + headers[name].trim() + '\n').join(''), signedHeaders = names.join(';');
    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, contentHash].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', instant, scope, sha256(canonicalRequest)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + this.secretAccessKey, date), this.region), 's3'), 'aws4_request');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign).toString('hex')}`;
    let response;
    try { response = await this.fetcher(this.url.origin + path, { method, headers, ...(method === 'PUT' ? { body: bytes } : {}), redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) }); }
    catch { throw new Error('object_storage_unavailable'); }
    if (!response.ok) throw new Error('object_storage_http_' + response.status);
    if (method !== 'GET') { await response.body?.cancel(); return { key, bytes: bytes.length, sha256: contentHash, backend: 's3' }; }
    const parts = [], max = byteLimit(options); let count = 0;
    if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('object_too_large'); }
    for await (const chunk of response.body) { count += chunk.length; if (count > max) throw new Error('object_too_large'); parts.push(chunk); }
    return Buffer.concat(parts);
  }
  put(workspace, key, bytes) { return this.request('PUT', workspace, key, bytes); }
  get(workspace, key, options) { return this.request('GET', workspace, key, Buffer.alloc(0), options); }
  async delete(workspace, key) { await this.request('DELETE', workspace, key); return { deleted: true, key }; }
}

/** Application envelope encryption; keys belong in a secret manager/private runtime. */
export class EncryptedObjectStorage {
  constructor(storage, key) { this.storage = storage; this.key = Buffer.isBuffer(key) ? Buffer.from(key) : Buffer.from(key, 'base64url'); if (this.key.length !== 32) throw new Error('object_encryption_key_required'); }
  async put(workspace, key, bytes) {
    payload(bytes); const iv = randomBytes(12), aad = Buffer.from(namespace(workspace, key)), cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(aad);
    const sealed = Buffer.concat([Buffer.from('LLOBJ1'), iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
    const receipt = await this.storage.put(workspace, key, sealed);
    return { ...receipt, plaintextBytes: bytes.length, plaintextSha256: sha256(bytes), encryption: 'AES-256-GCM' };
  }
  async get(workspace, key, options) {
    const max = byteLimit(options), sealed = await this.storage.get(workspace, key, { maxBytes: max + 34 });
    if (sealed.length < 34 || sealed.subarray(0, 6).toString() !== 'LLOBJ1') throw new Error('invalid_encrypted_object');
    const decipher = createDecipheriv('aes-256-gcm', this.key, sealed.subarray(6, 18)); decipher.setAAD(Buffer.from(namespace(workspace, key))); decipher.setAuthTag(sealed.subarray(-16));
    try { const value = Buffer.concat([decipher.update(sealed.subarray(18, -16)), decipher.final()]); if (value.length > max) throw new Error('object_too_large'); return value; } catch (error) { if (error.message === 'object_too_large') throw error; throw new Error('object_authentication_failed'); }
  }
  delete(workspace, key) { return this.storage.delete(workspace, key); }
}
