// T-17 — presence-gated chat push decision (plain node, no DB).
//
// The rule implemented in orderChatController.sendMessage and
// rideChatController.sendMessage: a chat message is pushed via FCM
// ONLY when the recipient has no live socket presence
// (socketService.isUserConnected). Online recipients get the socket
// event + in-app alert instead (T-16); offline / app-closed
// recipients get the push with sender + order context.
//
// isUserConnected reads the Socket.IO adapter's room set for the
// personal `user:<id>` room every authenticated socket joins. These
// tests drive it with a fake io — the same adapter shape socket.io
// exposes in production.
//
// Run:  node tests/chatPushPresence.test.js

const assert = require("node:assert");

const socketService = require("../src/services/socketService");

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

function fakeIo(rooms) {
    return {
        sockets: {
            adapter: {
                rooms: new Map(Object.entries(rooms)),
            },
        },
    };
}

test("no socket server connected → not present (push path taken)", () => {
    // Before connectSocket runs, io is null in a fresh process; the
    // helper must answer false rather than throw.
    assert.strictEqual(socketService.isUserConnected("64b64c2f2f2f2f2f2f2f2f2f"), false);
});

test("user with a live socket in their personal room → present (no push)", () => {
    socketService.connectSocket(fakeIo({ "user:u1": new Set(["socket-1"]) }));
    assert.strictEqual(socketService.isUserConnected("u1"), true);
});

test("user with no room entry → offline (push)", () => {
    socketService.connectSocket(fakeIo({ "user:u1": new Set(["socket-1"]) }));
    assert.strictEqual(socketService.isUserConnected("u2"), false);
});

test("room that exists but is empty → offline (push)", () => {
    socketService.connectSocket(fakeIo({ "user:u3": new Set() }));
    assert.strictEqual(socketService.isUserConnected("u3"), false);
});

test("missing/blank user id → not present, never throws", () => {
    socketService.connectSocket(fakeIo({}));
    assert.strictEqual(socketService.isUserConnected(""), false);
    assert.strictEqual(socketService.isUserConnected(null), false);
    assert.strictEqual(socketService.isUserConnected(undefined), false);
});

(async () => {
    let passed = 0;
    const failures = [];
    for (const { name, fn } of tests) {
        try {
            await fn();
            passed += 1;
            console.log(`  PASS  ${name}`);
        } catch (error) {
            failures.push({ name, error });
            console.log(`  FAIL  ${name}\n        ${error.message}`);
        }
    }
    console.log(`\n${passed}/${tests.length} tests passed`);
    if (failures.length) process.exitCode = 1;
})();
