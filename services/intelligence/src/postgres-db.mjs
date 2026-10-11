import { createRequire } from 'node:module';
import { Fault } from './validation.mjs';

const require = createRequire(import.meta.url);
const WRITER_LOCK = '789412636011';
const quoteIdentifier = value => '"' + value.replaceAll('"', '""') + '"';

// Translate the project's documented SQL subset, never SQL assembled from
// captured text. Quoted literals/identifiers and comments stay byte-for-byte.
function unquoted(sql, transform) {
  const expression = /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g;
  let position = 0, result = '';
  for (const match of sql.matchAll(expression)) { result += transform(sql.slice(position, match.index)) + match[0]; position = match.index + match[0].length; }
  return result + transform(sql.slice(position));
}
function statements(sql) {
  const protectedSql = unquoted(sql, value => value.replaceAll(';', '\u0000'));
  return protectedSql.split('\u0000').map(value => value.trim()).filter(Boolean);
}
export function translatePilotSql(sql) {
  if (typeof sql !== 'string' || !sql.trim() || sql.includes('\u0000')) throw new Fault('invalid_database_statement');
  const pragma = /^\s*PRAGMA\s+table_info\(("(?:""|[^"])+"|[A-Za-z_][A-Za-z0-9_]*)\)\s*;?\s*$/i.exec(sql);
  if (pragma) {
    const table = pragma[1].startsWith('"') ? pragma[1].slice(1, -1).replaceAll('""', '"') : pragma[1];
    return { sql: 'SELECT ordinal_position-1 AS cid,column_name AS name,data_type AS type,CASE WHEN is_nullable=\'NO\' THEN 1 ELSE 0 END AS "notnull",column_default AS dflt_value,0 AS pk FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position', fixedParameters: [table], parameterCount: 0 };
  }
  if (/^\s*PRAGMA\b/i.test(sql)) {
    if (/^\s*PRAGMA\s+(foreign_keys\s*=\s*ON|journal_mode\s*=\s*WAL|synchronous\s*=\s*FULL|busy_timeout\s*=\s*5000)\s*;?\s*$/i.test(sql)) return { ignored: true, parameterCount: 0 };
    throw new Fault('unsupported_postgres_sql');
  }
  const ignore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql); let parameterCount = 0;
  let translated = unquoted(sql, part => {
    if (/\b(?:AUTOINCREMENT|json_extract|GROUP_CONCAT|strftime|GLOB|REPLACE\s+INTO|INSERT\s+OR\s+(?:REPLACE|FAIL|ABORT))\b/i.test(part.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY'))) throw new Fault('unsupported_postgres_sql');
    return part.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY')
      .replace(/\bINTEGER\b/gi, 'BIGINT')
      .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
      .replace(/\bmax\(\s*0\s*,/gi, 'greatest(0,')
      .replace(/\bsqlite_master\b/g, "(SELECT table_name AS name,'table'::text AS type FROM information_schema.tables WHERE table_schema=current_schema()) AS sqlite_master")
      .replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, (_, alias) => 'AS ' + quoteIdentifier(alias))
      .replace(/\?/g, () => '$' + ++parameterCount);
  });
  if (ignore) translated = translated.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
  return { sql: translated, parameterCount };
}

/** Persistent libpq connection exposing the existing synchronous pilot contract.
 * PostgreSQL BIGINT/numeric values must fit JavaScript's safe numeric range.
 * One advisory transaction writer lock intentionally preserves SQLite pilot
 * mutation ordering. This bridge is not a claim of horizontally scaled writes.
 */
export class PostgresDatabase {
  constructor({ connectionString, schema = 'livelens', statementTimeoutMs = 10_000, lockTimeoutMs = 5000 }) {
    let url;
    try { url = new URL(connectionString); } catch { throw new Fault('invalid_postgres_configuration'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !/^[a-z][a-z0-9_]{0,62}$/.test(schema) || !Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 100 || statementTimeoutMs > 60_000 || !Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 100 || lockTimeoutMs > 60_000) throw new Fault('invalid_postgres_configuration');
    const allowedOptions = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'application_name', 'channel_binding', 'connect_timeout']);
    const seenOptions = new Set();
    for (const [name] of url.searchParams) {
      if (!allowedOptions.has(name) || seenOptions.has(name)) throw new Fault('invalid_postgres_connection_option');
      seenOptions.add(name);
    }
    // libpq treats hostaddr/service as separate effective destinations. Refuse
    // those ambient overrides rather than validating only the visible URI host.
    if (process.env.PGHOSTADDR || process.env.PGSERVICE || process.env.PGSERVICEFILE) throw new Fault('postgres_ambient_host_configuration_refused');
    if (url.hash || !url.pathname || url.pathname === '/') throw new Fault('invalid_postgres_configuration');
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode !== null && !['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslmode)) throw new Fault('invalid_postgres_connection_option');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && sslmode !== 'verify-full') throw new Fault('postgres_verified_tls_required');
    url.searchParams.set('connect_timeout', '5');
    let Native, types;
    try { Native = require('pg-native'); types = require('pg-types'); } catch { throw new Fault('postgres_native_dependency_unavailable', 503); }
    const number = value => { const parsed = Number(value); if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) throw new Fault('postgres_number_out_of_range', 500); return parsed; };
    this.client = new Native({ types: { getTypeParser: oid => [20, 1700].includes(oid) ? number : types.getTypeParser(oid) } }); this.dialect = 'postgres'; this.schema = schema;
    try {
      this.client.connectSync(url.toString());
      this.client.querySync(`SET statement_timeout=${statementTimeoutMs}; SET lock_timeout=${lockTimeoutMs}; SET idle_in_transaction_session_timeout=15000; SET client_min_messages=warning; CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}; SET search_path=${quoteIdentifier(schema)}`);
    } catch { this.client.end(); throw new Fault('postgres_connection_failed', 503); }
  }
  get isTransaction() { return !this.closed && ['T', 'E'].includes(this.client.getTransactionStatus()); }
  close() { if (!this.closed) { this.closed = true; this.client.end(); } }
  exec(sql) {
    if (this.closed) throw new Fault('database_closed', 500);
    for (const statement of statements(sql)) {
      if (/^BEGIN(?:\s+IMMEDIATE)?$/i.test(statement)) {
        this.client.querySync('BEGIN');
        try { this.client.querySync('SELECT pg_advisory_xact_lock(' + WRITER_LOCK + ')'); } catch (error) { this.client.querySync('ROLLBACK'); throw error; }
        continue;
      }
      const compiled = translatePilotSql(statement); if (!compiled.ignored) this.client.querySync(compiled.sql);
    }
  }
  prepare(sql) {
    if (statements(sql).length !== 1) throw new Fault('single_database_statement_required');
    const compiled = translatePilotSql(sql);
    const query = values => {
      if (this.closed) throw new Fault('database_closed', 500);
      if (values.length !== compiled.parameterCount) throw new Fault('database_parameter_count');
      if (compiled.ignored) return [];
      const parameters = compiled.fixedParameters ?? values.map(value => {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw new Fault('invalid_database_number');
        if (!['string', 'number', 'boolean', 'bigint'].includes(typeof value)) throw new Fault('invalid_database_parameter');
        return String(value);
      });
      try { return this.client.querySync(compiled.sql, parameters); }
      catch (error) { const fault = new Fault('postgres_statement_failed', 500); fault.databaseCode = error.code; throw fault; }
    };
    return {
      all: (...values) => query(values),
      get: (...values) => query(values)[0],
      iterate: (...values) => query(values)[Symbol.iterator](),
      run: (...values) => { query(values); const count = Number(this.client.pq.cmdTuples()); return { changes: Number.isFinite(count) ? count : 0 }; },
    };
  }
}
