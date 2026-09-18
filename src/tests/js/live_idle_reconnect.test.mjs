import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const liveSource = await readFile(new URL('../../web/live/main.js', import.meta.url), 'utf8');

test('idle WebSocket close does not auto-reconnect without active conversation', () => {
  assert.match(liveSource, /function shouldAutoReconnect\(\)/);
  // guard must check conversation/task state before recover
  assert.match(liveSource, /shouldAutoReconnect\(\)/);
  // onclose must gate recoverLiveSession with idle check
  const onCloseIdx = liveSource.indexOf('socket.onclose = async event');
  assert.ok(onCloseIdx >= 0, 'missing socket.onclose');
  const snippet = liveSource.slice(onCloseIdx, onCloseIdx + 1500);
  assert.match(snippet, /shouldAutoReconnect/);
  assert.match(snippet, /showReconnect/);
  assert.ok(
    snippet.indexOf('shouldAutoReconnect()') < snippet.indexOf('retryFreshAfterResume('),
    'idle guard must run before resume fallback retry'
  );
  assert.ok(
    snippet.indexOf('shouldAutoReconnect()') < snippet.indexOf('retryWithRealtimeFallback('),
    'idle guard must run before realtime fallback retry'
  );
});

test('goAway and browser-online respect idle guard', () => {
  const goAwayIdx = liveSource.indexOf('function handleScheduledReconnect');
  assert.ok(goAwayIdx >= 0);
  const goAwaySnippet = liveSource.slice(goAwayIdx, goAwayIdx + 800);
  assert.match(goAwaySnippet, /shouldAutoReconnect/);

  const onlineIdx = liveSource.indexOf('function handleBrowserOnline');
  assert.ok(onlineIdx >= 0);
  const onlineSnippet = liveSource.slice(onlineIdx, onlineIdx + 600);
  assert.match(onlineSnippet, /if \(!shouldAutoReconnect\(\)\) return/);
});

test('SessionStore lazy creation keeps folder off disk until first real log', async () => {
  // structural check: server /api/session must not synchronously log conversation folder
  const serverSource = await readFile(new URL('../../e_kaiwa/server.py', import.meta.url), 'utf8');
  const sessionBlock = serverSource.slice(serverSource.indexOf('if path == "/api/session"'), serverSource.indexOf('self.send_error(404)', serverSource.indexOf('if path == "/api/session"')));
  assert.doesNotMatch(sessionBlock, /sessions\.log\(/);
  assert.match(sessionBlock, /lazy/);
});

test('shouldAutoReconnect predicate covers activeTurn, conversationActive, push-to-talk and pending', () => {
  const fn = liveSource.slice(liveSource.indexOf('function shouldAutoReconnect'), liveSource.indexOf('function shouldAutoReconnect') + 500);
  assert.match(fn, /state\.activeTurn/);
  assert.match(fn, /state\.conversationActive/);
  assert.match(fn, /state\.pushToTalkPressed/);
  assert.match(fn, /state\.pushActivityOpen/);
  assert.match(fn, /state\.reconnectPending/);
  assert.match(fn, /waitingTurnNo/);
});
