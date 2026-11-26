const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const AUTH_STATE_ACTIONS = new Set([
  'reset',
  'authenticate',
  'list_lists',
  'request_2sa_code',
  'verify_code',
]);
const LOGGED_MUTATION_ACTIONS = new Set([
  'create_reminder',
  'update_reminder',
  'delete_reminder',
  'move_reminder_section',
]);

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
    if (response.ok && typeof response.state === 'string' && AUTH_STATE_ACTIONS.has(pending.action)) {
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
      entry.event !== 'request_finished' ||
      !LOGGED_MUTATION_ACTIONS.has(entry.action)
    ) {
      return;
    }
    const safeEntry = { service: entry.service, event: entry.event };
    for (const key of [
      'request_id',
      'action',
      'ok',
      'state',
      'error_code',
      'http_status',
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

  fetchList(listKey, revision) {
    return this.request('fetch_list', { listKey, revision });
  }

  fetchTaskLists(listKeys, revisions = {}) {
    return this.request('fetch_task_lists', { listKeys, revisions });
  }

  createReminder(values) {
    return this.request('create_reminder', values);
  }

  updateReminder(values) {
    return this.request('update_reminder', values);
  }

  deleteReminder(values) {
    return this.request('delete_reminder', values);
  }

  moveReminderSection(values) {
    return this.request('move_reminder_section', values);
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
