const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const CLOUDKIT_DIAGNOSTIC_OPERATIONS = new Set([
  'records/query',
  'records/lookup',
  'changes/zone',
]);

function safeDiagnosticValue(value, depth = 0) {
  if (depth > 3) return '<nested>';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, 240);
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => safeDiagnosticValue(item, depth + 1));
  }
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 12)
      .map(([key, item]) => [key.slice(0, 80), safeDiagnosticValue(item, depth + 1)])
      .filter(([, item]) => item !== undefined),
  );
}

function fullSectionDiagnosticValue(value, depth = 0) {
  if (depth > 10) return '<maximum-depth>';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    return value.length > 32_000 ? `${value.slice(0, 32_000)}<truncated>` : value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 2_000).map((item) => fullSectionDiagnosticValue(item, depth + 1));
    if (value.length > 2_000) items.push(`<${value.length - 2_000} more items>`);
    return items;
  }
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value);
  const result = Object.fromEntries(
    entries.slice(0, 200).map(([key, item]) => {
      if (/(url|token|cookie|password|authorization|signature|session|wrappingkey|secret)/iu.test(key)) {
        return [key.slice(0, 100), '<redacted>'];
      }
      return [key.slice(0, 100), fullSectionDiagnosticValue(item, depth + 1)];
    }).filter(([, item]) => item !== undefined),
  );
  if (entries.length > 200) result._truncatedKeys = entries.length - 200;
  return result;
}

function safeCloudKitDiagnostic(entry) {
  if (!CLOUDKIT_DIAGNOSTIC_OPERATIONS.has(entry.operation)) return null;
  if (!['private', 'shared'].includes(entry.scope)) return null;
  if (typeof entry.list_key !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.list_key)) return null;

  const recordTypeCounts = Array.isArray(entry.record_type_counts)
    ? entry.record_type_counts.slice(0, 30).flatMap((item) => (
      item && typeof item.recordType === 'string' && Number.isInteger(item.count)
        ? [{ recordType: item.recordType.slice(0, 100), count: item.count }]
        : []
    ))
    : [];
  const records = Array.isArray(entry.records)
    ? entry.records.slice(0, 30).flatMap((item) => {
      if (!item || typeof item.recordType !== 'string' || typeof item.recordIdHash !== 'string') {
        return [];
      }
      const record = {
        recordType: item.recordType.slice(0, 100),
        recordIdHash: item.recordIdHash.slice(0, 32),
        fieldNames: Array.isArray(item.fieldNames)
          ? item.fieldNames.filter((field) => typeof field === 'string').slice(0, 80).map((field) => field.slice(0, 100))
          : [],
      };
      if (typeof item.matchesSelectedList === 'boolean') {
        record.matchesSelectedList = item.matchesSelectedList;
      }
      if (typeof item.sectionID === 'string' && /^[a-f0-9-]{16,100}$/iu.test(item.sectionID)) {
        record.section_id = item.sectionID;
      }
      if (Number.isInteger(item.sectionOrder) && item.sectionOrder >= 0) {
        record.section_order = item.sectionOrder;
      }
      if (item.sectionCandidates && typeof item.sectionCandidates === 'object' && !Array.isArray(item.sectionCandidates)) {
        record.sectionCandidates = Object.fromEntries(
          Object.entries(item.sectionCandidates)
            .slice(0, 8)
            .map(([key, value]) => [
              key.slice(0, 80),
              /MembershipsOfRemindersInSectionsAsData|SectionIDsOrderingAsData|\.TitleDocument|\.NameDocument/iu.test(key)
                ? fullSectionDiagnosticValue(value)
                : safeDiagnosticValue(value),
            ])
            .filter(([, value]) => value !== undefined),
        );
      }
      return [record];
    })
    : [];

  return {
    scope: entry.scope,
    operation: entry.operation,
    list_key: entry.list_key,
    ...(typeof entry.diagnostic_phase === 'string' ? { diagnostic_phase: entry.diagnostic_phase.slice(0, 80) } : {}),
    ...(typeof entry.query_record_type === 'string' ? { query_record_type: entry.query_record_type.slice(0, 100) } : {}),
    ...(Number.isInteger(entry.candidate_count) ? { candidate_count: entry.candidate_count } : {}),
    ...(Number.isInteger(entry.zone_record_count) ? { zone_record_count: entry.zone_record_count } : {}),
    ...(typeof entry.query_error_code === 'string' ? { query_error_code: entry.query_error_code.slice(0, 100) } : {}),
    ...(typeof entry.selected_record_id_hash === 'string' && /^[a-f0-9]{16}$/u.test(entry.selected_record_id_hash)
      ? { selected_record_id_hash: entry.selected_record_id_hash }
      : {}),
    ...(typeof entry.request_id === 'string' ? { request_id: entry.request_id.slice(0, 100) } : {}),
    record_count: Number.isInteger(entry.record_count) ? entry.record_count : 0,
    record_type_counts: recordTypeCounts,
    records,
    records_truncated: Boolean(entry.records_truncated),
  };
}

class ICloudRemindersWorker {
  constructor({ dataDir, python = process.env.ABBAI_FLOW_PYTHON || 'python3', scriptPath } = {}) {
    this.dataDir = dataDir;
    this.python = python;
    this.scriptPath = scriptPath || path.join(__dirname, 'icloud_reminders_worker.py');
    this.child = null;
    this.nextRequestId = 0;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.authState = 'disconnected';
    this.devices = [];
    this.securityKeyNames = [];
  }

