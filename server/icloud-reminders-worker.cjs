const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

class ICloudRemindersWorker {
  constructor({ dataDir, python = process.env.ABBAI_FLOW_PYTHON || 'python3', scriptPath } = {}) {
    this.dataDir = dataDir;
    this.python = python;
    this.scriptPath = scriptPath || path.join(__dirname, 'icloud_reminders_worker.py');
    this.child = null;
    this.nextRequestId = 0;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.authState = 'disconnected';
    this.devices = [];
    this.securityKeyNames = [];
  }

  start() {
    if (this.child && this.child.exitCode === null) return;
    this.child = spawn(this.python, [this.scriptPath], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
    });
    this.stdoutBuffer = '';
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
    this.child.on('error', () => {
      this.setAuthState('disconnected');
      this.failPending('Could not start the PyICloud Python worker.');
    });
    this.child.on('exit', () => {
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
    } else if (response.errorCode === 'authentication_required') {
      this.setAuthState('disconnected');
    }
    pending.resolve(response);
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
        reject(new Error('Apple iCloud request timed out.'));
      }, 120_000);
      this.pending.set(requestId, { resolve, reject, timeout });
      const body = JSON.stringify({ requestId, action, ...payload });
      this.child.stdin.write(`${body}\n`, (error) => {
        if (!error) return;
        this.pending.delete(requestId);
        clearTimeout(timeout);
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
    return this.request('authenticate', {
      appleId,
      password,
      cookieDirectory: path.join(this.dataDir, 'icloud-reminders'),
    });
  }

  requestTwoStepCode(deviceIndex) {
    return this.request('request_2sa_code', { deviceIndex });
  }

  verifyCode(code) {
    return this.request('verify_code', { code });
  }

  fetchPreview() {
    return this.request('fetch_preview');
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
