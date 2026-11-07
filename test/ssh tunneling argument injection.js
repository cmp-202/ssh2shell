require('dotenv').config();
const SSH2Shell = require('../lib/ssh2shell');

const debug = true;
const verbose = true;

// Core baseline credentials mapped safely from your env
const baseParams = {
  port: process.env.PORT || '22',
  userName: process.env.USER_NAME,
  password: process.env.PASSWORD
};

/**
 * Multi-host Test Harness Generator
 * @param {string} testName - Clear log boundary label
 * @param {Object} payloadOverrides - Target parameters where the injection exploits are placed
 */
function runTunnelTest(testName, payloadOverrides) {
  console.log(`\n======================================================`);
  console.log(`🚀 STARTING PARAMETER TEST: ${testName}`);
  console.log(`======================================================`);

  // Target 1: Base Host (Always stable so it can successfully attempt the hop)
  const host1 = {
    server: { host: process.env.HOST, ...baseParams },
    commands: ["echo 'Host 1 verification complete'"],
    connectedMessage: "Connected to host1",
    debug: debug,
    verbose: verbose
  };

  // Target 2: Nested target where we inject malicious payload properties
  const server2Config = {
    host: process.env.SERVER2_HOST || '192.168.68.104',
    ...baseParams
  };

  // Layer the custom exploit parameter payloads dynamically over Server 2
  Object.assign(server2Config, payloadOverrides.server || {});

  const host2 = {
    server: server2Config,
    commands: ["echo 'Host 2 secondary execution execution check'"],
    connectedMessage: "Connected to host2",
    debug: debug,
    verbose: verbose
  };

  // Inject any parent property configurations (like custom top-level options blocks)
  Object.assign(host2, payloadOverrides.hostRoot || {});

  // Establish the multi-hop link chain exactly like your tunnel file
  host1.hosts = [host2];

  try {
    const SSH = new SSH2Shell(host1);

    // Watch for our security alerts dropping out of the error pipeline
    SSH.on('error', (err, type) => {
      if (type === "Security Alert") {
        console.log(`\n[SHIELD MATCH] 🛡️ Defended! Intercepted exploitation attempt.`);
        console.log(` -> Alert Type: ${type}`);
        console.log(` -> System Warning message: ${err}\n`);
      } else {
        console.log(`[EVENT MATCH] Caught Standard Connection Event -> Type: ${type} | Msg: ${err}`);
      }
    });

    const callback = function(sessionText) {
      console.log("-----Callback session text output processed safely:\n" + sessionText);
    };

    SSH.connect(callback);

  } catch (fatalError) {
    console.error("[FATAL CRASH] Process halted structurally during configuration parse:", fatalError);
  }
}

// =========================================================================
// REGISTERING OUR PARAMETER EXPLOIT CHALLENGES
// =========================================================================

// Test Case 1: Standard Tunnel baseline execution tracking verification
runTunnelTest("Standard Operational Tunnel Loop Verification", {
  server: {},
  hostRoot: {}
});

// Test Case 2: Argument Injection via Malicious IdentityFile Configuration String
runTunnelTest("Argument Injection Check via IdentityFile Parameter", {
  server: {
    // Maliciously passing a flag parameter intended to trick the string construction block into running uninvited commands
    ssh: {
      identityFile: "/safe/key.id -o ProxyCommand='echo INJECTION_SUCCESSFUL_EXPLOIT_EXECUTED'"
    }
  },
  hostRoot: {}
});

// Test Case 3: Command Injection via Remote Server Host Target Properties
runTunnelTest("Command Injection Interception via Target Host Parameter", {
  server: {
    // Injecting character execution terminators directly into the core remote host configuration field
    host: "192.168.68.104; echo 'MALICIOUS_COMMAND_INJECTED_IN_HOST_STRING'; #"
  },
  hostRoot: {}
});

// Test Case 4: Shell Control Interception inside custom dynamic option blocks
runTunnelTest("Shell Control Breakage inside custom options map keys", {
  server: {
    ssh: {
      options: {
        // Attempting to pass functional separators through the dynamic loops
        "StrictHostKeyChecking=no; touch /tmp/exploited; #": "yes"
      }
    }
  },
  hostRoot: {}
});