  start() {
    if (this.child && this.child.exitCode === null) return;
    this.child = spawn(this.python, [this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
    });
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk;
      let newline;
      while ((newline = this.stdoutBuffer.indexOf('\n')) >= 0) {
        const line = this.stdoutBuffer.slice(0, newline);
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
        this.onLine(line);
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      this.stderrBuffer += chunk;
      let newline;
      while ((newline = this.stderrBuffer.indexOf('\n')) >= 0) {
        const line = this.stderrBuffer.slice(0, newline);
        this.stderrBuffer = this.stderrBuffer.slice(newline + 1);
        this.onWorkerLog(line);
      }
    });
    this.child.on('error', () => {
      console.error('[iCloud Reminders] Could not start the Python worker.');
      this.setAuthState('disconnected');
      this.failPending('Could not start the PyICloud Python worker.');
    });
    this.child.on('exit', (code, signal) => {
      console.info(
        `[iCloud Reminders] Python worker exited: code=${code ?? 'unknown'}, signal=${signal || 'none'}.`,
      );
      this.child = null;
      this.setAuthState('disconnected');
      this.failPending('The PyICloud Python worker stopped.');
    });
  }

  onLine(line) {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    clearTimeout(pending.timeout);
    if (response.ok && typeof response.state === 'string') {
      this.setAuthState(response.state, response);
    } else if (
      response.errorCode === 'authentication_required' ||
      pending.action === 'authenticate'
    ) {
      this.setAuthState('disconnected');
    }
    pending.resolve(response);
  }

  onWorkerLog(line) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (
      !entry ||
      entry.service !== 'pyicloud-reminders' ||
      ![
        'worker_started',
        'request_started',
        'request_finished',
        'request_failed',
        'cloudkit_response_inspected',
        'cloudkit_section_query_failed',
        'cloudkit_diagnostic_unavailable',
      ].includes(
        entry.event,
      )
    ) {
      return;
    }
    const safeEntry = { service: entry.service, event: entry.event };
    if (entry.event === 'cloudkit_response_inspected') {
      const diagnostic = safeCloudKitDiagnostic(entry);
      if (!diagnostic) return;
      Object.assign(safeEntry, diagnostic);
    } else if (entry.event === 'cloudkit_diagnostic_unavailable') {
      if (typeof entry.list_key !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.list_key)) return;
      safeEntry.list_key = entry.list_key;
    } else if (entry.event === 'cloudkit_section_query_failed') {
      if (!['private', 'shared'].includes(entry.scope)) return;
      if (typeof entry.list_key !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.list_key)) return;
      safeEntry.scope = entry.scope;
      safeEntry.list_key = entry.list_key;
      if (typeof entry.error_type === 'string') safeEntry.error_type = entry.error_type.slice(0, 100);
    }
    for (const key of [
      'pyicloud_available',
      'pyicloud_version',
      'request_id',
      'action',
      'ok',
      'state',
      'error_code',
      'duration_ms',
      'list_count',
    ]) {
      const value = entry[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        safeEntry[key] = value;
      }
    }
    if (
      Array.isArray(entry.reminder_counts) &&
      entry.reminder_counts.every((value) => Number.isInteger(value))
    ) {
      safeEntry.reminder_counts = entry.reminder_counts;
    }
    console.info(`[iCloud Reminders] ${JSON.stringify(safeEntry)}`);
  }

  setAuthState(state, response = {}) {
    this.authState = state;
    this.devices = Array.isArray(response.devices)
      ? response.devices.map((device) => ({ index: device.index, name: device.name }))
      : state === 'device_selection_required'
        ? this.devices
        : [];
    this.securityKeyNames = Array.isArray(response.securityKeyNames)
      ? response.securityKeyNames.slice()
      : state === 'security_key_required'
        ? this.securityKeyNames
        : [];
  }

  status() {
    return {
      state: this.authState,
      devices: this.devices.map((device) => ({ ...device })),
      securityKeyNames: this.securityKeyNames.slice(),
    };
  }

  failPending(message) {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      this.pending.delete(requestId);
    }
  }

  request(action, payload = {}) {
    this.start();
    const requestId = `${process.pid}-${++this.nextRequestId}-${randomBytes(4).toString('hex')}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        console.warn(`[iCloud Reminders] Request timed out: action=${action}, durationMs=120000.`);
        reject(new Error('Apple iCloud request timed out.'));
      }, 120_000);
      this.pending.set(requestId, { resolve, reject, timeout, action });
      const body = JSON.stringify({ requestId, action, ...payload });
      this.child.stdin.write(`${body}\n`, (error) => {
        if (!error) return;
        this.pending.delete(requestId);
        clearTimeout(timeout);
        console.warn(
          `[iCloud Reminders] Could not send request to Python worker: action=${action}.`,
        );
        reject(new Error('Could not send a request to the PyICloud worker.'));
      });
    });
  }

  ping() {
    return this.request('ping');
  }

  reset() {
    return this.request('reset');
  }

  authenticate(appleId, password) {
    this.setAuthState('authenticating');
    return this.request('authenticate', {
      appleId,
      password,
      cookieDirectory: path.join(this.dataDir, 'icloud-reminders'),
    }).catch((error) => {
      this.setAuthState('disconnected');
      throw error;
    });
  }

  listLists() {
    return this.request('list_lists');
  }

  requestTwoStepCode(deviceIndex) {
    return this.request('request_2sa_code', { deviceIndex });
  }

  verifyCode(code) {
    return this.request('verify_code', { code });
  }

  fetchPreview(listKey) {
    return this.request('fetch_preview', { listKey });
  }

  stop() {
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
    this.setAuthState('disconnected');
    this.failPending('The PyICloud worker was stopped.');
  }
}

module.exports = { ICloudRemindersWorker };
