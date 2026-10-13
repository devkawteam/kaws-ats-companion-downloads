const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness(enabled = true, staff = false) {
  const calls = [], requests = [], module = { exports: {} };
  class Builder {
    setName() { return this; } setDescription() { return this; } setRequired() { return this; } setMaxLength() { return this; }
    addSubcommand(fn) { fn(new Builder()); return this; } addStringOption(fn) { fn(new Builder()); return this; }
  }
  class FakeAi { constructor() { this.settings = { enabled, model: 'test' }; } async models() { return { ...this.settings, available: true }; } async ask(q, s) { requests.push({ q, s }); return { answer: 'Test answer @everyone', model: 'test' }; } }
  vm.runInNewContext(fs.readFileSync(require.resolve('../../bot/src/commands/ai'), 'utf8'), { module, require(name) {
    if (name === 'discord.js') return { SlashCommandBuilder: Builder };
    if (name === '../services/localAi') return { LocalAi: FakeAi };
    if (name === '../utils/permissions') return { isStaff: () => staff };
    if (name === '../services/companionRelay') return { roster: async () => ({ drivers: [{ driverName: 'Kaw', t: { connected: true } }] }) };
    throw Error(name);
  }, Date });
  const command = module.exports.createAiCommands({ config: {} })[0];
  const interaction = (sub, user = '1') => ({ user: { id: user }, options: { getSubcommand: () => sub, getString: key => key === 'driver' ? 'Kaw' : 'Question' }, async deferReply(body) { calls.push({ type: 'defer', body }); }, async editReply(body) { calls.push({ type: 'reply', body }); } });
  return { command, calls, requests, interaction };
}
test('Discord AI defers privately, disables mentions and uses a per-user cooldown', async () => {
  const h = harness(); await h.command.execute({ interaction: h.interaction('ask') });
  assert.equal(h.calls[0].type, 'defer'); assert.equal(h.calls[0].body.ephemeral, true);
  assert.equal(h.calls[1].body.allowedMentions.parse.length, 0);
  assert.deepEqual(Object.keys(h.requests[0].s), []);
  await h.command.execute({ interaction: h.interaction('ask') });
  assert.equal(h.requests.length, 1); assert.match(h.calls.at(-1).body.content, /15 seconds/);
});
test('nonstaff cannot request shared driver briefings; staff can', async () => {
  const blocked = harness(); await blocked.command.execute({ interaction: blocked.interaction('briefing') });
  assert.equal(blocked.requests.length, 0); assert.match(blocked.calls.at(-1).body.content, /staff permissions/);
  const allowed = harness(true, true); await allowed.command.execute({ interaction: allowed.interaction('briefing') });
  assert.equal(allowed.requests[0].s.connected, true);
});
test('disabled Discord AI returns setup instructions without inference', async () => {
  const h = harness(false); await h.command.execute({ interaction: h.interaction('ask') });
  assert.equal(h.requests.length, 0); assert.match(h.calls.at(-1).body.content, /bot computer/);
});
