import { resolve } from 'node:path';
import { FilesystemObjectStorage, S3ObjectStorage, EncryptedObjectStorage } from '../../../deployment/livelens/object-storage.mjs';
import { Fault, object } from './validation.mjs';

// Private administrator configuration. HTTP request bodies never choose a bucket,
// endpoint, executable, local path or key. Every selected backend is encrypted.
export function objectStorageFromEnvironment(env = process.env) {
  if (!env.LIVELENS_OBJECT_STORAGE) return undefined;
  let value;
  try { value = JSON.parse(env.LIVELENS_OBJECT_STORAGE); } catch { throw new Fault('invalid_object_storage_configuration'); }
  object(value, ['backend', 'root', 'endpoint', 'bucket', 'region', 'accessKeyIdEnv', 'secretAccessKeyEnv', 'sessionTokenEnv', 'encryptionKeyEnv']);
  const secret = name => {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(name) || typeof env[name] !== 'string' || !env[name]) throw new Fault('object_storage_secret_required');
    return env[name];
  };
  const key = secret(value.encryptionKeyEnv);
  if (!/^[A-Za-z0-9_-]{43}$/.test(key) || Buffer.from(key, 'base64url').length !== 32 || Buffer.from(key, 'base64url').toString('base64url') !== key) throw new Fault('object_encryption_key_required');
  let storage;
  try {
    if (value.backend === 'filesystem' && typeof value.root === 'string' && value.root.length > 0 && value.root.length <= 4096 && !value.endpoint && !value.bucket) storage = new FilesystemObjectStorage(resolve(value.root));
    else if (value.backend === 's3' && !value.root) storage = new S3ObjectStorage({ endpoint: value.endpoint, bucket: value.bucket, region: value.region, accessKeyId: secret(value.accessKeyIdEnv), secretAccessKey: secret(value.secretAccessKeyEnv), ...(value.sessionTokenEnv ? { sessionToken: secret(value.sessionTokenEnv) } : {}) });
    else throw new Fault('invalid_object_storage_configuration');
    return new EncryptedObjectStorage(storage, key);
  } catch (error) { if (error instanceof Fault) throw error; throw new Fault('invalid_object_storage_configuration'); }
}
