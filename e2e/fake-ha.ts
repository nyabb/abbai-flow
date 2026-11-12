import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Minimal Home Assistant stand-in for the browser E2E suite.
 *
 * It publishes just enough ChoreOps entities for `normalizeChoreOps()` to build
 * the planner and implements the ChoreOps services the app calls. State is
 * mutable and the test can inspect the calls afterwards, so the suite can prove
 * that a parent approval really reached `choreops.approve_reward` exactly once.
 */

export interface FakeUser {
  name: string;
  points: number;
}

export interface FakeReward {
  userName: string;
  name: string;
  cost: number;
  pendingClaims: number;
  status: string;
}

export interface FakeChore {
  userName: string;
  name: string;
  points: number;
  status: string;
}

export interface FakeServiceCall {
  service: string;
  data: Record<string, unknown>;
}

export interface FakeSeed {
  users?: Array<{ name: string; points: number }>;
  rewards?: Array<{
    user: string;
    name: string;
    cost: number;
    pendingClaims?: number;
    status?: string;
  }>;
  chores?: Array<{ user: string; name: string; points?: number; status?: string }>;
}

interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const parsed = raw ? JSON.parse(raw) : {};
        resolve(
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {},
        );
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export class FakeHa {
  readonly server: http.Server;
  private users = new Map<string, FakeUser>();
  private rewards: FakeReward[] = [];
  private chores: FakeChore[] = [];
  private calls: FakeServiceCall[] = [];

  private constructor(server: http.Server) {
    this.server = server;
  }

  static async start(): Promise<FakeHa> {
    const server = http.createServer();
    const instance = new FakeHa(server);
    server.on('request', (req, res) => {
      void instance.handle(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return instance;
  }

  get url(): string {
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  reset(seed: FakeSeed = {}): void {
    this.users = new Map(
      (seed.users ?? []).map((user) => [user.name.trim().toLowerCase(), { ...user }]),
    );
    this.rewards = (seed.rewards ?? []).map((reward) => ({
      userName: reward.user,
      name: reward.name,
      cost: reward.cost,
      pendingClaims: reward.pendingClaims ?? 0,
      status: reward.status ?? 'available',
    }));
    this.chores = (seed.chores ?? []).map((chore) => ({
      userName: chore.user,
      name: chore.name,
      points: chore.points ?? 0,
      status: chore.status ?? 'pending',
    }));
    this.calls = [];
  }

  setPoints(userName: string, points: number): void {
    const user = this.users.get(userName.trim().toLowerCase());
    if (user) user.points = points;
  }

  points(userName: string): number {
    return this.users.get(userName.trim().toLowerCase())?.points ?? 0;
  }

  serviceCalls(service?: string): FakeServiceCall[] {
    return service ? this.calls.filter((call) => call.service === service) : [...this.calls];
  }

  rewardNames(): string[] {
    return this.rewards.map((reward) => reward.name);
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server.listening) return resolve();
      this.server.close(() => resolve());
      this.server.closeAllConnections?.();
    });
  }

  private states(): EntityState[] {
    const entities: EntityState[] = [
      {
        // ChoreOps needs this helper before the app will create a reward: the
        // service payload carries the config entry id from it.
        entity_id: 'sensor.system_choreops_system',
        state: 'ok',
        attributes: {
          purpose: 'purpose_system_dashboard_helper',
          integration_entry_id: 'entry-e2e',
          friendly_name: 'ChoreOps system',
        },
      },
    ];

    for (const user of this.users.values()) {
      entities.push({
        entity_id: `sensor.${slug(user.name)}_choreops_points`,
        state: String(user.points),
        attributes: {
          purpose: 'purpose_points',
          user_name: user.name,
          friendly_name: `${user.name} points`,
        },
      });
    }

    for (const chore of this.chores) {
      entities.push({
        entity_id: `sensor.${slug(chore.userName)}_choreops_chore_status_${slug(chore.name)}`,
        state: chore.status,
        attributes: {
          purpose: 'purpose_chore_status',
          user_name: chore.userName,
          chore_name: chore.name,
          default_points: chore.points,
          assigned_user_names: [chore.userName],
          can_claim: chore.status !== 'completed',
          can_approve: false,
          friendly_name: chore.name,
        },
      });
      entities.push({
        entity_id: `button.${slug(chore.userName)}_chore_claim_${slug(chore.name)}`,
        state: 'unknown',
        attributes: {
          purpose: 'purpose_button_chore_claim',
          user_name: chore.userName,
          chore_name: chore.name,
          friendly_name: `Claim ${chore.name}`,
        },
      });
    }

    for (const reward of this.rewards) {
      const base = `${slug(reward.userName)}_choreops_reward_status_${slug(reward.name)}`;
      entities.push({
        entity_id: `sensor.${base}`,
        state: reward.status,
        attributes: {
          purpose: 'purpose_reward_status',
          user_name: reward.userName,
          reward_name: reward.name,
          cost: reward.cost,
          pending_claims: reward.pendingClaims,
          friendly_name: reward.name,
        },
      });
      entities.push({
        entity_id: `button.${slug(reward.userName)}_reward_redeem_${slug(reward.name)}`,
        state: 'unknown',
        attributes: {
          purpose: 'purpose_button_reward_redeem',
          user_name: reward.userName,
          reward_name: reward.name,
          friendly_name: `Redeem ${reward.name}`,
        },
      });
    }

    return entities;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    if (url === '/__test/reset' && req.method === 'POST') {
      this.reset((await readJson(req)) as FakeSeed);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (url === '/__test/points' && req.method === 'POST') {
      const body = await readJson(req);
      this.setPoints(String(body.user ?? ''), Number(body.points ?? 0));
      sendJson(res, 200, { ok: true, points: this.points(String(body.user ?? '')) });
      return;
    }
    if (url === '/__test/calls' && req.method === 'GET') {
      sendJson(res, 200, this.calls);
      return;
    }

    if (req.method === 'GET' && url === '/api/states') {
      sendJson(res, 200, this.states());
      return;
    }

    const serviceMatch = /^\/api\/services\/([^/?]+)\/([^/?]+)/.exec(url);
    if (req.method === 'POST' && serviceMatch) {
      const domain = serviceMatch[1];
      const service = serviceMatch[2];
      const data = await readJson(req);
      this.applyService(domain, service, data);
      sendJson(res, 200, {});
      return;
    }

    // Everything the rest of the app probes (calendars, weather, ...) gets an
    // empty collection instead of a 404 so unrelated views stay quiet.
    if (req.method === 'GET' && url.startsWith('/api/')) {
      sendJson(res, 200, []);
      return;
    }

    sendJson(res, 200, {});
  }

  private applyService(domain: string, service: string, data: Record<string, unknown>): void {
    this.calls.push({ service: `${domain}.${service}`, data });

    if (domain === 'button' && service === 'press') {
      const entityId = String(data.entity_id ?? '');
      const chore = this.chores.find(
        (item) =>
          entityId === `button.${slug(item.userName)}_chore_claim_${slug(item.name)}` ||
          entityId === `button.${slug(item.userName)}_chore_approve_${slug(item.name)}`,
      );
      if (!chore || chore.status === 'completed') return;
      chore.status = 'completed';
      const user = this.users.get(chore.userName.toLowerCase());
      if (user) user.points += chore.points;
      return;
    }

    if (domain !== 'choreops') return;

    if (service === 'create_reward') {
      const name = String(data.name ?? '').trim();
      const cost = Number(data.cost ?? 0);
      const users = Array.isArray(data.assigned_user_names)
        ? data.assigned_user_names.map((user) => String(user))
        : [];
      for (const userName of users) {
        this.rewards = this.rewards.filter(
          (reward) => !(reward.userName === userName && reward.name === name),
        );
        this.rewards.push({
          userName,
          name,
          cost: Math.max(1, Math.round(cost)),
          pendingClaims: 0,
          status: 'available',
        });
      }
      return;
    }

    if (service === 'update_reward') {
      const name = String(data.name ?? '').trim();
      const cost = Number(data.cost ?? 0);
      for (const reward of this.rewards) {
        if (reward.name === name && cost > 0) reward.cost = Math.max(1, Math.round(cost));
      }
      return;
    }

    if (service === 'delete_reward') {
      const name = String(data.name ?? '').trim();
      this.rewards = this.rewards.filter((reward) => reward.name !== name);
      return;
    }

    if (service === 'approve_reward') {
      const userName = String(data.user_name ?? '').trim();
      const rewardName = String(data.reward_name ?? '').trim();
      const reward = this.rewards.find(
        (item) => item.userName === userName && item.name === rewardName,
      );
      if (!reward) return;
      const user = this.users.get(userName.toLowerCase());
      if (user) user.points = Math.max(0, user.points - reward.cost);
      // The reward stays on offer for the next time the child saves up for it.
      reward.pendingClaims = 0;
      reward.status = 'available';
    }
  }
}
