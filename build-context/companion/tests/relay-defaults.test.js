'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {DEFAULT_RELAY, MAIN_RELAY, migrateRelayDefaults} = require('../src/relayDefaults');

test('blocked shipped relay migrates without enabling sharing or changing credentials', () => {
  const input = {remote:{enabled:false, endpoint:'https://ats.kawsplayground.online/api/telemetry', apiKey:'preserve-test-key', backupEndpoints:['https://kaws-ats-playground.onrender.com/api/telemetry']},jarvis:{url:'https://ats.kawsplayground.online/'},voice:{enabled:false}};
  const {config, changed} = migrateRelayDefaults(input);
  assert.equal(changed,true);
  assert.equal(config.remote.endpoint,MAIN_RELAY);
  assert.equal(config.remote.enabled,false);
  assert.equal(config.remote.apiKey,'preserve-test-key');
  assert.deepEqual(config.remote.backupEndpoints,['https://kaws-ats-playground.onrender.com/api/telemetry']);
  assert.equal(config.jarvis.url,DEFAULT_RELAY);
  assert.equal(config.voice.enabled,false);
  assert.equal(migrateRelayDefaults(config).changed,false);
});

test('old Render primary migrates but stays a backup; custom endpoints and preview overrides are preserved', () => {
  const render = migrateRelayDefaults({remote:{endpoint:'https://kaws-ats-playground.onrender.com/api/telemetry',backupEndpoints:['https://ats.kawsplayground.online/api/telemetry',MAIN_RELAY]},jarvis:{url:'https://preview.example.com'}}).config;
  assert.deepEqual(render.remote.backupEndpoints,['https://kaws-ats-playground.onrender.com/api/telemetry']);
  assert.equal(render.jarvis.url,'https://preview.example.com');
  const custom = {remote:{endpoint:'https://custom.example.com/api/telemetry',backupEndpoints:[]},jarvis:{url:'https://preview.example.com'}};
  assert.equal(migrateRelayDefaults(custom).changed,false);
  assert.equal(custom.remote.endpoint,'https://custom.example.com/api/telemetry');
});

test('blank installer relay is repaired without enabling sharing or changing keys', () => {
  const c = { remote: { enabled: false, endpoint: '', apiKey: 'saved-key' } };
  const result = migrateRelayDefaults(c);
  assert.equal(result.changed, true);
  assert.equal(c.remote.endpoint, MAIN_RELAY);
  assert.equal(c.remote.enabled, false);
  assert.equal(c.remote.apiKey, 'saved-key');
  assert.equal(migrateRelayDefaults(c).changed, false);
});
